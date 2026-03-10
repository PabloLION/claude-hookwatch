/**
 * Assertion helpers for handler exit code contracts.
 *
 * Shared by handler.test.ts, post-event.test.ts, and any other test that
 * runs the handler as a subprocess and needs to verify the exit code / stdout
 * contract.
 */

import { expect } from "bun:test";
import type { RunResult } from "./subprocess.ts";

/**
 * Validates that a handler result obeys the exit code contract:
 *
 * Bare mode (hookwatch itself):
 *   - Always exits 0. Hookwatch never exits non-zero in bare mode.
 *   - Exit 0 success: stdout is valid hook JSON with continue: boolean,
 *     OR empty (if called very early before output was written).
 *   - Exit 0 fatal (server unreachable, parse failure, etc.): stdout is JSON
 *     with hookwatch_fatal: string AND continue: true.
 *     Claude Code only parses stdout JSON at exit 0 — using exit 0 + systemMessage
 *     makes errors visible without ever blocking Claude Code (passive observer).
 *
 * Wrapped mode (child pass-through):
 *   - May exit with any code 0-255 (forwarding the child's exit code).
 *   - Exit 0: stdout may contain child output prefix + hook JSON.
 *   - Non-zero: stdout may contain child output only (hook JSON not written).
 *
 * In wrapped mode, child stdout precedes the hook JSON — the helper extracts
 * the last JSON object from stdout before validating.
 *
 * Call this in every test that invokes runHandler() or runHandlerWrapped()
 * to enforce the contract globally.
 */
export function assertExitLegality(result: RunResult, context = ""): void {
  const tag = context ? ` [${context}]` : "";

  // Exit code must be a valid unix value (0-255) — null means the process
  // was killed without an exit code (only happens on unexpected SIGKILL).
  expect(result.exitCode, `exit code must not be null${tag}`).not.toBeNull();

  if (result.exitCode === 0) {
    // Exit 0: stdout may be empty or contain hook JSON (optionally after child output)
    if (result.stdout !== "") {
      // Try full parse first; if that fails, try to extract the last JSON object
      // (handles wrapped mode where child stdout precedes hook JSON).
      let parsed: unknown;
      let parseError: string | null = null;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        // Try extracting the last '{...}' block
        const lastBrace = result.stdout.lastIndexOf("{");
        if (lastBrace !== -1) {
          try {
            parsed = JSON.parse(result.stdout.slice(lastBrace));
          } catch {
            parseError = result.stdout;
          }
        } else {
          parseError = result.stdout;
        }
      }
      if (parseError !== null) {
        throw new Error(`Exit 0 stdout must be valid JSON or empty${tag}. Got: ${parseError}`);
      }
      const obj = parsed as Record<string, unknown>;
      expect(typeof obj.continue, `Exit 0 stdout.continue must be boolean${tag}`).toBe("boolean");
    }
  }
  // Non-zero exit codes are valid in wrapped mode (child pass-through).
  // No stdout contract enforced — child stdout may appear before any hook JSON,
  // and if the server was unreachable the hook JSON was never written.
}
