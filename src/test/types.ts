/**
 * Shared type definitions for hookwatch test utilities.
 *
 * These types are used across integration and E2E test files.
 * Exported via @/test barrel (src/test/index.ts).
 */

import type { ChildProcess } from "node:child_process";

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
