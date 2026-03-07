import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, openDb } from "./connection.ts";
import { getAllEvents, getEventById, insertEvent } from "./queries.ts";

/**
 * Create a temporary directory for each test to get isolated DB files.
 */
function _makeTempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "hookwatch-test-"));
  return join(dir, "hookwatch.db");
}

describe("database creation and WAL mode", () => {
  let tmpDir: string;

  beforeEach(() => {
    close(); // reset singleton
    tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-test-"));
  });

  afterEach(() => {
    close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates database file on first open", () => {
    const dbPath = join(tmpDir, "hookwatch.db");
    const db = openDb(dbPath);
    expect(db).toBeDefined();

    const { existsSync } = require("node:fs");
    expect(existsSync(dbPath)).toBe(true);
  });

  test("enables WAL journal mode", () => {
    const dbPath = join(tmpDir, "hookwatch.db");
    const db = openDb(dbPath);

    const row = db.query("PRAGMA journal_mode;").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
  });

  test("sets user_version to 1 after schema application", () => {
    const dbPath = join(tmpDir, "hookwatch.db");
    const db = openDb(dbPath);

    const row = db.query("PRAGMA user_version;").get() as { user_version: number };
    expect(row.user_version).toBe(2);
  });
});

describe("events table existence and structure", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    close();
    tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-test-"));
    dbPath = join(tmpDir, "hookwatch.db");
  });

  afterEach(() => {
    close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("events table exists with all required columns", () => {
    const db = openDb(dbPath);
    const rows = db.query("PRAGMA table_info(events);").all() as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;

    const cols = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(cols.id).toBeDefined();
    expect(cols.timestamp).toBeDefined();
    expect(cols.event).toBeDefined();
    expect(cols.session_id).toBeDefined();
    expect(cols.cwd).toBeDefined();
    expect(cols.tool_name).toBeDefined();
    expect(cols.session_name).toBeDefined();
    expect(cols.hook_duration_ms).toBeDefined();
    expect(cols.stdin).toBeDefined();
    expect(cols.wrapped_command).toBeDefined();
    expect(cols.stdout).toBeDefined();
    expect(cols.stderr).toBeDefined();
    expect(cols.exit_code).toBeDefined();
    expect(cols.hookwatch_error).toBeDefined();
  });

  test("required columns are NOT NULL", () => {
    const db = openDb(dbPath);
    const rows = db.query("PRAGMA table_info(events);").all() as Array<{
      name: string;
      notnull: number;
    }>;

    const cols = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(cols.timestamp?.notnull).toBe(1);
    expect(cols.event?.notnull).toBe(1);
    expect(cols.session_id?.notnull).toBe(1);
    expect(cols.cwd?.notnull).toBe(1);
    expect(cols.stdin?.notnull).toBe(1);
  });

  test("nullable columns allow NULL", () => {
    const db = openDb(dbPath);
    const rows = db.query("PRAGMA table_info(events);").all() as Array<{
      name: string;
      notnull: number;
    }>;

    const cols = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(cols.tool_name?.notnull).toBe(0);
    expect(cols.session_name?.notnull).toBe(0);
    expect(cols.hook_duration_ms?.notnull).toBe(0);
    expect(cols.wrapped_command?.notnull).toBe(0);
    expect(cols.stdout?.notnull).toBe(0);
    expect(cols.stderr?.notnull).toBe(0);
    expect(cols.exit_code?.notnull).toBe(0);
    expect(cols.hookwatch_error?.notnull).toBe(0);
  });
});

describe("insert and retrieve round-trip", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    close();
    tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-test-"));
    dbPath = join(tmpDir, "hookwatch.db");
  });

  afterEach(() => {
    close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("inserts an event and retrieves it by id", () => {
    const db = openDb(dbPath);
    const payload = JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: "sess-001",
      cwd: "/tmp/project",
      tool_name: "Bash",
      tool_input: { command: "ls" },
    });

    const id = insertEvent(db, {
      timestamp: Date.now(),
      event: "PreToolUse",
      session_id: "sess-001",
      cwd: "/tmp/project",
      tool_name: "Bash",
      session_name: null,
      hook_duration_ms: 42,
      stdin: payload,
      wrapped_command: null,
      stdout: null,
      stderr: null,
      exit_code: null,
      hookwatch_error: null,
    });

    expect(id).toBeGreaterThan(0);

    const row = getEventById(db, id);
    expect(row).not.toBeNull();
    expect(row?.event).toBe("PreToolUse");
    expect(row?.session_id).toBe("sess-001");
    expect(row?.cwd).toBe("/tmp/project");
    expect(row?.tool_name).toBe("Bash");
    expect(row?.hook_duration_ms).toBe(42);
    expect(row?.stdin).toBe(payload);
  });

  test("inserts event with null optional fields", () => {
    const db = openDb(dbPath);
    const id = insertEvent(db, {
      timestamp: Date.now(),
      event: "SessionStart",
      session_id: "sess-002",
      cwd: "/tmp",
      tool_name: null,
      session_name: null,
      hook_duration_ms: null,
      stdin: JSON.stringify({ hook_event_name: "SessionStart" }),
      wrapped_command: null,
      stdout: null,
      stderr: null,
      exit_code: null,
      hookwatch_error: null,
    });

    const row = getEventById(db, id);
    expect(row).not.toBeNull();
    expect(row?.tool_name).toBeNull();
    expect(row?.session_name).toBeNull();
    expect(row?.hook_duration_ms).toBeNull();
    expect(row?.wrapped_command).toBeNull();
    expect(row?.stdout).toBeNull();
    expect(row?.stderr).toBeNull();
    expect(row?.exit_code).toBeNull();
    expect(row?.hookwatch_error).toBeNull();
  });

  test("persists events after close and reopen", () => {
    const db = openDb(dbPath);
    const id = insertEvent(db, {
      timestamp: 1000000,
      event: "SessionEnd",
      session_id: "sess-persist",
      cwd: "/home/user",
      tool_name: null,
      session_name: "my-session",
      hook_duration_ms: 10,
      stdin: JSON.stringify({ hook_event_name: "SessionEnd" }),
      wrapped_command: null,
      stdout: null,
      stderr: null,
      exit_code: null,
      hookwatch_error: null,
    });

    // Close the connection
    close();

    // Reopen
    const db2 = openDb(dbPath);
    const row = getEventById(db2, id);

    expect(row).not.toBeNull();
    expect(row?.timestamp).toBe(1000000);
    expect(row?.event).toBe("SessionEnd");
    expect(row?.session_id).toBe("sess-persist");
    expect(row?.session_name).toBe("my-session");
  });

  test("getAllEvents returns all inserted events ordered by ts", () => {
    const db = openDb(dbPath);

    insertEvent(db, {
      timestamp: 3000,
      event: "PostToolUse",
      session_id: "s1",
      cwd: "/",
      tool_name: "Read",
      session_name: null,
      hook_duration_ms: null,
      stdin: "{}",
      wrapped_command: null,
      stdout: null,
      stderr: null,
      exit_code: null,
      hookwatch_error: null,
    });

    insertEvent(db, {
      timestamp: 1000,
      event: "PreToolUse",
      session_id: "s1",
      cwd: "/",
      tool_name: "Bash",
      session_name: null,
      hook_duration_ms: null,
      stdin: "{}",
      wrapped_command: null,
      stdout: null,
      stderr: null,
      exit_code: null,
      hookwatch_error: null,
    });

    insertEvent(db, {
      timestamp: 2000,
      event: "SessionStart",
      session_id: "s1",
      cwd: "/",
      tool_name: null,
      session_name: null,
      hook_duration_ms: null,
      stdin: "{}",
      wrapped_command: null,
      stdout: null,
      stderr: null,
      exit_code: null,
      hookwatch_error: null,
    });

    const events = getAllEvents(db);
    expect(events.length).toBe(3);
    expect(events[0]?.timestamp).toBe(1000);
    expect(events[1]?.timestamp).toBe(2000);
    expect(events[2]?.timestamp).toBe(3000);
  });
});

describe("schema idempotency", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    close();
    tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-test-"));
    dbPath = join(tmpDir, "hookwatch.db");
  });

  afterEach(() => {
    close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("opening the same database twice does not fail", () => {
    // First open: schema applied
    openDb(dbPath);
    close();

    // Second open: schema already at CURRENT_VERSION, no re-application
    expect(() => {
      openDb(dbPath);
    }).not.toThrow();

    const db = openDb(dbPath);
    const row = db.query("PRAGMA user_version;").get() as { user_version: number };
    expect(row.user_version).toBe(2);
  });
});
