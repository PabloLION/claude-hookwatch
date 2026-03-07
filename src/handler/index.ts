/**
 * Hook handler entry point for hookwatch.
 *
 * Two modes (detected via HOOKWATCH_WRAP_ARGS environment variable):
 *
 * Bare mode (HOOKWATCH_WRAP_ARGS absent):
 *   Reads a Claude Code hook event from stdin, validates it with Zod, POSTs
 *   it to the local hookwatch server for storage, and writes a hook output JSON
 *   to stdout so Claude Code injects a systemMessage into the agent's context.
 *
 * Wrapped mode (HOOKWATCH_WRAP_ARGS set):
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
 *   2 — P1 fatal error (server unreachable, POST failed): JSON error to stdout
 *   In wrapped mode: child exit code is forwarded (pass-through)
 *   Never exits with code 1 — Claude Code shows generic "hook error" for exit 1
 *   and does not surface stderr. Exit 2 + JSON is strictly better.
 *
 * Error handling priority chain:
 *   P1 Fatal (server unreachable / POST fails): exit 2 + JSON stdout. Always.
 *   P2 Non-fatal (server OK, hookwatch internal issue): hookwatch_error in DB.
 *   P3 Normal: hookwatch_error NULL.
 *   Never mutate wrapped command exit code.
 */

import { readFileSync } from "node:fs";
import { portFilePath } from "@/paths.ts";
import type { HookEvent } from "@/schemas/events.ts";
import { parseHookEvent } from "@/schemas/events.ts";
import { hookOutputSchema } from "@/schemas/output.ts";
import { spawnServer } from "./spawn.ts";
import { runWrapped } from "./wrap.ts";

const FALLBACK_PORT = 6004;
const FETCH_TIMEOUT_MS = 5000;
const SLOW_THRESHOLD_MS = 100;

// ---------------------------------------------------------------------------
// Wrap args detection
// ---------------------------------------------------------------------------

/**
 * Returns the trailing command args for wrapped mode, or null for bare mode.
 * HOOKWATCH_WRAP_ARGS is set by cli/index.ts when trailing args are present.
 */
function getWrapArgs(): string[] | null {
  const raw = process.env.HOOKWATCH_WRAP_ARGS;
  if (raw === undefined || raw === "") return null;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((x) => typeof x === "string")) {
      return parsed as string[];
    }
  } catch {
    console.error(`[hookwatch] Failed to parse HOOKWATCH_WRAP_ARGS: ${raw}`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// P1 fatal error: exit 2 + JSON stdout
// ---------------------------------------------------------------------------

/**
 * Writes a P1 fatal error JSON to stdout and exits with code 2.
 *
 * Claude Code displays exit 2 + stdout JSON to the user, making the hookwatch
 * error visible. Never exits with code 1 (shows only a generic "hook error").
 *
 * This is the ONLY place where a non-child exit code is used. Wrapped mode
 * passes through the child exit code and calls this only for P1 errors before
 * the child has been spawned (i.e., when stdin parsing fails before spawn, or
 * when the server cannot be reached after the child exits).
 */
function exitFatal(message: string): never {
  const errorOutput = JSON.stringify({ hookwatch_fatal: message });
  process.stdout.write(errorOutput);
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Context injection: build systemMessage for Claude Code
// ---------------------------------------------------------------------------

/**
 * Extracts a subtype string from the event based on the event type.
 * Returns null for event types that have no meaningful subtype.
 */
function getEventSubtype(event: HookEvent): string | null {
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
function buildSystemMessage(event: HookEvent): string {
  const subtype = getEventSubtype(event);
  if (subtype !== null) {
    return `hookwatch captured ${event.hook_event_name} (${subtype})`;
  }
  return `hookwatch captured ${event.hook_event_name}`;
}

// ---------------------------------------------------------------------------
// Port resolution
// ---------------------------------------------------------------------------

/**
 * Reads the server port from the port file written by the server on startup.
 * Falls back to FALLBACK_PORT if the file is absent or unreadable.
 */
function readPort(): number {
  try {
    const content = readFileSync(portFilePath(), "utf8").trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      console.error(
        `[hookwatch] Port file contained invalid value "${content}", using fallback ${FALLBACK_PORT}`,
      );
      return FALLBACK_PORT;
    }
    return port;
  } catch {
    // File absent — server not started yet or running on default port
    return FALLBACK_PORT;
  }
}

// ---------------------------------------------------------------------------
// Server communication
// ---------------------------------------------------------------------------

/**
 * Returns true if the error indicates the server is not reachable (connection
 * refused, network error, etc.) — these are the cases where we should attempt
 * to auto-start the server and retry.
 */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Bun surfaces connection refusals with code "ConnectionRefused" and a
  // message like "Unable to connect. Is the computer able to access the url?"
  // Node.js uses code "ECONNREFUSED". Both are handled here.
  const code = (err as NodeJS.ErrnoException).code ?? "";
  const msg = err.message.toLowerCase();
  return (
    code === "ConnectionRefused" ||
    code === "ECONNREFUSED" ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    msg.includes("unable to connect") ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed")
  );
}

/** Options for postEvent — extends the base event with optional wrap metadata. */
interface PostEventOptions {
  port: number;
  event: ReturnType<typeof parseHookEvent>;
  /** Command string to store in wrapped_command column; null for bare mode. */
  wrappedCommand: string | null;
  /** Captured child stdout; null for bare mode. */
  stdout: string | null;
  /** Captured child stderr; null for bare mode. */
  stderr: string | null;
  /** Child exit code; null for bare mode. */
  exitCode: number | null;
  /** Hookwatch processing overhead in ms (excludes child process wall time). */
  hookDurationMs: number | null;
  /** Accumulated P2 non-fatal hookwatch errors; null = no errors. */
  hookwatchError: string | null;
}

/**
 * POSTs the event to the server at the given port.
 *
 * If the server is not reachable, attempts to spawn it automatically, then
 * retries the POST with the discovered port.
 *
 * Returns true on success, false on any unrecoverable error (P1 fatal).
 */
async function postEvent(opts: PostEventOptions): Promise<boolean> {
  const body: Record<string, unknown> = { ...opts.event };
  if (opts.wrappedCommand !== null) {
    body.wrapped_command = opts.wrappedCommand;
  }
  if (opts.stdout !== null) {
    body.stdout = opts.stdout;
  }
  if (opts.stderr !== null) {
    body.stderr = opts.stderr;
  }
  if (opts.exitCode !== null) {
    body.exit_code = opts.exitCode;
  }
  if (opts.hookDurationMs !== null) {
    body.hook_duration_ms = opts.hookDurationMs;
  }
  if (opts.hookwatchError !== null) {
    body.hookwatch_error = opts.hookwatchError;
  }
  const payload = JSON.stringify(body);

  // First attempt
  try {
    const res = await fetch(`http://127.0.0.1:${opts.port}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      console.error(`[hookwatch] Server returned ${res.status}: ${text}`);
      return false;
    }

    return true;
  } catch (err) {
    if (!isConnectionError(err)) {
      // Non-connection error (e.g. timeout, abort) — don't attempt spawn
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[hookwatch] Failed to POST event to server: ${msg}`);
      return false;
    }
  }

  // Server not reachable — attempt to spawn it
  console.error("[hookwatch] Server not reachable, attempting to start it...");
  const spawnedPort = await spawnServer();

  if (spawnedPort === null) {
    console.error("[hookwatch] Failed to start server — dropping event");
    return false;
  }

  // Retry POST with the port returned by the health check
  try {
    const res = await fetch(`http://127.0.0.1:${spawnedPort}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      console.error(`[hookwatch] Server returned ${res.status} on retry: ${text}`);
      return false;
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to POST event to server after spawn: ${msg}`);
    return false;
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
 *   P1 Fatal (server unreachable / POST fails): exitFatal() → exit 2 + JSON.
 *     In wrapped mode: only if server fails AFTER child exits (child code lost).
 *     Actually in wrapped mode P1 is best-effort — we still forward child code.
 *   P2 Non-fatal (server OK, hookwatch internal issue): accumulate hookwatchError.
 *   P3 Normal: hookwatchError null.
 */
async function handleHook(wrapArgs: string[] | null): Promise<void> {
  const wrappedCommand = wrapArgs !== null ? wrapArgs.join(" ") : null;

  // Accumulated P2 non-fatal errors (joined with "; " if multiple)
  const p2Errors: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1+2: Read stdin (and optionally spawn child in wrapped mode)
  // -------------------------------------------------------------------------

  let stdinJson: string;
  let childStdout: string | null = null;
  let childStderr: string | null = null;
  let childExitCode: number | null = null;

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

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdinJson);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to parse stdin as JSON: ${msg}`);
    if (wrapArgs !== null) {
      // Wrapped: best-effort — still forward child exit code
      // Parse failure is P2 non-fatal when child exited; server can't receive
      // event so we skip POST and just exit with child code
      process.exit(childExitCode ?? 0);
    }
    // Bare: P1 fatal — no event to store
    exitFatal(`Failed to parse stdin as JSON: ${msg}`);
  }

  let event: ReturnType<typeof parseHookEvent>;
  try {
    event = parseHookEvent(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Zod validation failed: ${msg}`);
    if (wrapArgs !== null) {
      // Wrapped: best-effort — still forward child exit code
      process.exit(childExitCode ?? 0);
    }
    // Bare: P1 fatal — can't validate event
    exitFatal(`Zod validation failed: ${msg}`);
  }

  // -------------------------------------------------------------------------
  // Step 4: Resolve port
  // -------------------------------------------------------------------------

  const port = readPort();

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
  const hookwatchError = p2Errors.length > 0 ? p2Errors.join("; ") : null;

  const postResult = await postEvent({
    port,
    event,
    wrappedCommand,
    stdout: wrapArgs !== null ? childStdout : hookOutputJson,
    stderr: wrapArgs !== null ? childStderr : null,
    exitCode: wrapArgs !== null ? childExitCode : 0,
    hookDurationMs: elapsedMs,
    hookwatchError,
  });

  if (!postResult) {
    if (wrapArgs !== null) {
      // Wrapped P1: server unreachable after child exited — best-effort.
      // Log the failure and continue to forward child exit code.
      // The hook output JSON is NOT written (server couldn't record the event).
      console.error("[hookwatch] Failed to POST wrapped event — continuing (best-effort)");
      process.exit(childExitCode ?? 0);
    }
    // Bare P1: server unreachable — exit 2 + JSON, stdout stays empty before this
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
    process.exit(childExitCode ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const wrapArgs = getWrapArgs();

handleHook(wrapArgs).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[hookwatch] Unexpected error: ${msg}`);
  exitFatal(`Unexpected error: ${msg}`);
});
