import type { Database } from "bun:sqlite";
import type { QueryFilter } from "@/schemas/query.ts";

/**
 * Represents a single row in the events table.
 * snake_case matches database column names.
 */
export interface EventRow {
  id: number;
  timestamp: number;
  event: string;
  session_id: string;
  cwd: string;
  tool_name: string | null;
  session_name: string | null;
  hook_duration_ms: number | null;
  stdin: string;
  /** NULL = bare handler event; non-NULL = wrapped command string (Story 3.1) */
  wrapped_command: string | null;
  /** Captured child stdout (wrapped mode); hookwatch JSON output (bare mode) */
  stdout: string | null;
  /** Captured child stderr (wrapped mode); NULL for bare mode */
  stderr: string | null;
  /** Child exit code. NOT NULL DEFAULT 0 — Unix processes always exit 0-255. */
  exit_code: number;
  /**
   * Hookwatch-internal diagnostics with severity prefix.
   * Format: "[error] msg" or "[warn] msg" or "[error] msg1; [warn] msg2".
   * NULL = no issues. See devlog: 20260308-hookwatch-log-column-design.md
   */
  hookwatch_log: string | null;
}

/**
 * Parameters for inserting a new event.
 * All values must be explicitly provided — no defaults computed here.
 */
export interface InsertEventParams {
  timestamp: number;
  event: string;
  session_id: string;
  cwd: string;
  tool_name: string | null;
  session_name: string | null;
  hook_duration_ms: number | null;
  stdin: string;
  /** NULL = bare handler event; non-NULL = wrapped command string (Story 3.1) */
  wrapped_command: string | null;
  /** Captured child stdout (wrapped mode); hookwatch JSON output (bare mode) */
  stdout: string | null;
  /** Captured child stderr (wrapped mode); NULL for bare mode */
  stderr: string | null;
  /** Child exit code. NOT NULL DEFAULT 0 — Unix processes always exit 0-255. */
  exit_code: number;
  /**
   * Hookwatch-internal diagnostics with severity prefix.
   * Format: "[error] msg" or "[warn] msg" or "[error] msg1; [warn] msg2".
   * NULL = no issues. See devlog: 20260308-hookwatch-log-column-design.md
   */
  hookwatch_log: string | null;
}

/**
 * Insert a new event row using a parameterized query.
 * ch-lar: NO string concatenation — all values passed as parameters.
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
  const stmt = db.prepare(`SELECT * FROM events WHERE id = ?`);
  return (stmt.get(id) as EventRow | null) ?? null;
}

/**
 * Retrieve all events, ordered by timestamp ascending.
 * For production use, callers should add LIMIT/OFFSET filters via selectEvents().
 */
export function getAllEvents(db: Database): EventRow[] {
  const stmt = db.prepare(`SELECT * FROM events ORDER BY timestamp ASC`);
  return stmt.all() as EventRow[];
}

/**
 * Retrieve events filtered by session_id.
 */
export function getEventsBySession(db: Database, sessionId: string): EventRow[] {
  const stmt = db.prepare(`SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC`);
  return stmt.all(sessionId) as EventRow[];
}

/**
 * Retrieve events filtered by event type.
 */
export function getEventsByType(db: Database, eventType: string): EventRow[] {
  const stmt = db.prepare(`SELECT * FROM events WHERE event = ? ORDER BY timestamp ASC`);
  return stmt.all(eventType) as EventRow[];
}

/**
 * Retrieve distinct session IDs ordered by most recent activity first.
 * Used to populate the session filter dropdown in the web UI.
 * ch-lar: no user input — static query, no parameterization needed.
 */
export function getDistinctSessions(db: Database): string[] {
  const stmt = db.prepare(`SELECT DISTINCT session_id FROM events ORDER BY timestamp DESC`);
  return (stmt.all() as Array<{ session_id: string }>).map((r) => r.session_id);
}

/**
 * Retrieve events with optional filters, ordered by timestamp DESC (newest first).
 *
 * ch-lar: all filter values are passed as parameterized ? placeholders — no
 * string concatenation is performed on user-supplied values. The WHERE clause
 * conditions are built statically from a fixed allowed set; only the bound
 * values vary at runtime.
 */
export function queryEvents(db: Database, filter: QueryFilter): EventRow[] {
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (filter.session_id !== undefined) {
    conditions.push("session_id = ?");
    bindings.push(filter.session_id);
  }

  if (filter.hook_event_name !== undefined) {
    conditions.push("event = ?");
    bindings.push(filter.hook_event_name);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // LIMIT and OFFSET have Zod defaults (100 and 0), so they are always present.
  const sql = `SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  bindings.push(filter.limit, filter.offset);

  const stmt = db.prepare(sql);
  return stmt.all(...bindings) as EventRow[];
}
