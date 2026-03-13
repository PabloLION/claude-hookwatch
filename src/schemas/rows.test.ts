/**
 * Tests for src/schemas/rows.ts
 *
 * Coverage:
 * - eventRowSchema parses a valid full EventRow payload
 * - eventRowSchema preserves nullable fields as null
 * - parseEventRow parses a valid object into an EventRow with KnownEventName
 * - parseEventRow throws ZodError on missing required fields
 * - parseEventRow normalizes unknown event names to 'unknown'
 * - parseSseEvent parses valid JSON into an EventRow
 * - parseSseEvent throws SyntaxError on non-JSON input
 * - parseSseEvent throws ZodError on missing required fields
 * - .loose() preserves unknown fields from future DB columns
 */

import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import type { ParsedEventFields } from '@/test/types.ts';
import { eventRowSchema, parseEventRow, parseSseEvent } from './rows.ts';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** Arbitrary numeric SSE event ID — representative of auto-increment DB IDs. */
const TEST_EVENT_ID = 42;
/** Millisecond timestamp for 2026-03-13 00:00:00 UTC — arbitrary fixed value. */
const TEST_TIMESTAMP = 1741824000000;
/** Session ID used across test fixtures. */
const TEST_SESSION_ID = 'f8b0e97c-a19e-461a-8290-05a5c03d3d8f';
/** Working directory used across test fixtures. */
const TEST_CWD = '/home/user/project';
/** Minimal stdin JSON for test events. */
const TEST_STDIN = '{"hook_event_name":"SessionStart","session_id":"f8b0e97c"}';

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

/** Minimal valid EventRow with all required fields and nullable fields as null. */
const minimalRow = {
  id: TEST_EVENT_ID,
  timestamp: TEST_TIMESTAMP,
  event: 'SessionStart',
  session_id: TEST_SESSION_ID,
  cwd: TEST_CWD,
  tool_name: null,
  session_name: null,
  hook_duration_ms: null,
  stdin: TEST_STDIN,
  wrapped_command: null,
  stdout: null,
  stderr: null,
  exit_code: 0,
  hookwatch_log: null,
};

// ---------------------------------------------------------------------------
// eventRowSchema — valid rows
// ---------------------------------------------------------------------------

describe('eventRowSchema — minimal valid row', () => {
  test('parses all required fields correctly', () => {
    const result = eventRowSchema.parse(minimalRow);
    expect(result.id).toBe(TEST_EVENT_ID);
    expect(result.timestamp).toBe(TEST_TIMESTAMP);
    expect(result.event).toBe('SessionStart');
    expect(result.session_id).toBe(TEST_SESSION_ID);
    expect(result.cwd).toBe(TEST_CWD);
    expect(result.stdin).toBe(TEST_STDIN);
    expect(result.exit_code).toBe(0);
  });

  test('nullable fields accept null', () => {
    const result = eventRowSchema.parse(minimalRow);
    expect(result.tool_name).toBeNull();
    expect(result.session_name).toBeNull();
    expect(result.hook_duration_ms).toBeNull();
    expect(result.wrapped_command).toBeNull();
    expect(result.stdout).toBeNull();
    expect(result.stderr).toBeNull();
    expect(result.hookwatch_log).toBeNull();
  });
});

describe('eventRowSchema — full row with all optional fields', () => {
  test('wrapped event row with all fields set', () => {
    const result = eventRowSchema.parse({
      ...minimalRow,
      event: 'PreToolUse',
      tool_name: 'Bash',
      session_name: 'my-session',
      hook_duration_ms: 42,
      wrapped_command: 'sh -c echo hi',
      stdout: 'hi\n',
      stderr: '',
      exit_code: 0,
      hookwatch_log: '[warn] exit 137 (likely SIGKILL)',
    });
    expect(result.tool_name).toBe('Bash');
    expect(result.session_name).toBe('my-session');
    expect(result.hook_duration_ms).toBe(42);
    expect(result.wrapped_command).toBe('sh -c echo hi');
    expect(result.stdout).toBe('hi\n');
    expect(result.stderr).toBe('');
    expect(result.exit_code).toBe(0);
    expect(result.hookwatch_log).toBe('[warn] exit 137 (likely SIGKILL)');
  });

  test('unknown event name is accepted (forward compatibility)', () => {
    const result = eventRowSchema.parse({ ...minimalRow, event: 'FutureEvent' });
    expect(result.event).toBe('FutureEvent');
  });
});

describe('eventRowSchema — passthrough preserves unknown fields', () => {
  test('future DB column is preserved', () => {
    const result = eventRowSchema.parse({ ...minimalRow, future_column: 'new-value' });
    const fields = result as ParsedEventFields;
    expect(fields.future_column).toBe('new-value');
  });
});

// ---------------------------------------------------------------------------
// eventRowSchema — validation failures
// ---------------------------------------------------------------------------

describe('eventRowSchema — missing required fields', () => {
  test('missing id is rejected', () => {
    const { id: _id, ...withoutId } = minimalRow;
    expect(() => eventRowSchema.parse(withoutId)).toThrow(ZodError);
  });

  test('missing session_id is rejected', () => {
    const { session_id: _sid, ...withoutSid } = minimalRow;
    expect(() => eventRowSchema.parse(withoutSid)).toThrow(ZodError);
  });

  test('missing stdin is rejected', () => {
    const { stdin: _stdin, ...withoutStdin } = minimalRow;
    expect(() => eventRowSchema.parse(withoutStdin)).toThrow(ZodError);
  });

  test('missing exit_code is rejected', () => {
    const { exit_code: _ec, ...withoutEc } = minimalRow;
    expect(() => eventRowSchema.parse(withoutEc)).toThrow(ZodError);
  });
});

describe('eventRowSchema — type validation', () => {
  test('id must be number — rejects string', () => {
    expect(() => eventRowSchema.parse({ ...minimalRow, id: '42' })).toThrow(ZodError);
  });

  test('timestamp must be number — rejects string', () => {
    expect(() => eventRowSchema.parse({ ...minimalRow, timestamp: '2026-01-01' })).toThrow(
      ZodError,
    );
  });

  test('exit_code must be number — rejects string', () => {
    expect(() => eventRowSchema.parse({ ...minimalRow, exit_code: '0' })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// parseEventRow — Boundary #4 (fetch response object)
// ---------------------------------------------------------------------------

describe('parseEventRow — valid object', () => {
  test('parses a minimal event row object', () => {
    const result = parseEventRow(minimalRow);
    expect(result.id).toBe(TEST_EVENT_ID);
    expect(result.event).toBe('SessionStart');
    expect(result.session_id).toBe(TEST_SESSION_ID);
    expect(result.exit_code).toBe(0);
  });

  test('nullable fields accept null', () => {
    const result = parseEventRow(minimalRow);
    expect(result.tool_name).toBeNull();
    expect(result.session_name).toBeNull();
    expect(result.hook_duration_ms).toBeNull();
    expect(result.wrapped_command).toBeNull();
    expect(result.stdout).toBeNull();
    expect(result.stderr).toBeNull();
    expect(result.hookwatch_log).toBeNull();
  });
});

describe('parseEventRow — unknown event name normalization', () => {
  test('known event name is returned unchanged', () => {
    const result = parseEventRow({ ...minimalRow, event: 'SessionStart' });
    expect(result.event).toBe('SessionStart');
  });

  test('unknown event name is normalized to "unknown"', () => {
    const result = parseEventRow({ ...minimalRow, event: 'FutureEvent' });
    expect(result.event).toBe('unknown');
  });

  test('empty string event name is normalized to "unknown"', () => {
    const result = parseEventRow({ ...minimalRow, event: '' });
    expect(result.event).toBe('unknown');
  });
});

describe('parseEventRow — invalid object', () => {
  test('missing id field throws ZodError', () => {
    const { id: _id, ...withoutId } = minimalRow;
    expect(() => parseEventRow(withoutId)).toThrow(ZodError);
  });

  test('missing session_id field throws ZodError', () => {
    const { session_id: _sid, ...withoutSid } = minimalRow;
    expect(() => parseEventRow(withoutSid)).toThrow(ZodError);
  });

  test('missing exit_code field throws ZodError', () => {
    const { exit_code: _ec, ...withoutEc } = minimalRow;
    expect(() => parseEventRow(withoutEc)).toThrow(ZodError);
  });

  test('undefined input throws ZodError', () => {
    expect(() => parseEventRow(undefined)).toThrow(ZodError);
  });

  test('null input throws ZodError', () => {
    expect(() => parseEventRow(null)).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// parseSseEvent — Boundary #4 (SSE / fetch event data)
// ---------------------------------------------------------------------------

describe('parseSseEvent — valid input', () => {
  test('parses a minimal event row from JSON string', () => {
    const result = parseSseEvent(JSON.stringify(minimalRow));
    expect(result.id).toBe(TEST_EVENT_ID);
    expect(result.event).toBe('SessionStart');
    expect(result.session_id).toBe(TEST_SESSION_ID);
  });

  test('parses a full wrapped event row', () => {
    const fullRow = {
      ...minimalRow,
      event: 'PostToolUse',
      tool_name: 'Read',
      wrapped_command: 'cat /etc/hosts',
      stdout: '127.0.0.1 localhost\n',
      stderr: '',
      exit_code: 0,
    };
    const result = parseSseEvent(JSON.stringify(fullRow));
    expect(result.tool_name).toBe('Read');
    expect(result.wrapped_command).toBe('cat /etc/hosts');
  });

  test('unknown event name in JSON is normalized to "unknown"', () => {
    const result = parseSseEvent(JSON.stringify({ ...minimalRow, event: 'FutureEvent' }));
    expect(result.event).toBe('unknown');
  });
});

describe('parseSseEvent — error handling', () => {
  test('non-JSON string throws SyntaxError', () => {
    expect(() => parseSseEvent('not-json')).toThrow(SyntaxError);
  });

  test('empty string throws SyntaxError', () => {
    expect(() => parseSseEvent('')).toThrow(SyntaxError);
  });

  test('missing required field throws ZodError', () => {
    const { id: _id, ...withoutId } = minimalRow;
    expect(() => parseSseEvent(JSON.stringify(withoutId))).toThrow(ZodError);
  });

  test('wrong type for id throws ZodError', () => {
    expect(() => parseSseEvent(JSON.stringify({ ...minimalRow, id: 'not-a-number' }))).toThrow(
      ZodError,
    );
  });
});

describe('parseSseEvent — passthrough preserves unknown fields', () => {
  test('future DB column is preserved', () => {
    const result = parseSseEvent(JSON.stringify({ ...minimalRow, future_column: 'v2-data' }));
    const fields = result as ParsedEventFields;
    expect(fields.future_column).toBe('v2-data');
  });
});
