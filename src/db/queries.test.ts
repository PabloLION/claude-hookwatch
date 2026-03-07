/**
 * Unit tests for src/db/queries.ts — getDistinctSessions (ch-6my) and
 * timestamp index usage verification (ch-ehym).
 *
 * Tests for insertEvent, getEventById, getAllEvents are co-located in
 * schema.test.ts (Story 1.1). This file covers getDistinctSessions added in
 * Story 2.2, and EXPLAIN QUERY PLAN assertions for idx_events_timestamp.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, openDb } from "./connection.ts";
import { getDistinctSessions, insertEvent, queryEvents } from "./queries.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvent(sessionId: string, ts: number) {
  return {
    timestamp: ts,
    event: "SessionStart",
    session_id: sessionId,
    cwd: "/tmp",
    tool_name: null,
    session_name: null,
    hook_duration_ms: null,
    stdin: "{}",
    wrapped_command: null,
    stdout: null,
    stderr: null,
    exit_code: null,
    hookwatch_error: null,
  };
}

// ---------------------------------------------------------------------------
// getDistinctSessions tests
// ---------------------------------------------------------------------------

describe("getDistinctSessions", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    close();
    tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-queries-test-"));
    dbPath = join(tmpDir, "hookwatch.db");
  });

  afterEach(() => {
    close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns empty array when no events exist", () => {
    const db = openDb(dbPath);
    const sessions = getDistinctSessions(db);
    expect(sessions).toEqual([]);
  });

  test("returns a single session when all events share one session_id", () => {
    const db = openDb(dbPath);
    insertEvent(db, makeEvent("sess-aaa", 1000));
    insertEvent(db, makeEvent("sess-aaa", 2000));
    insertEvent(db, makeEvent("sess-aaa", 3000));

    const sessions = getDistinctSessions(db);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toBe("sess-aaa");
  });

  test("returns each session ID exactly once", () => {
    const db = openDb(dbPath);
    insertEvent(db, makeEvent("sess-aaa", 1000));
    insertEvent(db, makeEvent("sess-bbb", 2000));
    insertEvent(db, makeEvent("sess-aaa", 3000));
    insertEvent(db, makeEvent("sess-ccc", 4000));
    insertEvent(db, makeEvent("sess-bbb", 5000));

    const sessions = getDistinctSessions(db);
    expect(sessions).toHaveLength(3);
    // Dedup — no duplicate values
    const unique = new Set(sessions);
    expect(unique.size).toBe(3);
    expect(unique.has("sess-aaa")).toBe(true);
    expect(unique.has("sess-bbb")).toBe(true);
    expect(unique.has("sess-ccc")).toBe(true);
  });

  test("orders by ts DESC — session with most recent event appears first", () => {
    const db = openDb(dbPath);
    // sess-old has only an old event (ts=100)
    insertEvent(db, makeEvent("sess-old", 100));
    // sess-mid has a mid-range event (ts=500)
    insertEvent(db, makeEvent("sess-mid", 500));
    // sess-new has the most recent event (ts=9999)
    insertEvent(db, makeEvent("sess-new", 9999));

    const sessions = getDistinctSessions(db);
    expect(sessions[0]).toBe("sess-new");
    expect(sessions[1]).toBe("sess-mid");
    expect(sessions[2]).toBe("sess-old");
  });

  test("ordering by ts DESC with multiple events per session uses latest ts for ordering", () => {
    const db = openDb(dbPath);
    // sess-a has events at ts=10 and ts=5000
    insertEvent(db, makeEvent("sess-a", 10));
    insertEvent(db, makeEvent("sess-a", 5000));
    // sess-b has only ts=100
    insertEvent(db, makeEvent("sess-b", 100));

    const sessions = getDistinctSessions(db);
    // sess-a should appear first because its most recent event (5000) > sess-b's (100)
    expect(sessions[0]).toBe("sess-a");
    expect(sessions[1]).toBe("sess-b");
  });
});

// ---------------------------------------------------------------------------
// EXPLAIN QUERY PLAN — idx_events_timestamp index usage (ch-ehym)
// ---------------------------------------------------------------------------

/**
 * Represents a row returned by EXPLAIN QUERY PLAN in SQLite.
 * The `detail` field contains the human-readable plan description.
 */
interface QueryPlanRow {
  id: number;
  parent: number;
  notused: number;
  detail: string;
}

describe("timestamp index usage (EXPLAIN QUERY PLAN)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    close();
    tmpDir = mkdtempSync(join(tmpdir(), "hookwatch-idx-test-"));
    dbPath = join(tmpDir, "hookwatch.db");
  });

  afterEach(() => {
    close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Asserts that at least one row of the query plan references
   * idx_events_timestamp, confirming SQLite uses the index for ordering.
   */
  function assertUsesTimestampIndex(
    db: ReturnType<typeof openDb>,
    sql: string,
    bindings: unknown[] = [],
  ): void {
    const planRows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings) as QueryPlanRow[];
    const usesIndex = planRows.some((r) => r.detail.includes("idx_events_timestamp"));
    expect(
      usesIndex,
      `Expected EXPLAIN QUERY PLAN to reference idx_events_timestamp.\nSQL: ${sql}\nPlan: ${JSON.stringify(planRows, null, 2)}`,
    ).toBe(true);
  }

  test("getAllEvents (ORDER BY timestamp ASC) uses idx_events_timestamp", () => {
    const db = openDb(dbPath);
    assertUsesTimestampIndex(db, "SELECT * FROM events ORDER BY timestamp ASC");
  });

  test("queryEvents default sort (ORDER BY timestamp DESC LIMIT ? OFFSET ?) uses idx_events_timestamp", () => {
    const db = openDb(dbPath);
    assertUsesTimestampIndex(
      db,
      "SELECT * FROM events ORDER BY timestamp DESC LIMIT ? OFFSET ?",
      [100, 0],
    );
  });

  test("queryEvents runtime: returns rows ordered by timestamp DESC", () => {
    const db = openDb(dbPath);

    // Insert events out of order
    insertEvent(db, {
      timestamp: 3000,
      event: "PostToolUse",
      session_id: "s-idx",
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
      event: "SessionStart",
      session_id: "s-idx",
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
    insertEvent(db, {
      timestamp: 2000,
      event: "PreToolUse",
      session_id: "s-idx",
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

    const rows = queryEvents(db, { limit: 100, offset: 0 });
    expect(rows).toHaveLength(3);
    // Newest first
    expect(rows[0]?.timestamp).toBe(3000);
    expect(rows[1]?.timestamp).toBe(2000);
    expect(rows[2]?.timestamp).toBe(1000);
  });

  test("getDistinctSessions scan uses idx_events_timestamp", () => {
    const db = openDb(dbPath);
    assertUsesTimestampIndex(db, "SELECT DISTINCT session_id FROM events ORDER BY timestamp DESC");
  });
});
