import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { dbPath as resolveDbPath } from '@/paths.ts';
import { applyFreshSchema, CURRENT_VERSION, checkVersion } from './schema.ts';

let db: Database | null = null;

/**
 * Open (or return the cached) database connection.
 * On first open:
 *   1. Creates parent directory if needed.
 *   2. Opens the database file (bun:sqlite creates the file on open).
 *   3. Sets 0600 permissions immediately after file creation.
 *   4. Enables WAL mode.
 *   5. Checks schema version:
 *      - version=0 (fresh): applies schema, stamps CURRENT_VERSION.
 *      - version=CURRENT_VERSION: nothing to do.
 *      - version mismatch: closes DB, renames file to <path>.v<old_version>,
 *        opens a fresh DB, applies schema. Logs warning to stderr.
 */
export function openDb(dbPath?: string): Database {
  if (db !== null) return db;

  const path = dbPath ?? resolveDbPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  db = openAndInit(path);
  return db;
}

/**
 * Open a single DB file, enable WAL, and apply schema.
 * Handles version mismatch by backing up and recreating.
 * Returns a ready-to-use Database.
 */
function openAndInit(path: string): Database {
  const isNew = !existsSync(path);
  let conn = new Database(path);

  if (isNew) {
    // Set 0600 immediately after file creation
    chmodSync(path, 0o600);
  }

  // Enable WAL mode on every connection open
  conn.exec('PRAGMA journal_mode=wal;');

  const status = checkVersion(conn);

  if (status === 'fresh') {
    applyFreshSchema(conn);
    return conn;
  }

  if (status === 'ok') {
    return conn;
  }

  // status === "mismatch": backup old DB, open fresh one
  const versionRow = conn.query('PRAGMA user_version;').get() as { user_version: number };
  const oldVersion = versionRow.user_version;
  const backupPath = `${path}.v${oldVersion}`;
  process.stderr.write(
    `[hookwatch] WARNING: DB schema version ${oldVersion} does not match expected ${CURRENT_VERSION}. ` +
      `Backing up to ${backupPath} and creating fresh database.\n`,
  );

  // Close before rename so WAL is flushed and the file can be moved
  conn.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  conn.close();

  try {
    renameSync(path, backupPath);

    // Open a brand-new database at the original path
    conn = new Database(path);
    chmodSync(path, 0o600);
    conn.exec('PRAGMA journal_mode=wal;');
    applyFreshSchema(conn);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[hookwatch] ERROR: Failed to create new database after version mismatch backup. ` +
        `Old data preserved at ${backupPath}. Error: ${message}\n`,
    );
    throw err;
  }

  return conn;
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
