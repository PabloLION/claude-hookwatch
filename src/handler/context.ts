/**
 * Context injection helpers for the hookwatch handler.
 *
 * Builds the systemMessage string written to stdout so Claude Code injects
 * hookwatch context into the agent's conversation.
 */

import type { z } from 'zod';
import { SYSTEM_MESSAGE_PREFIX } from '@/config.ts';
import type { HookEvent, SchemaMap } from '@/schemas/events.ts';

/**
 * Strips index signatures, keeping only explicitly declared keys.
 * Needed because .loose() schemas add [key: string]: unknown to z.infer<>.
 */
type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : K]: T[K];
};

/** Explicitly declared field names from a SCHEMA_MAP entry's inferred type. */
type SchemaField<K extends keyof SchemaMap> = keyof KnownKeys<z.infer<SchemaMap[K]>> & string;

/**
 * Maps hook_event_name → the field that contains the subtype string, or null
 * when the event type has no meaningful subtype.
 * Values are compile-checked against the corresponding schema's declared
 * fields — a field-name typo is a compile error.
 * All keys in SchemaMap must be present; null = no subtype for that event type.
 */
type SubtypeFieldMap = {
  [K in keyof SchemaMap]: SchemaField<K> | null;
};

export const SUBTYPE_FIELD: SubtypeFieldMap = {
  SessionStart: 'source',
  SessionEnd: 'reason',
  UserPromptSubmit: null,
  PreToolUse: 'tool_name',
  PostToolUse: 'tool_name',
  PostToolUseFailure: 'tool_name',
  PermissionRequest: 'tool_name',
  Notification: 'notification_type',
  SubagentStart: 'agent_type',
  SubagentStop: 'agent_type',
  Stop: null,
  PreCompact: 'trigger',
  TeammateIdle: null,
  TaskCompleted: null,
  ConfigChange: 'source',
  WorktreeCreate: null,
  WorktreeRemove: null,
  InstructionsLoaded: 'trigger',
};

/**
 * Extracts a subtype string from the event based on the event type.
 * Returns null when SUBTYPE_FIELD maps the event to null (no meaningful
 * subtype), when the event name is unknown, or when the expected field is
 * absent or not a string.
 *
 * HookEvent types are inferred from .loose() schemas, which produce types with
 * an index signature ([key: string]: unknown), allowing dynamic field access
 * without unsafe casts even for fields not declared in the static type.
 */
export function getEventSubtype(event: HookEvent): string | null {
  const name = event.hook_event_name;
  const field = SUBTYPE_FIELD[name as keyof SubtypeFieldMap];
  if (field === null || field === undefined) return null;
  const value = event[field];
  return typeof value === 'string' ? value : null;
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
  const suffix = subtype !== null ? ` (${subtype})` : '';
  const base = `${SYSTEM_MESSAGE_PREFIX} ${event.hook_event_name}${suffix}`;
  if (logEntries && logEntries.length > 0) {
    return `${base} — ${logEntries.join('; ')}`;
  }
  return base;
}
