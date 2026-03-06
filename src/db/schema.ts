import type { Database } from "bun:sqlite";

/**
 * Current schema version. Increment when making breaking schema changes.
 * user_version starts at 0 on a brand-new database.
 */
const _CURRENT_VERSION = 1;

/**
 * DDL for the events table.
 * All Claude Code hook event types are stored in a single table.
 * Common fields are extracted as indexed columns; the full stdin JSON
 * is preserved in the `payload` column for forward compatibility.
 *
 * wrapped_command (nullable): NULL = bare handler event; non-NULL = the
 * wrapped command string (Story 3.1). Pre-release — no migration needed.
 */
const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ts               INTEGER NOT NULL,
    event            TEXT    NOT NULL,
    session_id       TEXT    NOT NULL,
    cwd              TEXT    NOT NULL,
    tool_name        TEXT,
    session_name     TEXT,
    hook_duration_ms INTEGER,
    payload          TEXT    NOT NULL,
    wrapped_command  TEXT
  );
`;

/**
 * Indexes for common query patterns.
 * event, session_id, ts, and tool_name are the most frequently filtered columns.
 */
const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_events_event      ON events(event);
  CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_ts         ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_events_tool_name  ON events(tool_name);
`;

/**
 * Apply schema migrations using PRAGMA user_version.
 * Called by openDb() on every connection open.
 *
 * Migration strategy:
 *   - user_version 0 → 1: initial schema (events table + indexes)
 *   - Future versions: add cases below and increment CURRENT_VERSION
 */
export function applySchema(db: Database): void {
  const versionRow = db.query("PRAGMA user_version;").get() as {
    user_version: number;
  };
  const version = versionRow.user_version;

  if (version < 1) {
    db.exec(CREATE_EVENTS_TABLE);
    db.exec(CREATE_INDEXES);
    db.exec(`PRAGMA user_version = 1;`);
  }

  // Future migrations:
  // if (version < 2) { db.exec(...); db.exec("PRAGMA user_version = 2;"); }
}
