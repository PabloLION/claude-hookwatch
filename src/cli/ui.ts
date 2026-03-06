/**
 * hookwatch ui command.
 *
 * Checks if the server is running (reads port file). If not running, spawns
 * it using spawnServer() from src/handler/spawn.ts. Then opens the web UI
 * in the system browser.
 *
 * Platform detection:
 *   darwin  — open
 *   linux   — xdg-open
 *   win32   — start (not officially supported but handled gracefully)
 *
 * Port strategy:
 *   Fixed default port: 6004 (BASE_PORT). If 6004 is occupied by a
 *   non-hookwatch process (port responds but health check fails), print
 *   an error and exit 1.
 */

import { existsSync, readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { spawnServer } from "@/handler/spawn.ts";
import { portFilePath } from "@/paths.ts";

/** The fixed default port for hookwatch (matches server BASE_PORT). */
export const BASE_PORT = 6004;

const HEALTH_FETCH_TIMEOUT_MS = 1000;
const PORT_PROBE_TIMEOUT_MS = 500;

/**
 * Reads the port from the port file, or returns null if absent/invalid.
 */
export function readPortFile(): number | null {
  const path = portFilePath();
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf8").trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}

/**
 * Checks if the hookwatch server at the given port responds to GET /health
 * with a 200 OK.
 */
export async function isServerRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Checks if any HTTP server (not necessarily hookwatch) is listening on the
 * given port. Returns true if a connection is established (even if the
 * response is non-200 or not JSON).
 */
export async function isPortOccupied(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS),
    });
    // Any response (even 4xx/5xx) means something is listening
    return true;
  } catch (err) {
    // Connection refused / timeout → port is free
    const code = (err as NodeJS.ErrnoException).cause
      ? ((err as NodeJS.ErrnoException).cause as NodeJS.ErrnoException)?.code
      : (err as NodeJS.ErrnoException).code;
    // If the fetch itself errored (not just a bad status), port is not occupied
    // unless the error is a non-connection error (e.g., timeout with something listening)
    if (code === "ConnectionRefused" || code === "ECONNREFUSED") {
      return false;
    }
    // AbortError from timeout could mean something is slow but listening,
    // or nothing is there — treat as occupied to be safe only if we got a
    // partial response. In practice, an AbortError with no response means
    // nothing is listening (just slow), so treat as not occupied.
    return false;
  }
}

/**
 * Opens a URL in the system default browser.
 * Handles darwin, linux, and win32.
 */
export async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  let command: string;
  if (platform === "darwin") {
    command = "open";
  } else if (platform === "linux") {
    command = "xdg-open";
  } else if (platform === "win32") {
    command = "start";
  } else {
    console.warn(`[hookwatch] Unknown platform "${platform}" — cannot open browser automatically.`);
    console.log(`  Open manually: ${url}`);
    return;
  }

  const proc = Bun.spawn([command, url], {
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
}

export const uiCommand = defineCommand({
  meta: {
    name: "ui",
    description: "Start the hookwatch server (if needed) and open the web UI",
  },
  async run() {
    // Check if server is already running by reading the port file
    const storedPort = readPortFile();

    if (storedPort !== null && (await isServerRunning(storedPort))) {
      console.log(`Server already running on port ${storedPort}.`);
      const url = `http://localhost:${storedPort}`;
      console.log(`Opening ${url} ...`);
      await openBrowser(url);
      return;
    }

    // Server is not running — attempt to start it
    console.log("Starting hookwatch server...");
    const port = await spawnServer();

    if (port === null) {
      // Health check timed out — check if BASE_PORT is occupied by a foreign process
      if (await isPortOccupied(BASE_PORT)) {
        process.stderr.write(`[hookwatch] port ${BASE_PORT} in use\n`);
      } else {
        process.stderr.write("[hookwatch] Failed to start server — cannot open UI.\n");
      }
      process.exit(1);
    }

    console.log(`Server started on port ${port}.`);
    const url = `http://localhost:${port}`;
    console.log(`Opening ${url} ...`);
    await openBrowser(url);
  },
});
