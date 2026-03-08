/**
 * Zod schemas for all 18 Claude Code hook event types.
 *
 * Design decisions:
 * - .passthrough() on ALL schemas — unknown fields are preserved, not stripped.
 *   Forward-compatible with Claude Code SDK changes (NFR12).
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

import { z } from "zod";

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
  .passthrough();

export type CommonFields = z.infer<typeof commonFieldsSchema>;

// ---------------------------------------------------------------------------
// Event-specific schemas
// ---------------------------------------------------------------------------

export const sessionStartSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("SessionStart"),
    source: z.enum(["startup", "resume", "clear", "compact"]),
    model: z.string(),
    agent_type: z.string().optional(),
  })
  .passthrough();

export type SessionStart = z.infer<typeof sessionStartSchema>;

export const sessionEndSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("SessionEnd"),
    reason: z.enum([
      "clear",
      "logout",
      "prompt_input_exit",
      "bypass_permissions_disabled",
      "other",
    ]),
  })
  .passthrough();

export type SessionEnd = z.infer<typeof sessionEndSchema>;

export const userPromptSubmitSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("UserPromptSubmit"),
    prompt: z.string(),
  })
  .passthrough();

export type UserPromptSubmit = z.infer<typeof userPromptSubmitSchema>;

export const preToolUseSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("PreToolUse"),
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type PreToolUse = z.infer<typeof preToolUseSchema>;

export const postToolUseSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("PostToolUse"),
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    tool_response: z.record(z.string(), z.unknown()),
  })
  .passthrough();

export type PostToolUse = z.infer<typeof postToolUseSchema>;

export const postToolUseFailureSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("PostToolUseFailure"),
    tool_name: z.string(),
    tool_use_id: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    error: z.string(),
    is_interrupt: z.boolean().optional(),
  })
  .passthrough();

export type PostToolUseFailure = z.infer<typeof postToolUseFailureSchema>;

/**
 * PermissionRequest intentionally has NO tool_use_id — unlike PreToolUse/PostToolUse.
 * See docs/hook-stdin-schema.md.
 */
export const permissionRequestSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("PermissionRequest"),
    tool_name: z.string(),
    tool_input: z.record(z.string(), z.unknown()),
    permission_suggestions: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export type PermissionRequest = z.infer<typeof permissionRequestSchema>;

export const notificationSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("Notification"),
    message: z.string(),
    title: z.string().optional(),
    notification_type: z.enum([
      "permission_prompt",
      "idle_prompt",
      "auth_success",
      "elicitation_dialog",
    ]),
  })
  .passthrough();

export type Notification = z.infer<typeof notificationSchema>;

export const subagentStartSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("SubagentStart"),
    agent_id: z.string(),
    agent_type: z.string(),
  })
  .passthrough();

export type SubagentStart = z.infer<typeof subagentStartSchema>;

export const subagentStopSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("SubagentStop"),
    agent_id: z.string(),
    agent_type: z.string(),
    stop_hook_active: z.boolean(),
    agent_transcript_path: z.string(),
    last_assistant_message: z.string(),
  })
  .passthrough();

export type SubagentStop = z.infer<typeof subagentStopSchema>;

export const stopSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("Stop"),
    stop_hook_active: z.boolean(),
    last_assistant_message: z.string(),
  })
  .passthrough();

export type Stop = z.infer<typeof stopSchema>;

export const preCompactSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("PreCompact"),
    trigger: z.enum(["manual", "auto"]),
    custom_instructions: z.string(),
  })
  .passthrough();

export type PreCompact = z.infer<typeof preCompactSchema>;

export const teammateIdleSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("TeammateIdle"),
    teammate_name: z.string(),
    team_name: z.string(),
  })
  .passthrough();

export type TeammateIdle = z.infer<typeof teammateIdleSchema>;

export const taskCompletedSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("TaskCompleted"),
    task_id: z.string(),
    task_subject: z.string(),
    task_description: z.string().optional(),
    teammate_name: z.string().optional(),
    team_name: z.string().optional(),
  })
  .passthrough();

export type TaskCompleted = z.infer<typeof taskCompletedSchema>;

export const configChangeSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("ConfigChange"),
    source: z.enum([
      "user_settings",
      "project_settings",
      "local_settings",
      "policy_settings",
      "skills",
    ]),
    file_path: z.string().optional(),
  })
  .passthrough();

export type ConfigChange = z.infer<typeof configChangeSchema>;

export const worktreeCreateSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("WorktreeCreate"),
    name: z.string(),
  })
  .passthrough();

export type WorktreeCreate = z.infer<typeof worktreeCreateSchema>;

export const worktreeRemoveSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("WorktreeRemove"),
    worktree_path: z.string(),
  })
  .passthrough();

export type WorktreeRemove = z.infer<typeof worktreeRemoveSchema>;

/**
 * InstructionsLoaded event — fired when Claude Code loads instructions (e.g. CLAUDE.md,
 * rules files). Present in the Agent SDK types as InstructionsLoadedHookInput.
 * trigger values are documented as "init" | "maintenance" in the SDK.
 */
export const instructionsLoadedSchema = commonFieldsSchema
  .extend({
    hook_event_name: z.literal("InstructionsLoaded"),
    trigger: z.enum(["init", "maintenance"]),
  })
  .passthrough();

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
// Discriminated parse function
// ---------------------------------------------------------------------------

/**
 * Routes a raw stdin payload to the correct event schema by hook_event_name.
 * Unknown event types fall through to unknownEventSchema, which validates the
 * common fields and preserves all other fields via .passthrough().
 *
 * Throws a ZodError if the payload fails validation.
 */
export function parseHookEvent(raw: unknown): HookEvent {
  // First, extract hook_event_name from the raw payload to discriminate.
  const name = (raw as Record<string, unknown>)?.hook_event_name;

  switch (name) {
    case "SessionStart":
      return sessionStartSchema.parse(raw);
    case "SessionEnd":
      return sessionEndSchema.parse(raw);
    case "UserPromptSubmit":
      return userPromptSubmitSchema.parse(raw);
    case "PreToolUse":
      return preToolUseSchema.parse(raw);
    case "PostToolUse":
      return postToolUseSchema.parse(raw);
    case "PostToolUseFailure":
      return postToolUseFailureSchema.parse(raw);
    case "PermissionRequest":
      return permissionRequestSchema.parse(raw);
    case "Notification":
      return notificationSchema.parse(raw);
    case "SubagentStart":
      return subagentStartSchema.parse(raw);
    case "SubagentStop":
      return subagentStopSchema.parse(raw);
    case "Stop":
      return stopSchema.parse(raw);
    case "PreCompact":
      return preCompactSchema.parse(raw);
    case "TeammateIdle":
      return teammateIdleSchema.parse(raw);
    case "TaskCompleted":
      return taskCompletedSchema.parse(raw);
    case "ConfigChange":
      return configChangeSchema.parse(raw);
    case "WorktreeCreate":
      return worktreeCreateSchema.parse(raw);
    case "WorktreeRemove":
      return worktreeRemoveSchema.parse(raw);
    case "InstructionsLoaded":
      return instructionsLoadedSchema.parse(raw);
    default:
      // Unknown event type — validate common fields only, preserve everything else.
      return unknownEventSchema.parse(raw);
  }
}
