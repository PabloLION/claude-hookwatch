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
// Deliberate test-boundary cast types
// ---------------------------------------------------------------------------

/**
 * Dynamic field access for test assertions on parsed events.
 * Zod parse returns a typed union, but passthrough tests need to access
 * fields that are not in the static type.
 */
export type ParsedEventFields = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Event type narrowing
// ---------------------------------------------------------------------------

/**
 * Narrow a parsed HookEvent to a specific event type, failing the test
 * if hook_event_name does not match.
 */
export function expectEventType<T extends HookEvent>(
  event: HookEvent,
  name: T['hook_event_name'],
): T {
  expect(event.hook_event_name).toBe(name);
  return event as T;
}

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
