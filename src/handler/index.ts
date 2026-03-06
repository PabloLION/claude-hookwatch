/**
 * Hook handler entry point for hookwatch.
 *
 * Reads a Claude Code hook event from stdin, validates it with Zod, and POSTs
 * it to the local hookwatch server for storage.
 *
 * STDOUT SUPPRESSION: Claude Code interprets ANY stdout as hook output JSON.
 * All logging goes to stderr (console.error / process.stderr.write) — NEVER
 * console.log().
 *
 * Exit codes:
 *   0 — success (event forwarded)
 *   1 — any error (validation failure, network error, etc.)
 */

import { readFileSync } from "node:fs";
import { portFilePath } from "@/paths.ts";
import { parseHookEvent } from "@/schemas/events.ts";

const FALLBACK_PORT = 6004;
const FETCH_TIMEOUT_MS = 5000;
const SLOW_THRESHOLD_MS = 100;

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

  // POST to server
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "(unreadable)");
      console.error(`[hookwatch] Server returned ${res.status}: ${body}`);
      process.exit(1);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[hookwatch] Failed to POST event to server: ${msg}`);
    process.exit(1);
  }

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
