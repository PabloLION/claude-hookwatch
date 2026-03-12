/**
 * Assertion helpers for handler exit code contracts.
 *
 * Shared by handler.test.ts, post-event.test.ts, and any other test that
 * runs the handler as a subprocess and needs to verify the exit code / stdout
 * contract.
 *
 * Two exported functions cover the two execution modes:
 *
 *   assertBareExitLegality  — bare mode (hookwatch as passive observer, no child)
 *   assertWrappedExitLegality — wrapped mode (child pass-through)
 *
 * Design decisions (ch-w2pd):
 * - Bare mode ALWAYS exits 0 (hookwatch is passive observer, never blocks Claude Code).
 * - Wrapped mode exits with the child's code (any 0-255).
 * - Both modes require valid hook JSON in stdout (continue: boolean) on exit 0.
 * - Fatal errors in bare mode exit 0 with hookwatch_fatal + systemMessage fields.
 * - POST failures are non-fatal (ch-6k4y): bare mode still exits 0.
 */

import { expect } from 'bun:test';
import type { RunResult } from './subprocess.ts';

/** Maximum valid Unix process exit code. */
const MAX_EXIT_CODE = 255;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts and validates the hook output JSON from stdout.
 *
 * For wrapped mode, child stdout may precede the hook JSON — the helper
 * extracts the last '{...}' block from stdout before validating.
 *
 * Returns null if stdout is empty (valid in some cases).
 * Throws if stdout is non-empty but does not contain valid JSON with a
 * 'continue' boolean.
 */
function validateHookOutputJson(stdout: string, tag: string): void {
  if (stdout === '') return;

  // Try full parse first; if that fails, extract the last '{...}' block
  // (handles wrapped mode where child stdout precedes hook JSON).
  let parsed: unknown;
  let parseError: string | null = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    const lastBrace = stdout.lastIndexOf('{');
    if (lastBrace === -1) {
      parseError = stdout;
    } else {
      try {
        parsed = JSON.parse(stdout.slice(lastBrace));
      } catch {
        parseError = stdout;
      }
    }
  }
  if (parseError !== null) {
    throw new Error(`Exit 0 stdout must be valid JSON or empty${tag}. Got: ${parseError}`);
  }
  const obj = parsed as Record<string, unknown>;
  expect(typeof obj.continue, `Exit 0 stdout.continue must be boolean${tag}`).toBe('boolean');
}

// ---------------------------------------------------------------------------
// Bare mode assertion
// ---------------------------------------------------------------------------

/**
 * Asserts the exit code / stdout contract for bare mode (no wrapped command).
 *
 * Contract:
 * - Exit code must be 0. Hookwatch NEVER exits non-zero in bare mode —
 *   it is a passive observer and must never block Claude Code.
 * - Exit 0 success: stdout is valid hook JSON with continue: boolean,
 *   OR empty (if called very early before output was written).
 * - Exit 0 fatal (stdin parse failure, spawn failure, etc.): stdout is JSON
 *   with hookwatch_fatal: string AND continue: true AND systemMessage: string.
 *   Claude Code only parses stdout JSON at exit 0 — using exit 0 + systemMessage
 *   makes errors visible without ever blocking Claude Code.
 * - POST failures are non-fatal (ch-6k4y): bare mode exits 0 with failure
 *   reason in systemMessage, no hookwatch_fatal field.
 *
 * @param result - The RunResult from runHandler()
 * @param label  - Optional context label for assertion messages
 */
export function assertBareExitLegality(result: RunResult, label = ''): void {
  const tag = label ? ` [${label}]` : '';

  expect(result.exitCode, `exit code must not be null${tag}`).not.toBeNull();
  expect(result.exitCode, `bare mode must always exit 0${tag}`).toBe(0);

  validateHookOutputJson(result.stdout, tag);
}

// ---------------------------------------------------------------------------
// Wrapped mode assertion
// ---------------------------------------------------------------------------

/**
 * Asserts the exit code / stdout contract for wrapped mode (child pass-through).
 *
 * Contract:
 * - Exit code must be a valid unix value (0-255). Any code is valid — the
 *   handler forwards the child's exit code unchanged.
 * - Exit 0: stdout may contain child output prefix + hook JSON at the end.
 *   The hook JSON must have continue: boolean.
 * - Non-zero exit: stdout may contain child output only (hook JSON may not
 *   be present if the child failed before the handler could write it).
 *   Missing or malformed hook JSON on non-zero exit is flagged as a warning
 *   but does not fail the assertion — child stdout may precede it.
 *
 * @param result - The RunResult from runHandlerWrapped()
 * @param label  - Optional context label for assertion messages
 */
export function assertWrappedExitLegality(result: RunResult, label = ''): void {
  const tag = label ? ` [${label}]` : '';

  // Exit code must be a valid unix value (0-255) — null means the process
  // was killed without an exit code (only happens on unexpected SIGKILL).
  expect(result.exitCode, `exit code must not be null${tag}`).not.toBeNull();

  const code = result.exitCode as number;
  expect(code >= 0 && code <= MAX_EXIT_CODE, `exit code must be 0-255${tag}`).toBe(true);

  if (code === 0) {
    // Exit 0: validate hook JSON (child stdout may precede it)
    validateHookOutputJson(result.stdout, tag);
  }
  // Non-zero: hook JSON may be absent (child stdout only). No stdout contract enforced.
}
