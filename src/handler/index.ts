/**
 * Hook handler entry point for hookwatch.
 *
 * Reads a Claude Code hook event from stdin, validates it with Zod, POSTs
 * it to the local hookwatch server for storage, and writes a hook output JSON
 * to stdout so Claude Code injects a systemMessage into the agent's context.
 *
 * STDOUT CONTRACT: Claude Code interprets ANY stdout as hook output JSON.
 * The ONLY write to stdout is the structured hook output object after a
 * successful POST. All other logging goes to stderr (console.error /
 * process.stderr.write) — NEVER console.log().
 *
 * Exit codes:
 *   0 — success (event forwarded, hook output written to stdout)
 *   1 — any error (validation failure, network error, etc.) — stdout EMPTY
 */

import { readFileSync } from "node:fs";
import { portFilePath } from "@/paths.ts";
import type { HookEvent } from "@/schemas/events.ts";
import { parseHookEvent } from "@/schemas/events.ts";
import { hookOutputSchema } from "@/schemas/output.ts";
import { spawnServer } from "./spawn.ts";

const FALLBACK_PORT = 6004;
const FETCH_TIMEOUT_MS = 5000;
const SLOW_THRESHOLD_MS = 100;

// ---------------------------------------------------------------------------
// Context injection: build systemMessage for Claude Code
// ---------------------------------------------------------------------------

/**
 * Extracts a subtype string from the event payload based on the event type.
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
 * Format: "Captured <EventType> (<subtype>)" when a subtype exists,
 * or "Captured <EventType>" when there is no subtype.
 *
 * TODO: configurable via config.toml (ch-1ex5.1)
 */
function buildSystemMessage(event: HookEvent): string {
  const subtype = getEventSubtype(event);
  if (subtype !== null) {
    return `Captured ${event.hook_event_name} (${subtype})`;
  }
  return `Captured ${event.hook_event_name}`;
}

/**
 * Writes the hook output JSON to stdout so Claude Code injects the
 * systemMessage into the agent's context.
 *
 * Context injection is always-on — no toggle.
 * TODO: configurable via config.toml (ch-1ex5.1)
 *
 * IMPORTANT: This is the ONLY place stdout is written. All other output goes
 * to stderr.
 */
function writeHookOutput(event: HookEvent): void {
  const output = hookOutputSchema.parse({
    continue: true,
    systemMessage: buildSystemMessage(event),
  });
  process.stdout.write(JSON.stringify(output));
}

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

/**
 * POSTs the event to the server at the given port.
 *
 * If the server is not reachable, attempts to spawn it automatically, then
 * retries the POST with the discovered port.
 *
 * Returns true on success, false on any unrecoverable error.
 */
async function postEvent(port: number, event: ReturnType<typeof parseHookEvent>): Promise<boolean> {
  const payload = JSON.stringify(event);

  // First attempt
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.error(`[hookwatch] Server returned ${res.status}: ${body}`);
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
      const body = await res.text().catch(() => "(unreadable)");
      console.error(`[hookwatch] Server returned ${res.status} on retry: ${body}`);
      return false;
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to POST event to server after spawn: ${msg}`);
    return false;
  }
}

async function run(): Promise<void> {
  const startMs = Date.now();

  // Read entire stdin (Claude Code pipes the event JSON here)
  const raw = await Bun.stdin.text();

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to parse stdin as JSON: ${msg}`);
    process.exit(1);
  }

  // Validate with Zod (discriminated by hook_event_name)
  let event: ReturnType<typeof parseHookEvent>;
  try {
    event = parseHookEvent(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Zod validation failed: ${msg}`);
    process.exit(1);
  }

  // Resolve server port
  const port = readPort();

  // POST to server, auto-starting it if not running
  const postResult = await postEvent(port, event);
  if (!postResult) {
    // On failure: exit 1, stdout remains empty — Claude Code must not receive
    // partial or malformed hook output JSON.
    process.exit(1);
  }

  // Write hook output JSON to stdout for Claude Code context injection.
  // This is the ONLY stdout write in the entire handler.
  writeHookOutput(event);

  // Log slow handler execution to stderr (never stdout)
  const elapsedMs = Date.now() - startMs;
  if (elapsedMs > SLOW_THRESHOLD_MS) {
    console.error(`[hookwatch] Handler took ${elapsedMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`);
  }
}

run().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[hookwatch] Unexpected error: ${msg}`);
  process.exit(1);
});
