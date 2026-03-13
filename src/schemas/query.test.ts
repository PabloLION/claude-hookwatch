/**
 * Tests for src/schemas/query.ts
 *
 * Coverage:
 * - Valid filter with all fields
 * - Valid filter with no fields (empty object → defaults applied)
 * - Partial filters (only session_id, only limit, etc.)
 * - Limit exceeds 1000 → validation error
 * - Limit is 0 or negative → validation error
 * - Offset is negative → validation error
 * - Extra fields preserved via .loose()
 */

import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import type { ParsedEventFields } from '@/test/types.ts';
import { queryFilterSchema } from './query.ts';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** limit value used in the "all fields" test. */
const TEST_LIMIT_ALL = 50;
/** limit value used in the partial-filter test. */
const TEST_LIMIT_PARTIAL = 25;
/** offset value used in the large-offset test. */
const TEST_OFFSET_LARGE = 200;
/** A very large valid offset used to verify no upper-bound restriction on offset. */
const TEST_OFFSET_VERY_LARGE = 99999;
/** Arbitrary unknown field value for .loose() tests. */
const TEST_UNKNOWN_VALUE = 42;

// ---------------------------------------------------------------------------
// Valid filters
// ---------------------------------------------------------------------------

describe('queryFilterSchema — valid filter with all fields', () => {
  test('all fields provided parse successfully', () => {
    const result = queryFilterSchema.parse({
      session_id: 'f8b0e97c-a19e-461a-8290-05a5c03d3d8f',
      hook_event_name: 'PreToolUse',
      limit: TEST_LIMIT_ALL,
      offset: 10,
    });
    expect(result.session_id).toBe('f8b0e97c-a19e-461a-8290-05a5c03d3d8f');
    expect(result.hook_event_name).toBe('PreToolUse');
    expect(result.limit).toBe(TEST_LIMIT_ALL);
    expect(result.offset).toBe(10);
  });
});

describe('queryFilterSchema — empty object applies defaults', () => {
  test('empty object is valid and applies default limit and offset', () => {
    const result = queryFilterSchema.parse({});
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.session_id).toBeUndefined();
    expect(result.hook_event_name).toBeUndefined();
  });
});

describe('queryFilterSchema — partial filters', () => {
  test('only session_id provided — defaults applied to limit and offset', () => {
    const result = queryFilterSchema.parse({
      session_id: 'abc-123',
    });
    expect(result.session_id).toBe('abc-123');
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    expect(result.hook_event_name).toBeUndefined();
  });

  test('only hook_event_name provided — defaults applied', () => {
    const result = queryFilterSchema.parse({
      hook_event_name: 'SessionStart',
    });
    expect(result.hook_event_name).toBe('SessionStart');
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
  });

  test('only limit provided — offset defaults to 0', () => {
    const result = queryFilterSchema.parse({ limit: TEST_LIMIT_PARTIAL });
    expect(result.limit).toBe(TEST_LIMIT_PARTIAL);
    expect(result.offset).toBe(0);
  });

  test('only offset provided — limit defaults to 100', () => {
    const result = queryFilterSchema.parse({ offset: TEST_OFFSET_LARGE });
    expect(result.offset).toBe(TEST_OFFSET_LARGE);
    expect(result.limit).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Boundary values for limit
// ---------------------------------------------------------------------------

describe('queryFilterSchema — limit boundary values', () => {
  test('limit of 1 is valid (minimum positive integer)', () => {
    const result = queryFilterSchema.parse({ limit: 1 });
    expect(result.limit).toBe(1);
  });

  test('limit of 1000 is valid (maximum allowed)', () => {
    const result = queryFilterSchema.parse({ limit: 1000 });
    expect(result.limit).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Boundary values for offset
// ---------------------------------------------------------------------------

describe('queryFilterSchema — offset boundary values', () => {
  test('offset of 0 is valid (minimum nonneg integer)', () => {
    const result = queryFilterSchema.parse({ offset: 0 });
    expect(result.offset).toBe(0);
  });

  test('large offset is valid', () => {
    const result = queryFilterSchema.parse({ offset: TEST_OFFSET_VERY_LARGE });
    expect(result.offset).toBe(TEST_OFFSET_VERY_LARGE);
  });
});

// ---------------------------------------------------------------------------
// Validation failures
// ---------------------------------------------------------------------------

describe('queryFilterSchema — limit validation failures', () => {
  test('limit exceeding 1000 is rejected', () => {
    expect(() => queryFilterSchema.parse({ limit: 1001 })).toThrow(ZodError);
  });

  test('limit of 0 is rejected (must be positive)', () => {
    expect(() => queryFilterSchema.parse({ limit: 0 })).toThrow(ZodError);
  });

  test('negative limit is rejected', () => {
    expect(() => queryFilterSchema.parse({ limit: -1 })).toThrow(ZodError);
  });

  test('non-integer limit is rejected', () => {
    expect(() => queryFilterSchema.parse({ limit: 10.5 })).toThrow(ZodError);
  });

  test('string limit is rejected', () => {
    expect(() => queryFilterSchema.parse({ limit: '50' })).toThrow(ZodError);
  });
});

describe('queryFilterSchema — offset validation failures', () => {
  test('negative offset is rejected', () => {
    expect(() => queryFilterSchema.parse({ offset: -1 })).toThrow(ZodError);
  });

  test('non-integer offset is rejected', () => {
    expect(() => queryFilterSchema.parse({ offset: 1.5 })).toThrow(ZodError);
  });

  test('string offset is rejected', () => {
    expect(() => queryFilterSchema.parse({ offset: '10' })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// Passthrough — extra fields preserved
// ---------------------------------------------------------------------------

describe('queryFilterSchema — .loose() preserves unknown fields', () => {
  test('extra field is preserved alongside known fields', () => {
    const result = queryFilterSchema.parse({
      session_id: 'abc-123',
      future_filter_field: 'some-value',
    });
    const fields = result as ParsedEventFields;
    expect(fields.future_filter_field).toBe('some-value');
  });

  test('multiple unknown fields are all preserved', () => {
    const result = queryFilterSchema.parse({
      unknown_a: TEST_UNKNOWN_VALUE,
      unknown_b: true,
    });
    const fields = result as ParsedEventFields;
    expect(fields.unknown_a).toBe(TEST_UNKNOWN_VALUE);
    expect(fields.unknown_b).toBe(true);
  });

  test('extra field does not interfere with defaults', () => {
    const result = queryFilterSchema.parse({
      extra: 'preserved',
    });
    expect(result.limit).toBe(100);
    expect(result.offset).toBe(0);
    const fields = result as ParsedEventFields;
    expect(fields.extra).toBe('preserved');
  });
});
