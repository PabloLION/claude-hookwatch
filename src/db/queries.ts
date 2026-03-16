import type { Database } from 'bun:sqlite';
import type { QueryFilter } from '@/schemas/query.ts';
import type { EventRow, InsertEventParams } from '@/types.ts';

/**
 * Insert a new event row using a parameterized query.
 * All values passed as parameters — no string concatenation.
 * Returns the auto-generated id.
 */
export function insertEvent(db: Database, params: InsertEventParams): number {
  const stmt = db.prepare(
    `INSERT INTO events
       (timestamp, event, session_id, cwd, tool_name, session_name, hook_duration_ms, stdin, wrapped_command, stdout, stderr, exit_code, hookwatch_log)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const result = stmt.run(
    params.timestamp,
    params.event,
    params.session_id,
    params.cwd,
    params.tool_name,
    params.session_name,
    params.hook_duration_ms,
    params.stdin,
    params.wrapped_command,
    params.stdout,
    params.stderr,
    params.exit_code,
    params.hookwatch_log,
  );
  return Number(result.lastInsertRowid);
}

/**
 * Retrieve a single event by its id.
 * Returns null if not found.
 */
export function getEventById(db: Database, id: number): EventRow | null {
  const stmt = db.prepare<EventRow, [number]>(`SELECT * FROM events WHERE id = ?`);
  return stmt.get(id) ?? null;
}

/**
 * Retrieve all events, ordered by timestamp ascending.
 * For production use, callers should add LIMIT/OFFSET filters via selectEvents().
 */
export function getAllEvents(db: Database): EventRow[] {
  const stmt = db.prepare<EventRow, []>(`SELECT * FROM events ORDER BY timestamp ASC`);
  return stmt.all();
}

/**
 * Retrieve distinct session IDs ordered by most recent activity first.
 * Used to populate the session filter dropdown in the web UI.
 * LIMIT 200 is sufficient for the dropdown — keeps query fast on large DBs.
 * No user input — static query, no parameterization needed.
 */
export function getDistinctSessions(db: Database): string[] {
  const stmt = db.prepare<{ session_id: string }, []>(
    `SELECT session_id FROM events GROUP BY session_id ORDER BY MAX(timestamp) DESC LIMIT 200`,
  );
  return stmt.all().map((r) => r.session_id);
}

/**
 * Retrieve events with optional filters, ordered by timestamp DESC (newest first).
 *
 * All filter values are passed as parameterized ? placeholders — no
 * string concatenation is performed on user-supplied values. The WHERE clause
 * conditions are built statically from a fixed allowed set; only the bound
 * values vary at runtime.
 */
export function queryEvents(db: Database, filter: QueryFilter): EventRow[] {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (filter.session_id !== undefined) {
    conditions.push('session_id = ?');
    bindings.push(filter.session_id);
  }

  if (filter.hook_event_name !== undefined) {
    conditions.push('event = ?');
    bindings.push(filter.hook_event_name);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // LIMIT and OFFSET have Zod defaults (100 and 0), so they are always present.
  const sql = `SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  bindings.push(filter.limit, filter.offset);

  // Cast unavoidable: dynamic SQL with variable-length bindings cannot satisfy
  // prepare<T>'s fixed generic params. Other query functions use typed prepare<>.
  const stmt = db.prepare(sql);
  return stmt.all(...bindings) as EventRow[];
}
