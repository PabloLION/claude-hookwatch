/**
 * Zod schemas for validating hook stdout output before sending to Claude Code.
 *
 * Design decisions:
 * - .loose() on ALL schemas — forward-compatible with Claude Code SDK additions.
 *   (.passthrough() was deprecated in Zod v4; .loose() is the replacement.)
 * - systemMessage is optional on all schemas (base and event-specific).
 * - hookSpecificOutput applies only to PreToolUse — not a universal field.
 * - Stop has its own decision/reason fields; no hookSpecificOutput.
 * - All other event types use the base schema (3 standard fields only).
 * - z.record(z.string(), z.unknown()) for arbitrary JSON objects (Zod v4 requires
 *   two arguments; single-arg z.record(z.unknown()) throws TypeError).
 * - parseHookOutput() is the validated factory for Boundary #2 (handler subprocess stdout).
 *
 * Source: docs/hook-stdout-schema.md (authoritative field definitions).
 * Naming: camelCase + Schema suffix (e.g. hookOutputSchema), PascalCase inferred types.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base schema (all hooks)
// ---------------------------------------------------------------------------

/**
 * Standard fields every hook can return. All fields are optional — a hook
 * returning an empty object or omitting any of these fields is valid.
 */
export const hookOutputSchema = z
  .object({
    continue: z.boolean().optional(),
    suppressOutput: z.boolean().optional(),
    systemMessage: z.string().optional(),
  })
  .loose();

export type HookOutput = z.infer<typeof hookOutputSchema>;

// ---------------------------------------------------------------------------
// PreToolUse-specific schema
// ---------------------------------------------------------------------------

/**
 * Output schema for PreToolUse hooks.
 * hookSpecificOutput carries the permission decision and optional modified input.
 * Only PreToolUse uses hookSpecificOutput — it is not a universal field.
 */
export const preToolUseOutputSchema = z
  .object({
    continue: z.boolean().optional(),
    suppressOutput: z.boolean().optional(),
    systemMessage: z.string().optional(),
    hookSpecificOutput: z
      .object({
        permissionDecision: z.enum(['allow', 'deny', 'ask']),
        updatedInput: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .loose();

export type PreToolUseOutput = z.infer<typeof preToolUseOutputSchema>;

// ---------------------------------------------------------------------------
// Stop-specific schema
// ---------------------------------------------------------------------------

/**
 * Output schema for Stop hooks.
 * decision is required; reason and systemMessage are optional.
 */
export const stopOutputSchema = z
  .object({
    continue: z.boolean().optional(),
    suppressOutput: z.boolean().optional(),
    systemMessage: z.string().optional(),
    decision: z.enum(['approve', 'block']),
    reason: z.string().optional(),
  })
  .loose();

export type StopOutput = z.infer<typeof stopOutputSchema>;

// ---------------------------------------------------------------------------
// Parse factory — Boundary #2 (handler subprocess stdout)
// ---------------------------------------------------------------------------

/**
 * Parses and validates handler subprocess stdout as a HookOutput object.
 *
 * Boundary #2: handler subprocess stdout → typed HookOutput.
 *
 * Accepts two payload shapes (both valid under hookOutputSchema):
 *   Normal:  { continue: boolean, systemMessage?: string }
 *   Fatal:   { hookwatch_fatal: string, continue: true, systemMessage: string }
 * The `hookwatch_fatal` field passes through via .loose() — not validated
 * as a required field but preserved in the returned object.
 *
 * Throws:
 *   SyntaxError  — if stdout is not valid JSON
 *   ZodError     — if the parsed JSON does not satisfy hookOutputSchema
 */
export function parseHookOutput(stdout: string): HookOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    const preview = stdout.length > 200 ? `${stdout.slice(0, 200)}\u2026` : stdout;
    throw new SyntaxError(`handler stdout is not valid JSON: ${preview}`, { cause: err });
  }
  return hookOutputSchema.parse(parsed);
}
