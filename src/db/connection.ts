import { Database } from 'bun:sqlite';
import { chmodSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { errorMsg } from '@/errors.ts';
import { dbPath as resolveDbPath } from '@/paths.ts';
import { applyFreshSchema, CURRENT_VERSION, checkVersion } from './schema.ts';

/** File permission mode: owner read+write only (no group/other access). */
const DB_FILE_MODE = 0o600;

let db: Database | null = null;
let activePath: string | null = null;

/**
 * Open (or return the cached) database connection.
 *
 * **First-call-wins singleton**: `dbPath` is only honoured on the very first
 * call. Every subsequent call returns the already-open connection and ignores
 * any `dbPath` argument. Callers that need a specific path must pass it on
 * the first call (or ensure the first call happens via the default path).
 *
 * On first open:
 *   1. Creates parent directory if needed.
 *   2. Opens the database file (bun:sqlite creates the file on open).
 *   3. Sets 0600 permissions (new and recreated files).
 *   4. Enables WAL mode.
 *   5. Checks schema version:
 *      - version=0 (fresh): applies schema, stamps CURRENT_VERSION.
 *      - version=CURRENT_VERSION: nothing to do.
 *      - version mismatch: closes DB, renames file to <path>.v<old_version>,
 *        opens a fresh DB, applies schema. Logs warning to stderr.
 */
export function openDb(dbPath?: string): Database {
  if (db !== null) {
    if (dbPath !== undefined && dbPath !== activePath) {
      process.stderr.write(
        `[hookwatch] [warn] openDb: singleton already open at ${activePath}, ignoring requested path ${dbPath}\n`,
      );
    }
    return db;
  }

  const path = dbPath ?? resolveDbPath();
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  db = openAndInit(path);
  activePath = path;
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
    chmodSync(path, DB_FILE_MODE);
  }

  // Enable WAL mode on every connection open
  conn.run('PRAGMA journal_mode=wal;');

  const status = checkVersion(conn);

  if (status === 'fresh') {
    applyFreshSchema(conn);
    return conn;
  }

  if (status === 'ok') {
    return conn;
  }

  if (status !== 'mismatch') {
    // Exhaustive check: adding a new VersionStatus without handling it here
    // produces a compile error (never is not assignable to VersionStatus).
    const _exhaustive: never = status;
    throw new Error(`Unhandled version status: ${String(_exhaustive)}`);
  }

  // status === "mismatch": backup old DB, open fresh one
  const versionRow = conn.query<{ user_version: number }, []>('PRAGMA user_version;').get();
  if (versionRow === null) {
    throw new Error('PRAGMA user_version returned no rows — database may be corrupted');
  }
  const oldVersion = versionRow.user_version;
  let backupPath = `${path}.v${oldVersion}`;
  if (existsSync(backupPath)) {
    backupPath = `${backupPath}.${Date.now()}`;
  }
  process.stderr.write(
    `[hookwatch] WARNING: DB schema version ${oldVersion} does not match expected ${CURRENT_VERSION}. ` +
      `Backing up to ${backupPath} and creating fresh database.\n`,
  );

  // Close before rename so WAL is flushed and the file can be moved
  try {
    conn.run('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    conn.close();
  }

  try {
    renameSync(path, backupPath);

    // Open a brand-new database at the original path
    conn = new Database(path);
    chmodSync(path, DB_FILE_MODE);
    conn.run('PRAGMA journal_mode=wal;');
    applyFreshSchema(conn);
  } catch (err) {
    process.stderr.write(
      `[hookwatch] ERROR: Failed to create new database after version mismatch backup. ` +
        `Old data preserved at ${backupPath}. Error: ${errorMsg(err)}\n`,
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
    activePath = null;
  }
}
