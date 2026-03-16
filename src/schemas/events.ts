/**
 * Zod schemas for all Claude Code hook event types.
 *
 * Design decisions:
 * - .loose() on ALL schemas — unknown fields are preserved, not stripped.
 *   Forward-compatible with Claude Code SDK changes (NFR12).
 *   (.passthrough() was replaced by .loose() in Zod v4.)
 * - z.enum() for fields with documented fixed values (source, reason, etc.).
 * - z.record(z.string(), z.unknown()) for arbitrary JSON objects (tool_input, tool_response).
 *   Note: Zod v4 requires two arguments for z.record(); the single-arg form z.record(z.unknown()) is broken (throws TypeError).
 * - Fallback schema for unknown event types — accepts any valid JSON with common fields.
 * - parseHookEvent() discriminates by hook_event_name and routes to the correct schema.
 * - Each event schema extends commonFieldsSchema — hook_event_name z.literal() overrides
 *   the z.string() from common fields, acting as the discriminator.
 *
 * Source: docs/hook-stdin-schema.md (authoritative field definitions).
 * Naming: camelCase + Schema suffix (e.g. sessionStartSchema), PascalCase inferred types.
 */

import { type ZodType, z } from 'zod';
import { isRecord } from '@/guards.ts';
import type { EVENT_NAMES } from '@/types.ts';

// ---------------------------------------------------------------------------
// Common fields (present on every event)
// ---------------------------------------------------------------------------

/**
 * Fields present on every Claude Code hook event stdin payload.
 * session_name and hook_duration_ms are optional extras captured by the DB layer
 * but not part of the documented common fields; they may appear in some payloads.
 */
export const commonFieldsSchema = z
  .object({
    session_id: z.string(),
    transcript_path: z.string(),
    cwd: z.string(),
    permission_mode: z.string(),
    hook_event_name: z.string(),
  })
  .loose();

export type CommonFields = z.infer<typeof commonFieldsSchema>;

// ---------------------------------------------------------------------------
// Event-specific schemas
// ---------------------------------------------------------------------------

export const sessionStartSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('SessionStart'),
    source: z.enum(['startup', 'resume', 'clear', 'compact']),
    model: z.string(),
    agent_type: z.string().optional(),
  })
  .loose();

export type SessionStart = z.infer<typeof sessionStartSchema>;

export const sessionEndSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('SessionEnd'),
    reason: z.enum([
      'clear',
      'logout',
      'prompt_input_exit',
      'bypass_permissions_disabled',
      'other',
    ]),
  })
  .loose();

export type SessionEnd = z.infer<typeof sessionEndSchema>;

export const userPromptSubmitSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('UserPromptSubmit'),
    prompt: z.string(),
  })
  .loose();

export type UserPromptSubmit = z.infer<typeof userPromptSubmitSchema>;

export const preToolUseSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('PreToolUse'),
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
  })
  .loose();

export type PreToolUse = z.infer<typeof preToolUseSchema>;

export const postToolUseSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('PostToolUse'),
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    tool_response: z.record(z.string(), z.unknown()),
  })
  .loose();

export type PostToolUse = z.infer<typeof postToolUseSchema>;

export const postToolUseFailureSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('PostToolUseFailure'),
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    error: z.string(),
    is_interrupt: z.boolean().optional(),
  })
  .loose();

export type PostToolUseFailure = z.infer<typeof postToolUseFailureSchema>;

/**
 * PermissionRequest intentionally has NO tool_use_id — unlike PreToolUse/PostToolUse.
 * See docs/hook-stdin-schema.md.
 */
export const permissionRequestSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('PermissionRequest'),
    tool_name: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    permission_suggestions: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .loose();

export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

export const notificationSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('Notification'),
    message: z.string(),
    title: z.string().optional(),
    notification_type: z.enum([
      'permission_prompt',
      'idle_prompt',
      'auth_success',
      'elicitation_dialog',
    ]),
  })
  .loose();

export type Notification = z.infer<typeof notificationSchema>;

export const subagentStartSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('SubagentStart'),
    agent_id: z.string(),
    agent_type: z.string(),
  })
  .loose();

export type SubagentStart = z.infer<typeof subagentStartSchema>;

export const subagentStopSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('SubagentStop'),
    agent_id: z.string(),
    agent_type: z.string(),
    stop_hook_active: z.boolean(),
    agent_transcript_path: z.string(),
    last_assistant_message: z.string(),
  })
  .loose();

export type SubagentStop = z.infer<typeof subagentStopSchema>;

export const stopSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('Stop'),
    stop_hook_active: z.boolean(),
    last_assistant_message: z.string(),
  })
  .loose();

export type Stop = z.infer<typeof stopSchema>;

export const preCompactSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('PreCompact'),
    trigger: z.enum(['manual', 'auto']),
    custom_instructions: z.string(),
  })
  .loose();

export type PreCompact = z.infer<typeof preCompactSchema>;

export const teammateIdleSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('TeammateIdle'),
    teammate_name: z.string(),
    team_name: z.string(),
  })
  .loose();

export type TeammateIdle = z.infer<typeof teammateIdleSchema>;

export const taskCompletedSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('TaskCompleted'),
    task_id: z.string(),
    task_subject: z.string(),
    task_description: z.string().optional(),
    teammate_name: z.string().optional(),
    team_name: z.string().optional(),
  })
  .loose();

export type TaskCompleted = z.infer<typeof taskCompletedSchema>;

export const configChangeSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('ConfigChange'),
    source: z.enum([
      'user_settings',
      'project_settings',
      'local_settings',
      'policy_settings',
      'skills',
    ]),
    file_path: z.string().optional(),
  })
  .loose();

export type ConfigChange = z.infer<typeof configChangeSchema>;

export const worktreeCreateSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('WorktreeCreate'),
    name: z.string(),
  })
  .loose();

export type WorktreeCreate = z.infer<typeof worktreeCreateSchema>;

export const worktreeRemoveSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('WorktreeRemove'),
    worktree_path: z.string(),
  })
  .loose();

export type WorktreeRemove = z.infer<typeof worktreeRemoveSchema>;

/**
 * InstructionsLoaded event — fired when Claude Code loads instructions (e.g. CLAUDE.md,
 * rules files). Present in the Agent SDK types as InstructionsLoadedHookInput.
 * trigger values are documented as "init" | "maintenance" in the SDK.
 */
export const instructionsLoadedSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal('InstructionsLoaded'),
    trigger: z.enum(['init', 'maintenance']),
  })
  .loose();

export type InstructionsLoaded = z.infer<typeof instructionsLoadedSchema>;

// ---------------------------------------------------------------------------
// Fallback schema for unknown / future event types
// ---------------------------------------------------------------------------

/**
 * Accepts any payload that satisfies the common fields contract.
 * Unknown event types (e.g. future SDK additions) pass through intact.
 */
export const unknownEventSchema = commonFieldsSchema;

export type UnknownEvent = z.infer<typeof unknownEventSchema>;

// ---------------------------------------------------------------------------
// Union type for all known event payloads
// ---------------------------------------------------------------------------

export type HookEvent =
  | SessionStart
  | SessionEnd
  | UserPromptSubmit
  | PreToolUse
  | PostToolUse
  | PostToolUseFailure
  | PermissionRequest
  | Notification
  | SubagentStart
  | SubagentStop
  | Stop
  | PreCompact
  | TeammateIdle
  | TaskCompleted
  | ConfigChange
  | WorktreeCreate
  | WorktreeRemove
  | InstructionsLoaded
  | UnknownEvent;

// ---------------------------------------------------------------------------
// Schema lookup map
// ---------------------------------------------------------------------------

/**
 * Maps every known hook_event_name to its Zod schema.
 * Keyed by the EVENT_NAMES tuple from src/types.ts — the compiler enforces
 * that all known event names have a corresponding schema entry.
 * Adding a new event type requires only a schema definition above and one
 * entry here; no switch case needed.
 */
export const SCHEMA_MAP = {
  SessionStart: sessionStartSchema,
  SessionEnd: sessionEndSchema,
  UserPromptSubmit: userPromptSubmitSchema,
  PreToolUse: preToolUseSchema,
  PostToolUse: postToolUseSchema,
  PostToolUseFailure: postToolUseFailureSchema,
  PermissionRequest: permissionRequestSchema,
  Notification: notificationSchema,
  SubagentStart: subagentStartSchema,
  SubagentStop: subagentStopSchema,
  Stop: stopSchema,
  PreCompact: preCompactSchema,
  TeammateIdle: teammateIdleSchema,
  TaskCompleted: taskCompletedSchema,
  ConfigChange: configChangeSchema,
  WorktreeCreate: worktreeCreateSchema,
  WorktreeRemove: worktreeRemoveSchema,
  InstructionsLoaded: instructionsLoadedSchema,
} satisfies Record<(typeof EVENT_NAMES)[number], ZodType>;

/** Type-level alias for typeof SCHEMA_MAP — consumers can import this without a value import. */
export type SchemaMap = typeof SCHEMA_MAP;

// ---------------------------------------------------------------------------
// Discriminated parse function
// ---------------------------------------------------------------------------

/** Type predicate: narrows a string to a known event name key in SCHEMA_MAP. */
function isKnownEventName(name: string): name is keyof typeof SCHEMA_MAP {
  return name in SCHEMA_MAP;
}

/**
 * Routes a raw stdin payload to the correct event schema by hook_event_name.
 * Unknown event types fall through to unknownEventSchema, which validates the
 * common fields and preserves all other fields via .loose().
 *
 * Throws a ZodError if the payload fails validation.
 */
export function parseHookEvent(raw: unknown): HookEvent {
  // Extract hook_event_name via type guard (no `as` cast).
  if (
    isRecord(raw) &&
    typeof raw.hook_event_name === 'string' &&
    isKnownEventName(raw.hook_event_name)
  ) {
    return SCHEMA_MAP[raw.hook_event_name].parse(raw);
  }
  // Unknown event type — validate common fields only, preserve everything else.
  return unknownEventSchema.parse(raw);
}
