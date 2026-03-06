/**
 * POST /api/events — event ingestion endpoint.
 *
 * Accepts a JSON body with a Claude Code hook event payload, validates it with
 * the Zod discriminated-union schema, inserts into SQLite, and returns 201.
 *
 * The request body may include an optional top-level `wrapped_command` string
 * field (Story 3.1). When present it is stored in the DB column; NULL otherwise.
 *
 * Error handling:
 *   - 400 INVALID_QUERY  — malformed JSON or failed Zod validation
 *   - 503 DB_LOCKED      — SQLite SQLITE_BUSY (WAL writer conflict)
 *   - 500 INTERNAL       — any other unexpected error
 *
 * ch-lar: all DB values go through parameterized insertEvent() — no string concatenation.
 */

import { ZodError } from "zod";
import { openDb } from "@/db/connection.ts";
import { getEventById, insertEvent } from "@/db/queries.ts";
import { parseHookEvent } from "@/schemas/events.ts";
import { errorResponse } from "@/server/errors.ts";
import { broadcast } from "@/server/stream.ts";

export async function handleIngest(req: Request): Promise<Response> {
  // Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse("INVALID_QUERY", "Request body is not valid JSON", 400);
  }

  // Extract optional wrapped_command from the top-level body object before
  // handing raw to parseHookEvent (which uses .passthrough() so it won't strip
  // it, but we extract it explicitly here for DB storage).
  const wrappedCommand: string | null =
    raw !== null &&
    typeof raw === "object" &&
    "wrapped_command" in raw &&
    typeof (raw as Record<string, unknown>).wrapped_command === "string"
      ? ((raw as Record<string, unknown>).wrapped_command as string)
      : null;

  // Validate with Zod
  let event: ReturnType<typeof parseHookEvent>;
  try {
    event = parseHookEvent(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse(
        "INVALID_QUERY",
        `Validation failed: ${err.issues.map((i) => i.message).join("; ")}`,
        400,
      );
    }
    return errorResponse("INVALID_QUERY", "Payload validation failed", 400);
  }

  // Insert into DB and broadcast to SSE clients
  try {
    const db = openDb();
    const id = insertEvent(db, {
      ts: Date.now(),
      event: event.hook_event_name,
      session_id: event.session_id,
      cwd: event.cwd,
      tool_name:
        "tool_name" in event && typeof event.tool_name === "string" ? event.tool_name : null,
      session_name: null,
      hook_duration_ms: null,
      payload: JSON.stringify(event),
      wrapped_command: wrappedCommand,
    });

    // Broadcast the saved row to all connected SSE clients.
    // Fetch the row so broadcast carries the canonical DB representation
    // (with id, ts, and all columns) — never broadcast raw input.
    const row = getEventById(db, id);
    if (row !== null) {
      broadcast(row);
    }

    return Response.json({ id }, { status: 201 });
  } catch (err) {
    // Detect SQLite BUSY / LOCKED errors
    if (isSqliteBusy(err)) {
      return errorResponse("DB_LOCKED", "Database is busy, retry shortly", 503);
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorResponse("INTERNAL", message, 500);
  }
}

/**
 * Returns true when the error is a SQLite SQLITE_BUSY or SQLITE_LOCKED condition.
 * bun:sqlite surfaces these as Error objects whose message contains the SQLite
 * error string.
 */
function isSqliteBusy(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toUpperCase();
  return msg.includes("SQLITE_BUSY") || msg.includes("SQLITE_LOCKED");
}
