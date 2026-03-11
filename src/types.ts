/**
 * Shared types used across multiple hookwatch domains.
 *
 * Type placement rule: 2+ domains → move to shared (src/types.ts).
 * Single-domain types stay in their domain file.
 */

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
  event: string;
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
}
