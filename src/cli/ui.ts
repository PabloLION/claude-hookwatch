/**
 * hookwatch ui command.
 *
 * Checks if the server is running (reads port file). If not running, spawns
 * it using spawnServer() from src/server-spawn.ts. Then opens the web UI
 * in the system browser.
 *
 * Port strategy:
 *   Fixed default port: DEFAULT_PORT (6004). If the port is occupied by a
 *   non-hookwatch process (port responds but health check fails), print
 *   an error and exit 1.
 */

import { defineCommand } from 'citty';
import open from 'open';
import { CLI_HEALTH_TIMEOUT_MS, DEFAULT_PORT } from '@/config.ts';
import { errorMsg } from '@/errors.ts';
import { isErrnoException } from '@/guards.ts';
import { readPort } from '@/paths.ts';
import { spawnServer } from '@/server-spawn.ts';

const PORT_PROBE_TIMEOUT_MS = 500;

/**
 * Extract the error code from an unknown thrown value.
 * Bun wraps connection errors: the code may be on err itself or on err.cause.
 * Returns undefined when neither layer carries an errno code.
 */
function extractErrorCode(err: unknown): string | undefined {
  const outerCode = isErrnoException(err) ? err.code : undefined;
  const cause = err instanceof Error ? err.cause : undefined;
  const innerCode = isErrnoException(cause) ? cause.code : undefined;
  return outerCode ?? innerCode;
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
  } catch (err) {
    // ConnectionRefused / ECONNREFUSED: server not running — expected, silent
    // DOMException: AbortSignal timeout fired — expected, silent
    const code = extractErrorCode(err);
    const isExpected =
      code === 'ConnectionRefused' || code === 'ECONNREFUSED' || err instanceof DOMException;
    if (!isExpected) {
      process.stderr.write(`[hookwatch] Unexpected health probe error: ${errorMsg(err)}\n`);
    }
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
    const code = extractErrorCode(err);
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
 * Opens a URL in the system default browser using the `open` package.
 * Falls back to a manual URL hint if the open call fails.
 */
export async function openBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch (err) {
    console.warn(`[hookwatch] Failed to open browser: ${errorMsg(err)}`);
    console.log(`  Open manually: ${url}`);
  }
}

export const uiCommand = defineCommand({
  meta: {
    name: 'ui',
    description: 'Start the hookwatch server (if needed) and open the web UI',
  },
  async run() {
    // Check if server is already running by reading the port file.
    // readPort() always returns a port (falls back to DEFAULT_PORT on ENOENT);
    // the real check is whether the server is actually responding at that port.
    const { port: storedPort } = readPort();

    if (await isServerRunning(storedPort)) {
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
