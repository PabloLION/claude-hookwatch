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
 * Caller passes the validated request body (must be a plain object).
 * The handleIngest guard rejects non-object bodies before this function is called.
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
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('INVALID_QUERY', 'Request body is not valid JSON', HTTP_BAD_REQUEST);
  }

  // Guard: req.json() can return any JSON value (string, number, array, null).
  // Reject anything that is not a plain object before proceeding.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return errorResponse('INVALID_QUERY', 'Request body must be a JSON object', HTTP_BAD_REQUEST);
  }

  // Extract optional wrap fields explicitly for typed DB storage.
  // parseHookEvent(.loose()) would preserve them as untyped index entries,
  // but we need them as named, typed WrapFields for insertEvent().
  // Cast to Record<string, unknown> is safe: the guard above rejects non-object bodies.
  const {
    wrappedCommand,
    wrappedStdout,
    wrappedStderr,
    wrappedExitCode,
    hookDurationMs,
    hookwatchLog,
  } = extractWrapFields(raw as Record<string, unknown>);

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

  // Insert into DB
  let id: number;
  let db: ReturnType<typeof openDb>;
  try {
    db = openDb();
    id = insertEvent(db, {
      timestamp: Date.now(),
      event: toKnownEventName(event.hook_event_name),
      session_id: event.session_id,
      cwd: event.cwd,
      tool_name:
        'tool_name' in event && typeof event.tool_name === 'string' ? event.tool_name : null,
      // session_name is reserved for future use — no event type currently provides this field.
      session_name: null,
      hook_duration_ms: hookDurationMs,
      stdin: JSON.stringify(event),
      wrapped_command: wrappedCommand,
      stdout: wrappedStdout,
      stderr: wrappedStderr,
      exit_code: wrappedExitCode,
      hookwatch_log: hookwatchLog,
    });
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

  // Broadcast the saved row to all connected SSE clients.
  // Fetch the row so broadcast carries the canonical DB representation
  // (with id, timestamp, and all columns) — never broadcast raw input.
  // A broadcast failure does not affect the 201 response — the insert already
  // succeeded and the client should not receive a 500 for an SSE delivery issue.
  try {
    const row = getEventById(db, id);
    if (row !== null) {
      broadcast(row);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[hookwatch] broadcast failed for event ${id}: ${message}\n`);
  }

  return Response.json({ id }, { status: HTTP_CREATED });
}
