import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { applySchema } from "./schema.ts";

/**
 * Resolve the database file path.
 * Respects $XDG_DATA_HOME if set; falls back to ~/.local/share/hookwatch/hookwatch.db.
 */
function resolveDbPath(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  const base = xdgDataHome ?? `${process.env.HOME}/.local/share`;
  return `${base}/hookwatch/hookwatch.db`;
}

let db: Database | null = null;

/**
 * Open (or return the cached) database connection.
 * On first open:
 *   1. Creates parent directory if needed.
 *   2. Opens the database file (bun:sqlite creates the file on open).
 *   3. Sets 0600 permissions immediately after file creation.
 *   4. Enables WAL mode.
 *   5. Applies the current schema.
 */
export function openDb(dbPath?: string): Database {
  if (db !== null) return db;

  const path = dbPath ?? resolveDbPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const isNew = !existsSync(path);

  db = new Database(path);

  if (isNew) {
    // Set 0600 immediately after file creation
    chmodSync(path, 0o600);
  }

  // Enable WAL mode on every connection open
  db.exec("PRAGMA journal_mode=wal;");

  // Apply schema (CREATE TABLE IF NOT EXISTS, migrations)
  applySchema(db);

  return db;
}

/**
 * Close the database connection. Exported for graceful shutdown consumers.
 */
export function close(): void {
  if (db !== null) {
    db.close();
    db = null;
  }
}
