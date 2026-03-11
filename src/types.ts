/**
 * Shared types used across multiple hookwatch domains.
 *
 * Type placement rule: 2+ domains → move to shared (src/types.ts).
 * Single-domain types stay in their domain file.
 */

// ---------------------------------------------------------------------------
// Known event names
// ---------------------------------------------------------------------------

/**
 * All 18 known Claude Code hook event name literals, in alphabetical order.
 * Use as const preserves the tuple of string literals for type inference.
 */
export const EVENT_NAMES = [
  "ConfigChange",
  "InstructionsLoaded",
  "Notification",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "PreToolUse",
  "SessionEnd",
  "SessionStart",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "TaskCompleted",
  "TeammateIdle",
  "UserPromptSubmit",
  "WorktreeCreate",
  "WorktreeRemove",
] as const;

/**
 * Union type of all known hook_event_name values plus "unknown".
 *
 * "unknown" is a synthetic value written to EventRow.event when hookwatch
 * receives an event name it does not recognise — e.g. a future Claude Code
 * SDK event type. This keeps the column type stable without requiring a DB
 * migration every time new event types are added.
 */
export type KnownEventName = (typeof EVENT_NAMES)[number] | "unknown";

/**
 * Normalise a raw hook_event_name string to KnownEventName.
 * If the name is one of the 18 documented event types, it is returned
 * as-is. Otherwise "unknown" is returned.
 */
export function toKnownEventName(name: string): KnownEventName {
  return (EVENT_NAMES as readonly string[]).includes(name) ? (name as KnownEventName) : "unknown";
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

/**
 * Represents a single row in the events table.
 * snake_case matches database column names.
 */
export interface EventRow {
  id: number;
  timestamp: number;
  /** Normalised hook event name. Unrecognised event types stored as "unknown". */
  event: KnownEventName;
  session_id: string;
  cwd: string;
  tool_name: string | null;
  session_name: string | null;
  hook_duration_ms: number | null;
  stdin: string;
  /** NULL = bare handler event; non-NULL = wrapped command string (Story 3.1) */
  wrapped_command: string | null;
  /** Captured child stdout (wrapped mode); hookwatch JSON output (bare mode) */
  stdout: string | null;
  /** Captured child stderr (wrapped mode); NULL for bare mode */
  stderr: string | null;
  /** Child exit code. NOT NULL DEFAULT 0 — Unix processes always exit 0-255. */
  exit_code: number;
  /**
   * Hookwatch-internal diagnostics with severity prefix.
   * Format: "[error] msg" or "[warn] msg" or "[error] msg1; [warn] msg2".
   * NULL = no issues. See devlog: 20260308-hookwatch-log-column-design.md
   */
  hookwatch_log: string | null;
}

/**
 * Parameters for inserting a new event.
 * All values must be explicitly provided — no defaults computed here.
 * Derived from EventRow by omitting the auto-generated id column.
 */
export type InsertEventParams = Omit<EventRow, "id">;

// ---------------------------------------------------------------------------
// Wrap handler types
// ---------------------------------------------------------------------------

/** Result returned by runWrapped() after the child process exits. */
export interface WrapResult {
  exitCode: number;
  /** Raw stdin content (the Claude Code event JSON) — for the caller to parse. */
  stdin: string;
  stdout: string;
  stderr: string;
  /**
   * Hookwatch-internal diagnostic log entry for signal deaths, or undefined
   * when the child exited normally. Format: "[warn] exit 137 (likely SIGKILL
   * — forced termination)". Caller pushes this into logEntries so it appears
   * in hookwatch_log and systemMessage.
   */
  hookwatchLog?: string;
}
