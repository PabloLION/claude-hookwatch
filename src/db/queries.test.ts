/**
 * Unit tests for src/db/queries.ts — getDistinctSessions (ch-6my) and
 * timestamp index usage verification (ch-ehym).
 *
 * Tests for insertEvent, getEventById, getAllEvents are co-located in
 * schema.test.ts (Story 1.1). This file covers getDistinctSessions added in
 * Story 2.2, and EXPLAIN QUERY PLAN assertions for idx_events_timestamp.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { closeTestDb, makeEvent, setupTestDb, type TestDbHandle } from '@/test';
import type { openDb } from './connection.ts';
import { getDistinctSessions, insertEvent, queryEvents } from './queries.ts';

// ---------------------------------------------------------------------------
// getDistinctSessions tests
// ---------------------------------------------------------------------------

describe('getDistinctSessions', () => {
  let handle: TestDbHandle;

  beforeEach(() => {
    handle = setupTestDb('hookwatch-queries-test-');
  });

  afterEach(() => {
    closeTestDb(handle);
  });

  test('returns empty array when no events exist', () => {
    const sessions = getDistinctSessions(handle.db);
    expect(sessions).toEqual([]);
  });

  test('returns a single session when all events share one session_id', () => {
    const db = handle.db;
    insertEvent(db, makeEvent({ session_id: 'sess-aaa', timestamp: 1000 }));
    insertEvent(db, makeEvent({ session_id: 'sess-aaa', timestamp: 2000 }));
    insertEvent(db, makeEvent({ session_id: 'sess-aaa', timestamp: 3000 }));

    const sessions = getDistinctSessions(db);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toBe('sess-aaa');
  });

  test('returns each session ID exactly once', () => {
    const db = handle.db;
    insertEvent(db, makeEvent({ session_id: 'sess-aaa', timestamp: 1000 }));
    insertEvent(db, makeEvent({ session_id: 'sess-bbb', timestamp: 2000 }));
    insertEvent(db, makeEvent({ session_id: 'sess-aaa', timestamp: 3000 }));
    insertEvent(db, makeEvent({ session_id: 'sess-ccc', timestamp: 4000 }));
    insertEvent(db, makeEvent({ session_id: 'sess-bbb', timestamp: 5000 }));

    const sessions = getDistinctSessions(db);
    expect(sessions).toHaveLength(3);
    // Dedup — no duplicate values
    const unique = new Set(sessions);
    expect(unique.size).toBe(3);
    expect(unique.has('sess-aaa')).toBe(true);
    expect(unique.has('sess-bbb')).toBe(true);
    expect(unique.has('sess-ccc')).toBe(true);
  });

  test('orders by timestamp DESC — session with most recent event appears first', () => {
    const db = handle.db;
    // sess-old has only an old event (timestamp=100)
    insertEvent(db, makeEvent({ session_id: 'sess-old', timestamp: 100 }));
    // sess-mid has a mid-range event (timestamp=500)
    insertEvent(db, makeEvent({ session_id: 'sess-mid', timestamp: 500 }));
    // sess-new has the most recent event (timestamp=9999)
    insertEvent(db, makeEvent({ session_id: 'sess-new', timestamp: 9999 }));

    const sessions = getDistinctSessions(db);
    expect(sessions[0]).toBe('sess-new');
    expect(sessions[1]).toBe('sess-mid');
    expect(sessions[2]).toBe('sess-old');
  });

  test('ordering by timestamp DESC with multiple events per session uses latest timestamp for ordering', () => {
    const db = handle.db;
    // sess-a has events at timestamp=10 and timestamp=5000
    insertEvent(db, makeEvent({ session_id: 'sess-a', timestamp: 10 }));
    insertEvent(db, makeEvent({ session_id: 'sess-a', timestamp: 5000 }));
    // sess-b has only timestamp=100
    insertEvent(db, makeEvent({ session_id: 'sess-b', timestamp: 100 }));

    const sessions = getDistinctSessions(db);
    // sess-a should appear first because its most recent event (5000) > sess-b's (100)
    expect(sessions[0]).toBe('sess-a');
    expect(sessions[1]).toBe('sess-b');
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

describe('timestamp index usage (EXPLAIN QUERY PLAN)', () => {
  let handle: TestDbHandle;

  beforeEach(() => {
    handle = setupTestDb('hookwatch-idx-test-');
  });

  afterEach(() => {
    closeTestDb(handle);
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
    const usesIndex = planRows.some((r) => r.detail.includes('idx_events_timestamp'));
    expect(
      usesIndex,
      `Expected EXPLAIN QUERY PLAN to reference idx_events_timestamp.\nSQL: ${sql}\nPlan: ${JSON.stringify(planRows, null, 2)}`,
    ).toBe(true);
  }

  test('getAllEvents (ORDER BY timestamp ASC) uses idx_events_timestamp', () => {
    assertUsesTimestampIndex(handle.db, 'SELECT * FROM events ORDER BY timestamp ASC');
  });

  test('queryEvents default sort (ORDER BY timestamp DESC LIMIT ? OFFSET ?) uses idx_events_timestamp', () => {
    assertUsesTimestampIndex(
      handle.db,
      'SELECT * FROM events ORDER BY timestamp DESC LIMIT ? OFFSET ?',
      [100, 0],
    );
  });

  test('queryEvents runtime: returns rows ordered by timestamp DESC', () => {
    const db = handle.db;

    // Insert events out of order
    insertEvent(
      db,
      makeEvent({ session_id: 's-idx', timestamp: 3000, event: 'PostToolUse', tool_name: 'Read' }),
    );
    insertEvent(db, makeEvent({ session_id: 's-idx', timestamp: 1000 }));
    insertEvent(
      db,
      makeEvent({ session_id: 's-idx', timestamp: 2000, event: 'PreToolUse', tool_name: 'Bash' }),
    );

    const rows = queryEvents(db, { limit: 100, offset: 0 });
    expect(rows).toHaveLength(3);
    // Newest first
    expect(rows[0]?.timestamp).toBe(3000);
    expect(rows[1]?.timestamp).toBe(2000);
    expect(rows[2]?.timestamp).toBe(1000);
  });

  test('getDistinctSessions scan uses idx_events_timestamp', () => {
    assertUsesTimestampIndex(
      handle.db,
      'SELECT DISTINCT session_id FROM events ORDER BY timestamp DESC',
    );
  });
});
