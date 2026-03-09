/**
 * Context injection helpers for the hookwatch handler.
 *
 * Builds the systemMessage string written to stdout so Claude Code injects
 * hookwatch context into the agent's conversation.
 *
 * STDOUT SUPPRESSION: All logging goes to stderr — NEVER console.log().
 */

import type { HookEvent } from "@/schemas/events.ts";

/**
 * Extracts a subtype string from the event based on the event type.
 * Returns null for event types that have no meaningful subtype.
 */
export function getEventSubtype(event: HookEvent): string | null {
  const name = event.hook_event_name;
  switch (name) {
    case "SessionStart":
      return (event as { source: string }).source;
    case "SessionEnd":
      return (event as { reason: string }).reason;
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PermissionRequest":
      return (event as { tool_name: string }).tool_name;
    case "Notification":
      return (event as { notification_type: string }).notification_type;
    case "SubagentStart":
    case "SubagentStop":
      return (event as { agent_type: string }).agent_type;
    case "PreCompact":
      return (event as { trigger: string }).trigger;
    case "ConfigChange":
      return (event as { source: string }).source;
    case "InstructionsLoaded":
      return (event as { trigger: string }).trigger;
    default:
      // Stop, UserPromptSubmit, TeammateIdle, TaskCompleted, WorktreeCreate,
      // WorktreeRemove — no subtype
      return null;
  }
}

/**
 * Builds the systemMessage string injected into Claude Code's context after a
 * successful event POST.
 *
 * Format: "hookwatch captured <EventType> (<subtype>)" when a subtype exists,
 * or "hookwatch captured <EventType>" when there is no subtype.
 *
 * TODO: configurable via config.toml (ch-1ex5.1)
 */
export function buildSystemMessage(event: HookEvent): string {
  const subtype = getEventSubtype(event);
  if (subtype !== null) {
    return `hookwatch captured ${event.hook_event_name} (${subtype})`;
  }
  return `hookwatch captured ${event.hook_event_name}`;
}
