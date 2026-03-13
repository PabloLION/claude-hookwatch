/**
 * POST /api/events — event ingestion endpoint.
 *
 * Accepts a JSON body with a Claude Code hook event payload, validates it with
 * the Zod discriminated-union schema, inserts into SQLite, and returns 201.
 *
 * The request body may include optional top-level fields for wrapped events
 * (Story 3.1): `wrapped_command` (string), `stdout` (string), `stderr` (string),
 * `exit_code` (number, defaults to 0), `hookwatch_log` (string). When present
 * they are stored in DB columns; NULL/0 otherwise.
 *
 * Error handling:
 *   - 400 INVALID_QUERY  — malformed JSON or failed Zod validation
 *   - 503 DB_LOCKED      — SQLite SQLITE_BUSY (WAL writer conflict)
 *   - 500 INTERNAL       — any other unexpected error
 *
 * ch-lar: all DB values go through parameterized insertEvent() — no string concatenation.
 */

import { ZodError } from 'zod';
import { openDb } from '@/db/connection.ts';
import { isSqliteBusy } from '@/db/errors.ts';
import { getEventById, insertEvent } from '@/db/queries.ts';
import { parseHookEvent } from '@/schemas/events.ts';
import { errorResponse } from '@/server/errors.ts';
import {
  HTTP_BAD_REQUEST,
  HTTP_CREATED,
  HTTP_INTERNAL_ERROR,
  HTTP_SERVICE_UNAVAILABLE,
} from '@/server/http-status.ts';
import { broadcast } from '@/server/stream.ts';
import { toKnownEventName } from '@/types.ts';

// ---------------------------------------------------------------------------
// Wrap fields
// ---------------------------------------------------------------------------

interface WrapFields {
  wrappedCommand: string | null;
  wrappedStdout: string | null;
  wrappedStderr: string | null;
  wrappedExitCode: number;
  hookDurationMs: number | null;
  hookwatchLog: string | null;
}

/**
 * Extracts optional wrap fields from the parsed request body object.
 * These fields are present when the handler runs in wrapped mode (Story 3.1).
 * Caller must pass a Record — `req.json()` guarantees this after successful parse.
 */
function extractWrapFields(body: Record<string, unknown>): WrapFields {
  return {
    wrappedCommand: typeof body.wrapped_command === 'string' ? body.wrapped_command : null,
    wrappedStdout: typeof body.stdout === 'string' ? body.stdout : null,
    wrappedStderr: typeof body.stderr === 'string' ? body.stderr : null,
    wrappedExitCode: typeof body.exit_code === 'number' ? body.exit_code : 0,
    hookDurationMs: typeof body.hook_duration_ms === 'number' ? body.hook_duration_ms : null,
    hookwatchLog: typeof body.hookwatch_log === 'string' ? body.hookwatch_log : null,
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleIngest(req: Request): Promise<Response> {
  // Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('INVALID_QUERY', 'Request body is not valid JSON', HTTP_BAD_REQUEST);
  }

  // Extract optional wrap fields from the top-level body object before
  // handing raw to parseHookEvent (which uses .loose() so it won't strip
  // them, but we extract them explicitly here for DB storage).
  // Cast to Record<string, unknown>: req.json() returns any, and if raw is not
  // an object the typeof guards inside extractWrapFields produce safe defaults.
  const {
    wrappedCommand,
    wrappedStdout,
    wrappedStderr,
    wrappedExitCode,
    hookDurationMs,
    hookwatchLog,
  } = extractWrapFields(raw as Record<string, unknown>);

  // Validate with Zod
  let event: ReturnType<typeof parseHookEvent>;
  try {
    event = parseHookEvent(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse(
        'INVALID_QUERY',
        `Validation failed: ${err.issues.map((i) => i.message).join('; ')}`,
        HTTP_BAD_REQUEST,
      );
    }
    return errorResponse('INVALID_QUERY', 'Payload validation failed', HTTP_BAD_REQUEST);
  }

  // Insert into DB and broadcast to SSE clients
  try {
    const db = openDb();
    const id = insertEvent(db, {
      timestamp: Date.now(),
      event: toKnownEventName(event.hook_event_name),
      session_id: event.session_id,
      cwd: event.cwd,
      tool_name:
        'tool_name' in event && typeof event.tool_name === 'string' ? event.tool_name : null,
      session_name: null,
      hook_duration_ms: hookDurationMs,
      stdin: JSON.stringify(event),
      wrapped_command: wrappedCommand,
      stdout: wrappedStdout,
      stderr: wrappedStderr,
      exit_code: wrappedExitCode,
      hookwatch_log: hookwatchLog,
    });

    // Broadcast the saved row to all connected SSE clients.
    // Fetch the row so broadcast carries the canonical DB representation
    // (with id, timestamp, and all columns) — never broadcast raw input.
    const row = getEventById(db, id);
    if (row !== null) {
      broadcast(row);
    }

    return Response.json({ id }, { status: HTTP_CREATED });
  } catch (err) {
    // Detect SQLite BUSY / LOCKED errors
    if (isSqliteBusy(err)) {
      return errorResponse(
        'DB_LOCKED',
        'Database is busy, retry shortly',
        HTTP_SERVICE_UNAVAILABLE,
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse('INTERNAL', message, HTTP_INTERNAL_ERROR);
  }
}
