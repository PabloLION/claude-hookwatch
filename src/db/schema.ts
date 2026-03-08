import type { Database } from "bun:sqlite";

/**
 * Current schema version. Increment when making breaking schema changes.
 * user_version starts at 0 on a brand-new database.
 */
export const CURRENT_VERSION = 3;

/**
 * DDL for the events table.
 * All Claude Code hook event types are stored in a single table.
 * Common fields are extracted as indexed columns; the full stdin JSON
 * is preserved in the `stdin` column for forward compatibility.
 *
 * wrapped_command (nullable): NULL = bare handler event; non-NULL = the
 * wrapped command string (Story 3.1). Pre-release — no migration needed.
 *
 * stdout, stderr (nullable): only populated for wrapped events.
 * exit_code: NOT NULL DEFAULT 0 — Unix processes always exit 0-255.
 *
 * hookwatch_log (nullable): single column with severity prefix for
 * hookwatch-internal diagnostics. Format: "[error] msg" or "[warn] msg".
 * NULL = no issues. Scales to N severity levels without schema changes.
 * See devlog: 20260308-hookwatch-log-column-design.md
 */
export const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp        INTEGER NOT NULL,
    event            TEXT    NOT NULL,
    session_id       TEXT    NOT NULL,
    cwd              TEXT    NOT NULL,
    tool_name        TEXT,
    session_name     TEXT,
    hook_duration_ms INTEGER,
    stdin            TEXT    NOT NULL,
    wrapped_command  TEXT,
    stdout           TEXT,
    stderr           TEXT,
    exit_code        INTEGER NOT NULL DEFAULT 0,
    hookwatch_log    TEXT
  );
`;

/**
 * Indexes for common query patterns.
 * event, session_id, timestamp, and tool_name are the most frequently filtered columns.
 */
export const CREATE_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_events_event      ON events(event);
  CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp   ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_tool_name  ON events(tool_name);
`;

/**
 * Return value from checkVersion():
 *   "ok"      — version matches CURRENT_VERSION, no action needed
 *   "fresh"   — user_version=0, create schema then set version
 *   "mismatch"— user_version != CURRENT_VERSION (and != 0), caller must
 *               close the DB, rename the file, open a fresh DB, then call
 *               applyFreshSchema() on the new connection
 */
export type VersionStatus = "ok" | "fresh" | "mismatch";

/**
 * Read user_version from an open database and classify it.
 * Does NOT modify the database.
 */
export function checkVersion(db: Database): VersionStatus {
  const row = db.query("PRAGMA user_version;").get() as { user_version: number };
  const version = row.user_version;
  if (version === CURRENT_VERSION) return "ok";
  if (version === 0) return "fresh";
  return "mismatch";
}

/**
 * Apply a fresh schema to an empty database and stamp with CURRENT_VERSION.
 * Called for brand-new databases (user_version=0) and after backup-recreate.
 */
export function applyFreshSchema(db: Database): void {
  db.exec(CREATE_EVENTS_TABLE);
  db.exec(CREATE_INDEXES);
  db.exec(`PRAGMA user_version = ${CURRENT_VERSION};`);
}
