/**
 * POST /api/events — event ingestion endpoint.
 *
 * Accepts a JSON body with a Claude Code hook event payload, validates it
 * against event-specific Zod schemas via parseHookEvent(), inserts into SQLite,
 * and returns 201.
 *
 * The request body may include optional top-level fields for wrapped events:
 * `wrapped_command` (string), `stdout` (string), `stderr` (string),
 * `exit_code` (number, defaults to 0), `hookwatch_log` (string). When present
 * they are stored in DB columns; NULL/0 otherwise.
 *
 * Error handling:
 *   - 400 INVALID_QUERY  — malformed JSON or failed Zod validation
 *   - 503 DB_LOCKED      — SQLite SQLITE_BUSY (WAL writer conflict)
 *   - 500 INTERNAL       — any other unexpected error
 *
 * All DB values go through parameterized insertEvent() — no string concatenation.
 */

import { openDb } from '@/db/connection.ts';
import { getEventById, insertEvent } from '@/db/queries.ts';
import { errorMsg } from '@/errors.ts';
import { isRecord } from '@/guards.ts';
import { type HookEvent, parseHookEvent } from '@/schemas/events.ts';
import {
  dbErrorResponse,
  errorResponse,
  parseRequestJson,
  zodErrorResponse,
} from '@/server/errors.ts';
import { HTTP_CREATED } from '@/server/http-status.ts';
import { broadcast } from '@/server/stream.ts';
import { toKnownEventName } from '@/types.ts';

// ---------------------------------------------------------------------------
// Wrap fields
// ---------------------------------------------------------------------------

interface WrapFields {
  readonly wrappedCommand: string | null;
  readonly wrappedStdout: string | null;
  readonly wrappedStderr: string | null;
  readonly wrappedExitCode: number;
  readonly hookDurationMs: number | null;
  readonly hookwatchLog: string | null;
}

/**
 * Coerce a value to a non-empty string or null.
 * Invariant: DB string fields are either null (absent/empty) or a non-empty string (content).
 */
function stringOrNull(val: unknown): string | null {
  return typeof val === 'string' && val ? val : null;
}

/**
 * Extracts optional wrap fields from the parsed request body object.
 * These fields are present when the handler runs in wrapped mode.
 * Caller passes the validated request body (must be a plain object).
 * The handleIngest guard rejects non-object bodies before this function is called.
 */
function extractWrapFields(body: Record<string, unknown>): WrapFields {
  // Log a warning for semantically important fields that arrive with an unexpected type.
  // These indicate a handler/server version mismatch or a malformed request.
  if (body.exit_code !== undefined && typeof body.exit_code !== 'number') {
    process.stderr.write('[hookwatch] [warn] exit_code has unexpected type\n');
  }
  if (body.wrapped_command !== undefined && typeof body.wrapped_command !== 'string') {
    process.stderr.write('[hookwatch] [warn] wrapped_command has unexpected type\n');
  }
  if (body.hook_duration_ms !== undefined && typeof body.hook_duration_ms !== 'number') {
    process.stderr.write('[hookwatch] [warn] hook_duration_ms has unexpected type\n');
  }

  return {
    wrappedCommand: stringOrNull(body.wrapped_command),
    wrappedStdout: stringOrNull(body.stdout),
    wrappedStderr: stringOrNull(body.stderr),
    wrappedExitCode:
      typeof body.exit_code === 'number'
        ? body.exit_code
        : typeof body.exit_code === 'string' && !Number.isNaN(Number(body.exit_code))
          ? Number(body.exit_code)
          : 0,
    hookDurationMs: typeof body.hook_duration_ms === 'number' ? body.hook_duration_ms : null,
    hookwatchLog: stringOrNull(body.hookwatch_log),
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleIngest(req: Request): Promise<Response> {
  const parsed = await parseRequestJson(req);
  if (!parsed.ok) return parsed.response;
  const { data: raw } = parsed;

  // Guard: req.json() can return any JSON value (string, number, array, null).
  // Reject anything that is not a plain object before proceeding.
  if (!isRecord(raw)) {
    return errorResponse('INVALID_QUERY', 'Request body must be a JSON object');
  }

  // Extract optional wrap fields explicitly for typed DB storage.
  // the .loose() schemas used by parseHookEvent() would preserve them as untyped index entries,
  // but we need them as named, typed WrapFields for insertEvent().
  const {
    wrappedCommand,
    wrappedStdout,
    wrappedStderr,
    wrappedExitCode,
    hookDurationMs,
    hookwatchLog,
  } = extractWrapFields(raw);

  let event: HookEvent;
  try {
    event = parseHookEvent(raw);
  } catch (err) {
    return zodErrorResponse(err);
  }

  // Normalise event name — log a warning when a new event type is not yet recognised
  const eventName = toKnownEventName(event.hook_event_name);
  if (eventName === 'unknown') {
    process.stderr.write(
      `[hookwatch] [warn] Unrecognised event type "${event.hook_event_name}" — stored as "unknown"\n`,
    );
  }

  // Insert into DB
  let id: number;
  let db: ReturnType<typeof openDb>;
  try {
    db = openDb();
    id = insertEvent(db, {
      timestamp: Date.now(),
      event: eventName,
      session_id: event.session_id,
      cwd: event.cwd,
      tool_name:
        'tool_name' in event && typeof event.tool_name === 'string' ? event.tool_name : null,
      // session_name: not extracted from event payloads (hardcoded null).
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
    return dbErrorResponse(err);
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
    } else {
      process.stderr.write(
        `[hookwatch] Warning: event ${id} was inserted but could not be fetched for broadcast\n`,
      );
    }
  } catch (err) {
    process.stderr.write(`[hookwatch] broadcast failed for event ${id}: ${errorMsg(err)}\n`);
  }

  return Response.json({ id }, { status: HTTP_CREATED });
}
