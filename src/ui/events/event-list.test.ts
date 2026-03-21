/**
 * Unit tests for event-list.ts — RowEntry construction utilities.
 *
 * Coverage:
 * - nextInvalidRowKey() produces unique negative keys
 * - Keys assigned at construction time never shift (stable across prepends)
 * - Invalid RowEntry variant carries key, raw, and error fields
 * - _resetInvalidKeyCounter() resets module state for test isolation
 *
 * Note: The EventList component and fetchEvents function require browser APIs
 * (EventSource, fetch) and a running server — those are covered by Playwright
 * E2E tests in tests/sse-stream.test.ts and tests/ui-e2e.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { _resetInvalidKeyCounter, nextInvalidRowKey } from './event-list.ts';

// ---------------------------------------------------------------------------
// nextInvalidRowKey — counter behavior
// ---------------------------------------------------------------------------

describe('nextInvalidRowKey — unique negative keys', () => {
  test('returns a negative value on first call', () => {
    const key = nextInvalidRowKey();
    expect(key).toBeLessThan(0);
  });

  test('each call returns a strictly smaller (more negative) value', () => {
    const a = nextInvalidRowKey();
    const b = nextInvalidRowKey();
    expect(b).toBeLessThan(a);
  });

  test('successive calls produce distinct values', () => {
    const keys = Array.from({ length: 10 }, () => nextInvalidRowKey());
    const unique = new Set(keys);
    expect(unique.size).toBe(10);
  });

  test('all returned values are negative', () => {
    const keys = Array.from({ length: 5 }, () => nextInvalidRowKey());
    for (const key of keys) {
      expect(key).toBeLessThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// RowEntry construction — invalid variant carries stable key
// ---------------------------------------------------------------------------

describe('invalid RowEntry construction', () => {
  test('invalid entry stores a negative key assigned at construction time', () => {
    const key = nextInvalidRowKey();
    const entry = { valid: false as const, raw: { some: 'data' }, error: 'ZodError: …', key };

    // key is stable — stored on the entry, not re-derived from array position
    expect(entry.key).toBe(key);
    expect(entry.key).toBeLessThan(0);
  });

  test('two invalid entries get different keys even when constructed back-to-back', () => {
    const key1 = nextInvalidRowKey();
    const key2 = nextInvalidRowKey();

    const entry1 = { valid: false as const, raw: null, error: 'first error', key: key1 };
    const entry2 = { valid: false as const, raw: null, error: 'second error', key: key2 };

    expect(entry1.key).not.toBe(entry2.key);
  });

  test('prepending a new valid entry to an array does not change the key on an existing invalid entry', () => {
    // Simulates what SSE prepend does: [newEntry, ...existing]
    const key = nextInvalidRowKey();
    const invalidEntry = { valid: false as const, raw: 'bad data', error: 'parse error', key };

    const list = [invalidEntry];
    // Prepend a new entry (simulates SSE push)
    const validEntry = { valid: true as const, row: { id: 1 } as never };
    const newList = [validEntry, ...list];

    // The invalid entry is now at index 1, but its key has not changed
    const found = newList.find((e) => !e.valid);
    expect(found).toBeDefined();
    expect((found as typeof invalidEntry).key).toBe(key);
  });

  test('key never collides with positive DB ids', () => {
    // DB ids are always positive auto-increment integers.
    // Invalid row keys are always negative — no collision is structurally possible.
    const keys = Array.from({ length: 20 }, () => nextInvalidRowKey());
    for (const key of keys) {
      expect(key).toBeLessThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// _resetInvalidKeyCounter — test utility for resetting module-level state
// ---------------------------------------------------------------------------

describe('_resetInvalidKeyCounter', () => {
  test('resets counter so the next key is -1', () => {
    // Consume some keys to move the counter past -1
    nextInvalidRowKey();
    nextInvalidRowKey();
    nextInvalidRowKey();

    _resetInvalidKeyCounter();

    // After reset, the next call must return -1 (the initial value)
    const key = nextInvalidRowKey();
    expect(key).toBe(-1);
  });

  test('counter decreases monotonically after reset', () => {
    _resetInvalidKeyCounter();
    const a = nextInvalidRowKey(); // -1
    const b = nextInvalidRowKey(); // -2
    expect(b).toBeLessThan(a);
  });
});
