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
 *   - Exit code must be 0 or 2 (never 1 or other values)
 *   - Exit 0: stdout is either empty, valid hook JSON, or child-output prefix + hook JSON
 *     The hook JSON (if present) must have continue: boolean.
 *     In wrapped mode, child stdout precedes the hook JSON — the helper
 *     extracts the last JSON object from stdout before validating.
 *   - Exit 2: stdout must be valid JSON with a hookwatch_fatal field (fatal error)
 *
 * Call this in every test that invokes runHandler() or runHandlerWrapped()
 * to enforce the contract globally.
 */
export function assertExitLegality(result: RunResult, context = ""): void {
  const tag = context ? ` [${context}]` : "";

  // Exit code must be 0 or 2
  expect(result.exitCode, `exit code must be 0 or 2${tag}`).toSatisfy(
    (code: number | null) => code === 0 || code === 2,
  );

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
  } else if (result.exitCode === 2) {
    // Exit 2: stdout must be valid JSON with hookwatch_fatal field
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Exit 2 stdout must be valid JSON${tag}. Got: ${result.stdout}`);
    }
    const obj = parsed as Record<string, unknown>;
    expect(typeof obj.hookwatch_fatal, `Exit 2 stdout must have hookwatch_fatal string${tag}`).toBe(
      "string",
    );
  }
}
