/**
 * hookwatch ui command.
 *
 * Checks if the server is running (reads port file). If not running, spawns
 * it using spawnServer() from src/server-spawn.ts. Then opens the web UI
 * in the system browser.
 *
 * Platform detection:
 *   darwin  — open
 *   linux   — xdg-open
 *   win32   — start (not officially supported but handled gracefully)
 *
 * Port strategy:
 *   Fixed default port: DEFAULT_PORT (6004). If the port is occupied by a
 *   non-hookwatch process (port responds but health check fails), print
 *   an error and exit 1.
 */

import { existsSync, readFileSync } from 'node:fs';
import { defineCommand } from 'citty';
import { CLI_HEALTH_TIMEOUT_MS, DEFAULT_PORT } from '@/config.ts';
import { isErrnoException } from '@/guards.ts';
import { portFilePath } from '@/paths.ts';
import { spawnServer } from '@/server-spawn.ts';

const PORT_PROBE_TIMEOUT_MS = 500;
/** Maximum valid TCP port number. */
const MAX_PORT = 65535;

/**
 * Reads the port from the port file, or returns null if absent/invalid.
 */
export function readPortFile(): number | null {
  const path = portFilePath();
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, 'utf8').trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > MAX_PORT) return null;
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
      signal: AbortSignal.timeout(CLI_HEALTH_TIMEOUT_MS),
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
    // Bun wraps connection errors: the code may be on err itself or on err.cause
    const outerCode = isErrnoException(err) ? err.code : undefined;
    const cause = err instanceof Error ? err.cause : undefined;
    const innerCode = isErrnoException(cause) ? cause.code : undefined;
    const code = outerCode ?? innerCode;
    // If the fetch itself errored (not just a bad status), port is not occupied
    // unless the error is a non-connection error (e.g., timeout with something listening)
    if (code === 'ConnectionRefused' || code === 'ECONNREFUSED') {
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
  if (platform === 'darwin') {
    command = 'open';
  } else if (platform === 'linux') {
    command = 'xdg-open';
  } else if (platform === 'win32') {
    command = 'start';
  } else {
    console.warn(`[hookwatch] Unknown platform "${platform}" — cannot open browser automatically.`);
    console.log(`  Open manually: ${url}`);
    return;
  }

  const proc = Bun.spawn([command, url], {
    stdout: 'inherit',
    stderr: 'inherit',
  });

  await proc.exited;
}

export const uiCommand = defineCommand({
  meta: {
    name: 'ui',
    description: 'Start the hookwatch server (if needed) and open the web UI',
  },
  async run() {
    // Check if server is already running by reading the port file
    const storedPort = readPortFile();

    if (storedPort !== null && (await isServerRunning(storedPort))) {
      console.log(`Server already running on port ${storedPort}.`);
      const existingUrl = `http://localhost:${storedPort}`;
      console.log(`Opening ${existingUrl} ...`);
      await openBrowser(existingUrl);
      return;
    }

    // Server is not running — attempt to start it
    console.log('Starting hookwatch server...');
    const spawnResult = await spawnServer();

    if (!spawnResult.ok) {
      // Health check timed out or spawn failed — check if DEFAULT_PORT is occupied
      if (await isPortOccupied(DEFAULT_PORT)) {
        process.stderr.write(`[hookwatch] port ${DEFAULT_PORT} in use\n`);
      } else {
        process.stderr.write('[hookwatch] Failed to start server — cannot open UI.\n');
      }
      process.exit(1);
    }

    const { port } = spawnResult;
    console.log(`Server started on port ${port}.`);
    const url = `http://localhost:${port}`;
    console.log(`Opening ${url} ...`);
    await openBrowser(url);
  },
});
