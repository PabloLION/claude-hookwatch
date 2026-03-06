/**
 * Zod schemas for validating hook stdout output before sending to Claude Code.
 *
 * Design decisions:
 * - .passthrough() on ALL schemas — forward-compatible with Claude Code SDK additions.
 * - systemMessage is optional on all schemas (base and event-specific).
 * - hookSpecificOutput applies only to PreToolUse — not a universal field.
 * - Stop has its own decision/reason fields; no hookSpecificOutput.
 * - All other event types use the base schema (3 standard fields only).
 * - z.record(z.string(), z.unknown()) for arbitrary JSON objects (Zod v4 requires
 *   two arguments; single-arg z.record(z.unknown()) throws TypeError).
 *
 * Source: docs/hook-stdout-schema.md (authoritative field definitions).
 * Naming: camelCase + Schema suffix (e.g. hookOutputSchema), PascalCase inferred types.
 */

import { z } from "zod";

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
  .passthrough();

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
        permissionDecision: z.enum(["allow", "deny", "ask"]),
        updatedInput: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .passthrough();

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
    decision: z.enum(["approve", "block"]),
    reason: z.string().optional(),
  })
  .passthrough();

export type StopOutput = z.infer<typeof stopOutputSchema>;
