/**
 * Hook handler entry point for hookwatch.
 *
 * Two modes (detected via HOOKWATCH_WRAP_ARGS environment variable):
 *
 * Bare mode (no trailing args):
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
 * In bare mode, the ONLY write to stdout is the structured hook output object
 * after a successful POST. All other logging goes to stderr (console.error /
 * process.stderr.write) — NEVER console.log().
 * In wrapped mode, the child's stdout is passed through first, then the hook
 * output JSON is appended.
 *
 * Exit codes:
 *   0 — success (event forwarded, hook output written to stdout)
 *   1 — any error (validation failure, network error, etc.) — hook JSON absent
 *   In wrapped mode: child exit code is forwarded (best-effort server POST)
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
    case "Setup":
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

/**
 * Writes the hook output JSON to stdout so Claude Code injects the
 * systemMessage into the agent's context.
 *
 * Context injection is always-on — no toggle.
 * TODO: configurable via config.toml (ch-1ex5.1)
 *
 * IMPORTANT: In bare mode this is the ONLY place stdout is written.
 * In wrapped mode, child stdout precedes this write.
 */
function writeHookOutput(event: HookEvent): void {
  const output = hookOutputSchema.parse({
    continue: true,
    systemMessage: buildSystemMessage(event),
  });
  process.stdout.write(JSON.stringify(output));
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
}

/**
 * POSTs the event to the server at the given port.
 *
 * If the server is not reachable, attempts to spawn it automatically, then
 * retries the POST with the discovered port.
 *
 * Returns true on success, false on any unrecoverable error.
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
// Stdin parsing (shared by both modes)
// ---------------------------------------------------------------------------

/** Reads and validates stdin; returns the parsed event or exits on error. */
async function readEvent(): Promise<ReturnType<typeof parseHookEvent>> {
  const raw = await Bun.stdin.text();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to parse stdin as JSON: ${msg}`);
    process.exit(1);
  }

  try {
    return parseHookEvent(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Zod validation failed: ${msg}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main execution paths
// ---------------------------------------------------------------------------

/**
 * Bare mode: read stdin → validate → POST → write hook output.
 * Exits 0 on success, 1 on any error.
 */
async function runBare(): Promise<void> {
  const startMs = Date.now();

  const event = await readEvent();
  const port = readPort();

  // Build hook output JSON before POSTing so we can store it as stdout.
  const hookOutput = hookOutputSchema.parse({
    continue: true,
    systemMessage: buildSystemMessage(event),
  });
  const hookOutputJson = JSON.stringify(hookOutput);

  const postResult = await postEvent({
    port,
    event,
    wrappedCommand: null,
    stdout: hookOutputJson,
    stderr: null,
    exitCode: 0,
  });
  if (!postResult) {
    // On failure: exit 1, stdout remains empty — Claude Code must not receive
    // partial or malformed hook output JSON.
    process.exit(1);
  }

  // Write hook output JSON to stdout for Claude Code context injection.
  // This is the ONLY stdout write in bare mode.
  process.stdout.write(hookOutputJson);

  // Log slow handler execution to stderr (never stdout)
  const elapsedMs = Date.now() - startMs;
  if (elapsedMs > SLOW_THRESHOLD_MS) {
    console.error(`[hookwatch] Handler took ${elapsedMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`);
  }
}

/**
 * Wrapped mode: read stdin concurrently with child execution, tee child I/O,
 * POST event with captured output, write hook output, forward child exit code.
 *
 * Best-effort: if the server is unreachable even after auto-start, the child's
 * I/O is still passed through and its exit code is forwarded.
 *
 * Stdin handling: runWrapped() reads stdin into a buffer, pipes it to the child
 * so the child receives the Claude Code event JSON, and returns the raw string
 * for us to parse as the event.
 */
async function runWrappedMode(wrapArgs: string[]): Promise<void> {
  const wrappedCommand = wrapArgs.join(" ");

  // runWrapped reads stdin, tees child stdout/stderr, and returns everything.
  const wrapResult = await runWrapped(wrapArgs);

  // Parse the event from the buffered stdin content.
  let event: ReturnType<typeof parseHookEvent>;
  try {
    const parsed = JSON.parse(wrapResult.stdin);
    event = parseHookEvent(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to parse event from wrapped stdin: ${msg}`);
    // Still forward child exit code even if event parsing fails
    process.exit(wrapResult.exitCode);
  }

  // POST the event with captured I/O — best-effort (don't fail wrapped command
  // if server is down).
  const port = readPort();
  const postResult = await postEvent({
    port,
    event,
    wrappedCommand,
    stdout: wrapResult.stdout,
    stderr: wrapResult.stderr,
    exitCode: wrapResult.exitCode,
  });
  if (!postResult) {
    console.error("[hookwatch] Failed to POST wrapped event — continuing (best-effort)");
    // Don't exit here — still forward the child's exit code
  }

  // Write hook output JSON for Claude Code context injection.
  // In wrapped mode the child's stdout was already written by teeStream.
  // The hook JSON is appended after it.
  if (postResult) {
    writeHookOutput(event);
  }

  // Forward child exit code — this is the primary purpose of wrapped mode.
  process.exit(wrapResult.exitCode);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const wrapArgs = getWrapArgs();

if (wrapArgs !== null) {
  runWrappedMode(wrapArgs).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Unexpected error in wrapped mode: ${msg}`);
    process.exit(1);
  });
} else {
  runBare().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Unexpected error: ${msg}`);
    process.exit(1);
  });
}
