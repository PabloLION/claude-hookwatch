/**
 * Hook handler entry point for hookwatch.
 *
 * Two modes (controlled via the wrappedCommand parameter):
 *
 * Bare mode (wrappedCommand undefined/null):
 *   Reads a Claude Code hook event from stdin, validates it with Zod, POSTs
 *   it to the local hookwatch server for storage, and writes a hook output JSON
 *   to stdout so Claude Code injects a systemMessage into the agent's context.
 *
 * Wrapped mode (wrappedCommand is a non-empty string array):
 *   Reads stdin concurrently, spawns the wrapped command, tees its stdout/stderr
 *   to both terminal and capture buffers, waits for it to exit, then POSTs the
 *   event with captured I/O to the server. Always passes the child exit code
 *   through. If the server is unreachable, still passes through I/O.
 *
 * STDOUT CONTRACT: Claude Code interprets ANY stdout as hook output JSON.
 * All other logging goes to stderr (console.error / process.stderr.write) —
 * NEVER console.log().
 *
 * Exit codes:
 *   0 — success (event forwarded, hook output written to stdout)
 *   2 — fatal error (server unreachable, POST failed): JSON error to stdout
 *   In wrapped mode: child exit code is forwarded (pass-through)
 *   Never exits with code 1 — Claude Code shows generic "hook error" for exit 1
 *   and does not surface stderr. Exit 2 + JSON is strictly better.
 *
 * Error handling priority chain:
 *   Fatal (server unreachable / POST fails): exit 2 + JSON stdout. Always.
 *   Non-fatal error (server OK, hookwatch internal issue): hookwatch_log in DB.
 *   Warn: event captured, hookwatch_log with [warn] prefix.
 *   Never mutate wrapped command exit code.
 */

import { readFileSync } from "node:fs";
import { DEFAULT_PORT, portFilePath } from "@/paths.ts";
import { parseHookEvent } from "@/schemas/events.ts";
import { hookOutputSchema } from "@/schemas/output.ts";
import { buildSystemMessage } from "./context.ts";
import { errorMsg } from "./errors.ts";
import { postEvent } from "./post-event.ts";
import { runWrapped } from "./wrap.ts";

const SLOW_THRESHOLD_MS = 100;

// ---------------------------------------------------------------------------
// Fatal error: exit 2 + JSON stdout
// ---------------------------------------------------------------------------

/**
 * Writes a fatal error JSON to stdout and exits with code 2.
 *
 * Claude Code displays exit 2 + stdout JSON to the user, making the hookwatch
 * error visible. Never exits with code 1 (shows only a generic "hook error").
 *
 * This is the ONLY place where a non-child exit code is used. Wrapped mode
 * passes through the child exit code and calls this only for fatal errors before
 * the child has been spawned (i.e., when stdin parsing fails before spawn, or
 * when the server cannot be reached after the child exits).
 */
function exitFatal(message: string): never {
  const errorOutput = JSON.stringify({ hookwatch_fatal: message });
  process.stdout.write(errorOutput);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Port resolution
// ---------------------------------------------------------------------------

interface ReadPortResult {
  port: number;
  /** Non-null when the port file was unreadable due to a non-ENOENT OS error. */
  warning: string | null;
}

/**
 * Reads the server port from the port file written by the server on startup.
 *
 * Falls back to DEFAULT_PORT silently on ENOENT (file not yet written).
 * For other OS errors (EACCES, EIO, etc.) falls back to DEFAULT_PORT but
 * returns a warning string for the caller to record.
 */
function readPort(): ReadPortResult {
  try {
    const content = readFileSync(portFilePath(), "utf8").trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      console.error(
        `[hookwatch] Port file contained invalid value "${content}", using fallback ${DEFAULT_PORT}`,
      );
      return { port: DEFAULT_PORT, warning: null };
    }
    return { port, warning: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File absent — server not started yet or running on default port
      return { port: DEFAULT_PORT, warning: null };
    }
    // Unexpected OS error (EACCES, EIO, etc.) — log and fall back
    const msg = `Port file unreadable (${code ?? "unknown"}), using DEFAULT_PORT`;
    console.error(`[hookwatch] ${msg}`);
    return { port: DEFAULT_PORT, warning: msg };
  }
}

// ---------------------------------------------------------------------------
// Event parsing helper
// ---------------------------------------------------------------------------

/**
 * Parses jsonStr as JSON and validates it against the HookEvent discriminated
 * union schema. On any error, logs to stderr and terminates the process.
 *
 * The fallbackExitCode parameter controls error handling:
 *   - null (bare mode): calls exitFatal() → exit 2 + JSON stdout (fatal)
 *   - non-null (wrapped mode): calls process.exit(fallbackExitCode) to forward
 *     the child's exit code even when event parsing fails (best-effort)
 *
 * This helper eliminates duplicate try-catch blocks across the two error paths.
 *
 * @param jsonStr - Raw stdin JSON string from Claude Code
 * @param fallbackExitCode - Child process exit code to forward on failure, or
 *   null for bare mode (use exitFatal instead)
 * @returns Parsed and validated hook event. Never returns on failure.
 */
export function parseEventSafely(
  jsonStr: string,
  fallbackExitCode: number | null,
): ReturnType<typeof parseHookEvent> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to parse stdin as JSON: ${msg}`);
    if (fallbackExitCode !== null) {
      process.exit(fallbackExitCode);
    }
    exitFatal(`Failed to parse stdin as JSON: ${msg}`);
  }

  try {
    return parseHookEvent(parsed);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Zod validation failed: ${msg}`);
    if (fallbackExitCode !== null) {
      process.exit(fallbackExitCode);
    }
    exitFatal(`Zod validation failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Unified pipeline: handleHook()
// ---------------------------------------------------------------------------

/**
 * Unified hook handler. One algorithm skeleton with a conditional branch on
 * wrappedCommand being null (bare) or non-null (wrapped).
 *
 * Pipeline:
 *   1. Read stdin (bare: Bun.stdin; wrapped: runWrapped buffers it)
 *   2. [Wrapped only] Spawn child, tee I/O, capture exit code
 *   3. Parse and validate event from stdin JSON
 *   4. Resolve port
 *   5. POST event to server (with captured I/O if wrapped)
 *   6. Write hook output JSON to stdout (context injection)
 *   7. [Wrapped] Forward child exit code
 *
 * Error strategy:
 *   Fatal (server unreachable / POST fails): exitFatal() → exit 2 + JSON.
 *     In wrapped mode: best-effort — we still forward child code.
 *   Error (server OK, hookwatch internal issue): accumulate hookwatchLog.
 *   Normal: hookwatchLog null.
 */
async function handleHook(wrapArgs: string[] | null): Promise<void> {
  const wrappedCommand = wrapArgs !== null ? wrapArgs.join(" ") : null;

  // Accumulated non-fatal hookwatch log entries; joined with "; " if multiple
  const logEntries: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1+2: Read stdin (and optionally spawn child in wrapped mode)
  // -------------------------------------------------------------------------

  let stdinJson: string;
  let childStdout: string | null = null;
  let childStderr: string | null = null;
  let childExitCode = 0;

  if (wrapArgs !== null) {
    // Wrapped mode: runWrapped() reads stdin, tees child I/O, returns everything
    const wrapResult = await runWrapped(wrapArgs);
    stdinJson = wrapResult.stdin;
    childStdout = wrapResult.stdout;
    childStderr = wrapResult.stderr;
    childExitCode = wrapResult.exitCode;
  } else {
    // Bare mode: read stdin directly
    stdinJson = await Bun.stdin.text();
  }

  // -------------------------------------------------------------------------
  // Step 3: Parse and validate the event
  // -------------------------------------------------------------------------

  // Bare mode timer starts after stdin read (before event parse)
  // Wrapped mode timer starts here (after child exits — measures hookwatch overhead only)
  const startMs = Date.now();

  // parseEventSafely handles both try-catch blocks (JSON.parse + Zod validation).
  // In wrapped mode (fallbackExitCode = childExitCode): forwards child exit code
  // on parse failure (best-effort). In bare mode (fallbackExitCode = null):
  // calls exitFatal() for a fatal error.
  const event = parseEventSafely(stdinJson, wrapArgs !== null ? childExitCode : null);

  // -------------------------------------------------------------------------
  // Step 4: Resolve port
  // -------------------------------------------------------------------------

  const { port, warning: portWarning } = readPort();
  if (portWarning !== null) {
    logEntries.push(portWarning);
  }

  // -------------------------------------------------------------------------
  // Build hook output JSON (before POST so we can store it as bare stdout)
  // -------------------------------------------------------------------------

  const hookOutput = hookOutputSchema.parse({
    continue: true,
    systemMessage: buildSystemMessage(event),
  });
  const hookOutputJson = JSON.stringify(hookOutput);

  // -------------------------------------------------------------------------
  // Step 5: POST event to server
  // -------------------------------------------------------------------------

  const elapsedMs = Date.now() - startMs;
  const hookwatchLog = logEntries.length > 0 ? logEntries.join("; ") : null;

  const postResult = await postEvent({
    port,
    event,
    wrappedCommand,
    stdout: wrapArgs !== null ? childStdout : hookOutputJson,
    stderr: wrapArgs !== null ? childStderr : null,
    exitCode: wrapArgs !== null ? childExitCode : 0,
    hookDurationMs: elapsedMs,
    hookwatchLog,
  });

  if (!postResult) {
    if (wrapArgs !== null) {
      // Wrapped fatal: server unreachable after child exited — best-effort.
      // Log the failure and continue to forward child exit code.
      // The hook output JSON is NOT written (server couldn't record the event).
      console.error("[hookwatch] Failed to POST wrapped event — continuing (best-effort)");
      process.exit(childExitCode);
    }
    // Bare fatal: server unreachable — exit 2 + JSON, stdout stays empty before this
    exitFatal("Failed to POST event to server");
  }

  // -------------------------------------------------------------------------
  // Step 6: Write hook output JSON to stdout (context injection)
  // -------------------------------------------------------------------------

  // In wrapped mode, child stdout was already written by teeStream.
  // The hook JSON is appended after it.
  process.stdout.write(hookOutputJson);

  // Log slow handler execution to stderr (never stdout)
  if (elapsedMs > SLOW_THRESHOLD_MS) {
    console.error(`[hookwatch] Handler took ${elapsedMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`);
  }

  // -------------------------------------------------------------------------
  // Step 7: Forward child exit code (wrapped mode only)
  // -------------------------------------------------------------------------

  if (wrapArgs !== null) {
    process.exit(childExitCode);
  }
}

// ---------------------------------------------------------------------------
// Public API + entry point
// ---------------------------------------------------------------------------

/**
 * Runs the hook handler.
 *
 * Pass wrappedCommand to enable wrapped mode (child process is spawned and
 * its I/O is captured). Omit or pass undefined for bare mode.
 *
 * Exported for use by cli/index.ts (dynamic import) and tests.
 */
export async function runHandler(wrappedCommand?: string[]): Promise<void> {
  const wrapArgs = wrappedCommand && wrappedCommand.length > 0 ? wrappedCommand : null;
  await handleHook(wrapArgs).catch((err) => {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Unexpected error: ${msg}`);
    exitFatal(`Unexpected error: ${msg}`);
  });
}

// Auto-execute when run as the main module (e.g. via `bun src/handler/index.ts`).
// Bun strips `--` from process.argv, so extra args appear directly as argv.slice(2):
//   bun src/handler/index.ts             → bare mode (argv.slice(2) is empty)
//   bun src/handler/index.ts -- sh -c …  → wrapped mode (bun strips --, argv.slice(2) = ["sh",…])
if (import.meta.main) {
  const trailingArgs = process.argv.slice(2);
  const wrapArgs = trailingArgs.length > 0 ? trailingArgs : undefined;
  runHandler(wrapArgs).catch((err) => {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Unexpected error: ${msg}`);
    exitFatal(`Unexpected error: ${msg}`);
  });
}
