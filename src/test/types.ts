/**
 * Shared type definitions for hookwatch test utilities.
 *
 * These types are used across integration and E2E test files.
 * Exported via @/test barrel (src/test/index.ts).
 */

import { expect } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import type { HookEvent } from '@/schemas/events.ts';

// ---------------------------------------------------------------------------
// Deliberate test-boundary casts
// ---------------------------------------------------------------------------

/**
 * Parsed stdout from a hookwatch handler subprocess.
 * JSON.parse returns `any` — this cast is a deliberate test boundary:
 * we verify the shape through assertions, not static typing.
 */
export type ParsedHandlerOutput = Record<string, unknown>;

/**
 * Parsed event with dynamic field access for test assertions.
 * Zod parse returns a union — this cast is a deliberate test boundary:
 * the test is verifying specific fields exist with specific values.
 */
export type ParsedEventFields = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Event type narrowing
// ---------------------------------------------------------------------------

/**
 * Narrow a parsed event to a specific type, failing the test if the
 * hook_event_name does not match. The single deliberate cast lives here
 * instead of being scattered across every test assertion.
 */
export function expectEventType<T extends HookEvent>(
  event: HookEvent,
  name: T['hook_event_name'],
): T {
  expect(event.hook_event_name).toBe(name);
  return event as T;
}

// ---------------------------------------------------------------------------
// SQLite PRAGMA result types
// ---------------------------------------------------------------------------

/** PRAGMA user_version result row — cast is deliberate: bun:sqlite returns untyped rows. */
export type PragmaUserVersion = { user_version: number };

/** PRAGMA table_info result row — cast is deliberate: bun:sqlite returns untyped rows. */
export type PragmaTableInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

/**
 * A handle to a running hookwatch server subprocess.
 *
 * The proc type parameter allows the same interface to be used by both
 * Playwright E2E tests (proc: ChildProcess from node:child_process) and
 * bun:test integration tests (proc: ReturnType<typeof Bun.spawn>).
 * Defaults to ChildProcess for Playwright tests.
 */
export interface ServerHandle<P = ChildProcess> {
  port: number;
  xdgDataHome: string;
  proc: P;
  baseUrl: string;
  stop: () => void;
}
