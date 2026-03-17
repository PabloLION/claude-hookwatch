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
 * All known Claude Code hook event name literals, in alphabetical order.
 * Use as const preserves the tuple of string literals for type inference.
 */
export const EVENT_NAMES = [
  'ConfigChange',
  'InstructionsLoaded',
  'Notification',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'PreCompact',
  'PreToolUse',
  'SessionEnd',
  'SessionStart',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'TaskCompleted',
  'TeammateIdle',
  'UserPromptSubmit',
  'WorktreeCreate',
  'WorktreeRemove',
] as const;

/**
 * Union type of all known hook_event_name values plus "unknown".
 *
 * "unknown" is a synthetic value written to EventRow.event when hookwatch
 * receives an event name it does not recognize — e.g. a future Claude Code
 * SDK event type. This keeps the column type stable without requiring a DB
 * migration every time new event types are added.
 */
export type KnownEventName = (typeof EVENT_NAMES)[number] | 'unknown';

/**
 * Normalize a raw hook_event_name string to KnownEventName.
 * If the name is one of the documented event types in EVENT_NAMES, it is returned
 * as-is. Otherwise "unknown" is returned.
 */
export function toKnownEventName(name: string): KnownEventName {
  return (EVENT_NAMES as readonly string[]).includes(name) ? (name as KnownEventName) : 'unknown';
}

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

/**
 * Represents a single row in the events table.
 * snake_case matches database column names.
 */
export interface EventRow {
  readonly id: number;
  readonly timestamp: number;
  /** Normalized hook event name. Unrecognized event types stored as "unknown". */
  readonly event: KnownEventName;
  readonly session_id: string;
  readonly cwd: string;
  readonly tool_name: string | null;
  readonly session_name: string | null;
  readonly hook_duration_ms: number | null;
  readonly stdin: string;
  /** NULL = bare handler event; non-NULL = wrapped command string */
  readonly wrapped_command: string | null;
  /** Captured child stdout (wrapped mode); hookwatch JSON output (bare mode) */
  readonly stdout: string | null;
  /** Captured child stderr (wrapped mode); NULL for bare mode */
  readonly stderr: string | null;
  /** Child exit code. NOT NULL DEFAULT 0 — Unix processes always exit 0-255. */
  readonly exit_code: number;
  /**
   * Hookwatch-internal diagnostics with severity prefix.
   * Format: "[error] msg" or "[warn] msg" or "[error] msg1; [warn] msg2".
   * NULL = no issues. See devlog: 20260308-hookwatch-log-column-design.md
   */
  readonly hookwatch_log: string | null;
}

/**
 * Parameters for inserting a new event.
 * All values must be explicitly provided — no defaults computed here.
 * Derived from EventRow by omitting the auto-generated id column.
 */
export type InsertEventParams = Omit<EventRow, 'id'>;

// ---------------------------------------------------------------------------
// Wrap handler types
// ---------------------------------------------------------------------------

/**
 * Result returned by runWrapped() after the child process exits.
 *
 * Three variants discriminated by `outcome`:
 *   - 'normal': child exited cleanly; hookwatchLog is null when there are no issues.
 *   - 'signal': child was killed by a signal; hookwatchLog is always set with a [warn] entry.
 *   - 'error':  child never ran (spawn failure, stdin read failure, empty command);
 *               stdout/stderr are always null; hookwatchLog is always set with an [error] entry.
 */
export type WrapResult =
  | {
      readonly outcome: 'normal';
      readonly exitCode: number;
      /** Raw stdin content (the Claude Code event JSON) — for the caller to parse. */
      readonly stdin: string;
      /** Captured child stdout, or null when the child produced no output. */
      readonly stdout: string | null;
      /** Captured child stderr, or null when the child produced no output. */
      readonly stderr: string | null;
      /** Null when the child exited cleanly with no issues. */
      readonly hookwatchLog: string | null;
    }
  | {
      readonly outcome: 'signal';
      readonly exitCode: number;
      readonly stdin: string;
      readonly stdout: string | null;
      readonly stderr: string | null;
      /**
       * Signal-death warning, always set. Format: "[warn] exit 137 (likely SIGKILL —
       * forced termination)". Caller pushes this into logEntries so it appears
       * in hookwatch_log and systemMessage.
       */
      readonly hookwatchLog: string;
    }
  | {
      readonly outcome: 'error';
      readonly exitCode: 1;
      readonly stdin: string;
      /** Always null — child never ran. */
      readonly stdout: null;
      /** Always null — child never ran. */
      readonly stderr: null;
      /** Error description, always set. Format: "[error] <message>". */
      readonly hookwatchLog: string;
    };
