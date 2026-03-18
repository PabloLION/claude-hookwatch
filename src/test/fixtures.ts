/**
 * Shared test fixtures for hookwatch tests.
 *
 * Provides:
 *   - BASE_SESSION_START: minimal valid SessionStart payload
 *   - GENERIC_EVENT_BASE: common required fields shared by all event types
 *   - makeEvent(overrides): factory for EventRow-like DB insert params
 */

import type { EventRow, InsertEventParams } from '@/types.ts';

// ---------------------------------------------------------------------------
// Timestamp constants for sort-order tests
// ---------------------------------------------------------------------------

/** Deliberately out-of-order timestamps to verify sort behavior in tests. */
export const TS_EARLY = 1000;
export const TS_MID = 2000;
export const TS_LATE = 3000;

// ---------------------------------------------------------------------------
// Hook input payloads (stdin to the handler)
// ---------------------------------------------------------------------------

/**
 * Minimal valid SessionStart hook input payload.
 * Used in handler and server tests to represent a real hook invocation.
 */
export const BASE_SESSION_START: Record<string, unknown> = {
  session_id: 'test-session-001',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  hook_event_name: 'SessionStart',
  source: 'startup',
  model: 'claude-sonnet-4-6',
};

/**
 * Common fields shared by all hook event types.
 * Use as a base when building event-specific test payloads.
 */
export const GENERIC_EVENT_BASE: Record<string, unknown> = {
  session_id: 'test-session-001',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
};

// ---------------------------------------------------------------------------
// DB row factory
// ---------------------------------------------------------------------------

/**
 * Creates a full InsertEventParams (compatible with EventRow) with sensible
 * defaults. Pass overrides to customize individual fields.
 *
 * Used by queries.test.ts, stream.test.ts, and any test that needs to insert
 * rows directly into the DB without going through the HTTP server.
 */
export function makeEvent(overrides: Partial<InsertEventParams> = {}): InsertEventParams {
  return {
    timestamp: 1700000000000,
    event: 'SessionStart',
    session_id: 'sess-test-001',
    cwd: '/tmp',
    tool_name: null,
    session_name: null,
    hook_duration_ms: null,
    stdin: '{}',
    wrapped_command: null,
    stdout: null,
    stderr: null,
    exit_code: 0,
    hookwatch_log: null,
    ...overrides,
  };
}

/**
 * Creates a minimal EventRow (read-side) for use in SSE / stream tests.
 * Includes id which InsertEventParams omits.
 * Defaults are derived from makeEvent() to avoid duplicating them.
 */
export function makeEventRow({ id = 1, ...rest }: Partial<EventRow> = {}): EventRow {
  return { id, ...makeEvent(rest) };
}
