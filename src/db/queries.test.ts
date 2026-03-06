/**
 * Unit tests for src/db/queries.ts — getDistinctSessions (ch-6my).
 *
 * Tests for insertEvent, getEventById, getAllEvents are co-located in
 * schema.test.ts (Story 1.1). This file covers getDistinctSessions added in
 * Story 2.2.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, openDb } from "./connection.ts";
import { getDistinctSessions, insertEvent } from "./queries.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEvent(sessionId: string, ts: number) {
  return {
    ts,
    event: "SessionStart",
    session_id: sessionId,
    cwd: "/tmp",
    tool_name: null,
    session_name: null,
    hook_duration_ms: null,
    payload: "{}",
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
