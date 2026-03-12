/**
 * Context injection helpers for the hookwatch handler.
 *
 * Builds the systemMessage string written to stdout so Claude Code injects
 * hookwatch context into the agent's conversation.
 */

import { SYSTEM_MESSAGE_PREFIX } from '@/config.ts';
import type { HookEvent } from '@/schemas/events.ts';

/**
 * Reads a string field from an unknown record. Returns null if the field is
 * absent or not a string, preventing "undefined" from leaking into the output.
 */
function stringField(event: HookEvent, field: string): string | null {
  const value = (event as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Maps hook_event_name → the field name that contains the subtype string.
 * Event types absent from this map have no meaningful subtype (return null).
 */
const SUBTYPE_FIELD: Record<string, string> = {
  SessionStart: 'source',
  SessionEnd: 'reason',
  PreToolUse: 'tool_name',
  PostToolUse: 'tool_name',
  PostToolUseFailure: 'tool_name',
  PermissionRequest: 'tool_name',
  Notification: 'notification_type',
  SubagentStart: 'agent_type',
  SubagentStop: 'agent_type',
  PreCompact: 'trigger',
  ConfigChange: 'source',
  InstructionsLoaded: 'trigger',
};

/**
 * Extracts a subtype string from the event based on the event type.
 * Returns null for event types that have no meaningful subtype, or when the
 * expected field is absent or not a string.
 */
export function getEventSubtype(event: HookEvent): string | null {
  const field = SUBTYPE_FIELD[event.hook_event_name];
  if (field === undefined) return null;
  return stringField(event, field);
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
 */
export function buildSystemMessage(event: HookEvent, logEntries?: string[]): string {
  const subtype = getEventSubtype(event);
  const base =
    subtype === null
      ? `${SYSTEM_MESSAGE_PREFIX} ${event.hook_event_name}`
      : `${SYSTEM_MESSAGE_PREFIX} ${event.hook_event_name} (${subtype})`;
  if (logEntries && logEntries.length > 0) {
    return `${base} — ${logEntries.join('; ')}`;
  }
  return base;
}
