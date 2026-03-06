/**
 * Shared event type definitions for the hookwatch CLI.
 *
 * Kept in a separate file so tests can import EVENT_TYPES without triggering
 * the citty runMain() call in index.ts.
 */

/** All 18 PascalCase event types that hookwatch handles. */
export const EVENT_TYPES = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "Notification",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "TeammateIdle",
  "TaskCompleted",
  "InstructionsLoaded",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Set for O(1) lookup. */
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);
