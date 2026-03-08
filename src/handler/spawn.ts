/**
 * Server spawn + health probe for hookwatch.
 *
 * Spawns the hookwatch server as a detached background process and polls
 * GET /health until the server is ready or a timeout is reached.
 *
 * STDOUT SUPPRESSION: All logging goes to stderr — NEVER console.log().
 *
 * Exported:
 *   spawnServer() — also reused by cli/open.ts (Story 2.5)
 */

import { mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_PORT, portFilePath, serverLogPath } from "@/paths.ts";
import { errorMsg } from "./errors.ts";

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_MAX_ATTEMPTS = 20; // 20 * 100ms = 2s max
const HEALTH_FETCH_TIMEOUT_MS = 500;

/** Absolute path to the server entry point.
 * import.meta.url is file:///…/src/handler/spawn.ts
 * One level up (../): src/handler/ → src/
 * Then server/index.ts → src/server/index.ts
 */
const SERVER_ENTRY = new URL("../server/index.ts", import.meta.url).pathname;

/**
 * Reads the server port synchronously from the port file.
 * Returns DEFAULT_PORT if the file is absent or contains an invalid value.
 */
function readPortFileSync(): number {
  try {
    const content = readFileSync(portFilePath(), "utf8").trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      return DEFAULT_PORT;
    }
    return port;
  } catch {
    return DEFAULT_PORT;
  }
}

/**
 * Waits for the server to respond to GET /health.
 * Polls every HEALTH_POLL_INTERVAL_MS for up to HEALTH_MAX_ATTEMPTS attempts.
 *
 * Returns the port on success, or null on timeout.
 */
async function waitForHealth(): Promise<number | null> {
  for (let attempt = 0; attempt < HEALTH_MAX_ATTEMPTS; attempt++) {
    // Wait before each poll to give the server time to start
    await new Promise<void>((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));

    // Read the port file — the server writes it after successfully binding
    const port = readPortFileSync();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(HEALTH_FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        return port;
      }
    } catch {
      // Server not up yet — continue polling
    }
  }

  return null;
}

/**
 * Spawns the hookwatch server as a detached background process.
 *
 * - Uses Bun.spawn() with detached: true
 * - Calls .unref() immediately so the handler can exit without waiting
 * - Redirects server stdout/stderr to serverLogPath()
 * - Polls GET /health until ready (max 2s)
 *
 * Returns the port the server is listening on, or null if health check timed out.
 *
 * Exported for reuse by cli/open.ts (Story 2.5).
 */
export async function spawnServer(): Promise<number | null> {
  const logPath = serverLogPath();

  // Ensure log directory exists
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {
    // Ignore — directory may already exist
  }

  // Open log file for append (create if absent)
  let logFd = -1;
  try {
    logFd = openSync(logPath, "a");
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to open server log file ${logPath}: ${msg}`);
    // Continue without log file — use inherited stderr as fallback
  }

  // Build stdio target: use the fd if we opened it, otherwise inherit stderr
  const stdioTarget = logFd >= 0 ? logFd : "inherit";

  // Spawn the server detached so it outlives the handler process
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(["bun", "--bun", SERVER_ENTRY], {
      stdin: "ignore",
      stdout: stdioTarget,
      stderr: stdioTarget,
      detached: true,
    });
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to spawn server: ${msg}`);
    return null;
  }

  // Unref immediately — the handler must not wait for the server process
  child.unref();

  console.error("[hookwatch] Server spawned, polling health endpoint...");

  // Poll until the server is ready or timeout
  const port = await waitForHealth();

  if (port === null) {
    console.error(
      `[hookwatch] Server health check timed out after ${(HEALTH_MAX_ATTEMPTS * HEALTH_POLL_INTERVAL_MS) / 1000}s`,
    );
    return null;
  }

  console.error(`[hookwatch] Server ready on port ${port}`);
  return port;
}
