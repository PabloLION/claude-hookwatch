import type { Database } from "bun:sqlite";

/**
 * Represents a single row in the events table.
 * snake_case matches database column names.
 */
export interface EventRow {
  id: number;
  ts: number;
  event: string;
  session_id: string;
  cwd: string;
  tool_name: string | null;
  session_name: string | null;
  hook_duration_ms: number | null;
  payload: string;
}

/**
 * Parameters for inserting a new event.
 * All values must be explicitly provided — no defaults computed here.
 */
export interface InsertEventParams {
  ts: number;
  event: string;
  session_id: string;
  cwd: string;
  tool_name: string | null;
  session_name: string | null;
  hook_duration_ms: number | null;
  payload: string;
}

/**
 * Insert a new event row using a parameterized query.
 * ch-lar: NO string concatenation — all values passed as parameters.
 * Returns the auto-generated id.
 */
export function insertEvent(db: Database, params: InsertEventParams): number {
  const stmt = db.prepare(
    `INSERT INTO events
       (ts, event, session_id, cwd, tool_name, session_name, hook_duration_ms, payload)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    params.ts,
    params.event,
    params.session_id,
    params.cwd,
    params.tool_name,
    params.session_name,
    params.hook_duration_ms,
    params.payload,
  );
  return Number(result.lastInsertRowid);
}

/**
 * Retrieve a single event by its id.
 * Returns null if not found.
 */
export function getEventById(db: Database, id: number): EventRow | null {
  const stmt = db.prepare(`SELECT * FROM events WHERE id = ?`);
  return (stmt.get(id) as EventRow | null) ?? null;
}

/**
 * Retrieve all events, ordered by ts ascending.
 * For production use, callers should add LIMIT/OFFSET filters via selectEvents().
 */
export function getAllEvents(db: Database): EventRow[] {
  const stmt = db.prepare(`SELECT * FROM events ORDER BY ts ASC`);
  return stmt.all() as EventRow[];
}

/**
 * Retrieve events filtered by session_id.
 */
export function getEventsBySession(db: Database, sessionId: string): EventRow[] {
  const stmt = db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY ts ASC`);
  return stmt.all(sessionId) as EventRow[];
}

/**
 * Retrieve events filtered by event type.
 */
export function getEventsByType(db: Database, eventType: string): EventRow[] {
  const stmt = db.prepare(`SELECT * FROM events WHERE event = ? ORDER BY ts ASC`);
  return stmt.all(eventType) as EventRow[];
}
