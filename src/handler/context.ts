/**
 * Context injection helpers for the hookwatch handler.
 *
 * Builds the systemMessage string written to stdout so Claude Code injects
 * hookwatch context into the agent's conversation.
 */

import type { HookEvent } from "@/schemas/events.ts";

/**
 * Reads a string field from an unknown record. Returns null if the field is
 * absent or not a string, preventing "undefined" from leaking into the output.
 */
function stringField(event: HookEvent, field: string): string | null {
  const value = (event as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

/**
 * Extracts a subtype string from the event based on the event type.
 * Returns null for event types that have no meaningful subtype, or when the
 * expected field is absent or not a string.
 */
export function getEventSubtype(event: HookEvent): string | null {
  const name = event.hook_event_name;
  switch (name) {
    case "SessionStart":
      return stringField(event, "source");
    case "SessionEnd":
      return stringField(event, "reason");
    case "PreToolUse":
    case "PostToolUse":
    case "PostToolUseFailure":
    case "PermissionRequest":
      return stringField(event, "tool_name");
    case "Notification":
      return stringField(event, "notification_type");
    case "SubagentStart":
    case "SubagentStop":
      return stringField(event, "agent_type");
    case "PreCompact":
      return stringField(event, "trigger");
    case "ConfigChange":
      return stringField(event, "source");
    case "InstructionsLoaded":
      return stringField(event, "trigger");
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
 * When logEntries are provided (non-empty), they are appended to the message
 * so the user can see non-fatal hookwatch issues (e.g. POST failure reason)
 * without blocking Claude Code.
 *
 * TODO: configurable via config.toml (ch-1ex5.1)
 */
export function buildSystemMessage(event: HookEvent, logEntries?: string[]): string {
  const subtype = getEventSubtype(event);
  const base =
    subtype !== null
      ? `hookwatch captured ${event.hook_event_name} (${subtype})`
      : `hookwatch captured ${event.hook_event_name}`;
  if (logEntries && logEntries.length > 0) {
    return `${base} — ${logEntries.join("; ")}`;
  }
  return base;
}
