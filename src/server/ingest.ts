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
import { broadcast } from '@/server/stream.ts';
import { toKnownEventName } from '@/types.ts';

export async function handleIngest(req: Request): Promise<Response> {
  // Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('INVALID_QUERY', 'Request body is not valid JSON', 400);
  }

  // Extract optional wrap fields from the top-level body object before
  // handing raw to parseHookEvent (which uses .passthrough() so it won't strip
  // them, but we extract them explicitly here for DB storage).
  const bodyObj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const wrappedCommand: string | null =
    typeof bodyObj.wrapped_command === 'string' ? bodyObj.wrapped_command : null;
  const wrappedStdout: string | null = typeof bodyObj.stdout === 'string' ? bodyObj.stdout : null;
  const wrappedStderr: string | null = typeof bodyObj.stderr === 'string' ? bodyObj.stderr : null;
  const wrappedExitCode: number = typeof bodyObj.exit_code === 'number' ? bodyObj.exit_code : 0;
  const hookDurationMs: number | null =
    typeof bodyObj.hook_duration_ms === 'number' ? bodyObj.hook_duration_ms : null;
  const hookwatchLog: string | null =
    typeof bodyObj.hookwatch_log === 'string' ? bodyObj.hookwatch_log : null;

  // Validate with Zod
  let event: ReturnType<typeof parseHookEvent>;
  try {
    event = parseHookEvent(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse(
        'INVALID_QUERY',
        `Validation failed: ${err.issues.map((i) => i.message).join('; ')}`,
        400,
      );
    }
    return errorResponse('INVALID_QUERY', 'Payload validation failed', 400);
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

    return Response.json({ id }, { status: 201 });
  } catch (err) {
    // Detect SQLite BUSY / LOCKED errors
    if (isSqliteBusy(err)) {
      return errorResponse('DB_LOCKED', 'Database is busy, retry shortly', 503);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse('INTERNAL', message, 500);
  }
}
