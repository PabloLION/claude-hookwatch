/**
 * Shared test setup helpers for hookwatch tests.
 *
 * Provides:
 *   - createTempXdgHome(): isolated XDG_DATA_HOME temp dir with cleanup
 *   - setupTestDb() / closeTestDb(): DB lifecycle helpers for schema/queries tests
 */

import type { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, openDb } from "@/db/connection.ts";

// ---------------------------------------------------------------------------
// XDG_DATA_HOME isolation
// ---------------------------------------------------------------------------

export interface TempXdgHome {
  /** Absolute path of the temp directory (use as XDG_DATA_HOME). */
  tmpDir: string;
  /** Remove the temp directory and all its contents. */
  cleanup: () => void;
}

/**
 * Creates a temporary directory suitable for use as XDG_DATA_HOME.
 * Each call produces a unique directory, ensuring test isolation.
 *
 * Replaces the 9 inline patterns across schema.test.ts, queries.test.ts,
 * ui.test.ts, and server.test.ts that all do:
 *   tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-test-"))
 *   ...
 *   rmSync(tmpDir, { recursive: true, force: true })
 *
 * Example:
 *   let xdg: TempXdgHome;
 *   beforeEach(() => { xdg = createTempXdgHome(); });
 *   afterEach(() => { xdg.cleanup(); });
 */
export function createTempXdgHome(prefix = "hookwatch-test-"): TempXdgHome {
  const tmpDir = mkdtempSync(join(tmpdir(), prefix));
  return {
    tmpDir,
    cleanup: () => rmSync(tmpDir, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// DB lifecycle helpers
// ---------------------------------------------------------------------------

export interface TestDbHandle {
  /** The open database instance. */
  db: Database;
  /** Absolute path to the DB file (inside a temp dir). */
  dbPath: string;
  /** Temp directory containing the DB — remove on teardown. */
  tmpDir: string;
}

/**
 * Opens a fresh bun:sqlite database in a dedicated temp directory.
 * Resets the DB singleton (close()) before opening to ensure isolation.
 *
 * Intended for use inside beforeEach/afterEach pairs:
 *
 *   let handle: TestDbHandle;
 *   beforeEach(() => { handle = setupTestDb(); });
 *   afterEach(() => { closeTestDb(handle); });
 */
export function setupTestDb(prefix = "hookwatch-test-"): TestDbHandle {
  close(); // reset singleton before each test
  const tmpDir = mkdtempSync(join(tmpdir(), prefix));
  const dbPath = join(tmpDir, "hookwatch.db");
  const db = openDb(dbPath);
  return { db, dbPath, tmpDir };
}

/**
 * Closes the DB connection and removes the temp directory.
 * Call in afterEach after using setupTestDb().
 */
export function closeTestDb(handle: TestDbHandle): void {
  close();
  rmSync(handle.tmpDir, { recursive: true, force: true });
}
