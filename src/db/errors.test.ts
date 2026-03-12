/**
 * Unit tests for isSqliteBusy() in src/db/errors.ts.
 *
 * isSqliteBusy() detects SQLite SQLITE_BUSY and SQLITE_LOCKED conditions
 * from bun:sqlite Error objects whose message contains the SQLite error string.
 * The match is performed on the uppercased message, so lowercase input works too.
 *
 * Coverage:
 * - non-Error input → false
 * - SQLITE_BUSY in message → true
 * - SQLITE_LOCKED in message → true
 * - case normalization (lowercase input → still matches after toUpperCase) → true
 * - unrelated error message → false
 * - Error with empty message → false
 */

import { describe, expect, test } from 'bun:test';
import { isSqliteBusy } from './errors.ts';

// ---------------------------------------------------------------------------
// Non-Error input
// ---------------------------------------------------------------------------

/** SQLite SQLITE_BUSY error code — tests that the raw code (not wrapped in Error) returns false. */
const SQLITE_BUSY_CODE = 5;

describe('non-Error input', () => {
  test('string input → false', () => {
    expect(isSqliteBusy('SQLITE_BUSY')).toBe(false);
  });

  test('number input → false', () => {
    expect(isSqliteBusy(SQLITE_BUSY_CODE)).toBe(false);
  });

  test('null input → false', () => {
    expect(isSqliteBusy(null)).toBe(false);
  });

  test('undefined input → false', () => {
    expect(isSqliteBusy(undefined)).toBe(false);
  });

  test('plain object with message property → false (not instanceof Error)', () => {
    expect(isSqliteBusy({ message: 'SQLITE_BUSY: database is locked' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SQLITE_BUSY detection
// ---------------------------------------------------------------------------

describe('SQLITE_BUSY message', () => {
  test('exact SQLITE_BUSY message → true', () => {
    expect(isSqliteBusy(new Error('SQLITE_BUSY'))).toBe(true);
  });

  test('SQLITE_BUSY with bun:sqlite suffix → true', () => {
    expect(isSqliteBusy(new Error('SQLITE_BUSY: database is locked'))).toBe(true);
  });

  test('SQLITE_BUSY embedded in longer message → true', () => {
    expect(isSqliteBusy(new Error('SqliteError: SQLITE_BUSY (5)'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SQLITE_LOCKED detection
// ---------------------------------------------------------------------------

describe('SQLITE_LOCKED message', () => {
  test('exact SQLITE_LOCKED message → true', () => {
    expect(isSqliteBusy(new Error('SQLITE_LOCKED'))).toBe(true);
  });

  test('SQLITE_LOCKED with bun:sqlite suffix → true', () => {
    expect(isSqliteBusy(new Error('SQLITE_LOCKED: database table is locked'))).toBe(true);
  });

  test('SQLITE_LOCKED embedded in longer message → true', () => {
    expect(isSqliteBusy(new Error('SqliteError: SQLITE_LOCKED (6)'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Case normalization (lowercase input matches after toUpperCase())
// ---------------------------------------------------------------------------

describe('case normalization', () => {
  test("lowercase 'sqlite_busy' in message → true (toUpperCase normalizes)", () => {
    expect(isSqliteBusy(new Error('sqlite_busy: database is locked'))).toBe(true);
  });

  test("lowercase 'sqlite_locked' in message → true (toUpperCase normalizes)", () => {
    expect(isSqliteBusy(new Error('sqlite_locked: database table is locked'))).toBe(true);
  });

  test("mixed-case 'Sqlite_Busy' in message → true", () => {
    expect(isSqliteBusy(new Error('Sqlite_Busy encountered'))).toBe(true);
  });

  test("mixed-case 'Sqlite_Locked' in message → true", () => {
    expect(isSqliteBusy(new Error('Sqlite_Locked encountered'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-matching errors
// ---------------------------------------------------------------------------

describe('non-matching errors', () => {
  test('unrelated SQLite error → false', () => {
    expect(isSqliteBusy(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed'))).toBe(false);
  });

  test('SQLITE_ERROR (generic) → false', () => {
    expect(isSqliteBusy(new Error('SQLITE_ERROR: no such table: events'))).toBe(false);
  });

  test('SQLITE_CORRUPT → false', () => {
    expect(isSqliteBusy(new Error('SQLITE_CORRUPT: file is not a database'))).toBe(false);
  });

  test('generic Error with empty message → false', () => {
    expect(isSqliteBusy(new Error('generic error'))).toBe(false);
  });

  test("Error about 'busy' without SQLITE_BUSY prefix → false", () => {
    // Ensures we match the compound token, not just the word "busy"
    expect(isSqliteBusy(new Error('server is busy, retry later'))).toBe(false);
  });

  test("Error about 'locked' without SQLITE_LOCKED prefix → false", () => {
    expect(isSqliteBusy(new Error('file is locked by another process'))).toBe(false);
  });
});
