/**
 * Server spawn + health probe for hookwatch.
 *
 * Spawns the hookwatch server as a detached background process and polls
 * GET /health until the server is ready or a timeout is reached.
 *
 * STDOUT SUPPRESSION: All logging goes to stderr — NEVER console.log().
 *
 * Exported:
 *   spawnServer() — also reused by cli/ui.ts (Story 2.5)
 */

import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPAWN_HEALTH_TIMEOUT_MS } from '@/config.ts';
import { errorMsg } from '@/handler/errors.ts';
import { readPort, serverLogPath } from '@/paths.ts';

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_MAX_ATTEMPTS = 20; // 20 * 100ms = 2s max

/** Absolute path to the server entry point.
 * import.meta.url is file:///…/src/server-spawn.ts
 * Same directory (./): src/
 * Then server/index.ts → src/server/index.ts
 */
const SERVER_ENTRY = new URL('./server/index.ts', import.meta.url).pathname;

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
    const { port } = readPort();

    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(SPAWN_HEALTH_TIMEOUT_MS),
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
 * Result returned by spawnServer().
 *
 * Discriminated on the `ok` field:
 *   ok: true  → server is ready; `port` is the port it's listening on.
 *   ok: false → server did not start; `failureKind` distinguishes:
 *     'spawn'  — Bun.spawn() itself threw (e.g. binary not found, EACCES).
 *     'retry'  — Bun.spawn() succeeded but health probe timed out.
 */
export type SpawnResult =
  | { ok: true; port: number }
  | { ok: false; failureKind: 'spawn' | 'retry' };

/**
 * Spawns the hookwatch server as a detached background process.
 *
 * - Uses Bun.spawn() with detached: true
 * - Calls .unref() immediately so the handler can exit without waiting
 * - Redirects server stdout/stderr to serverLogPath()
 * - Polls GET /health until ready (max 2s)
 *
 * Returns a SpawnResult discriminated on ok. Callers use failureKind to
 * distinguish a spawn failure ('spawn') from a health-probe timeout ('retry').
 *
 * Exported for reuse by cli/ui.ts (Story 2.5).
 */
export async function spawnServer(): Promise<SpawnResult> {
  const logPath = serverLogPath();

  // Ensure log directory exists.
  // recursive: true already handles EEXIST — real errors (EACCES, ENOSPC, etc.)
  // must propagate so the caller knows the spawn setup failed.
  mkdirSync(dirname(logPath), { recursive: true });

  // Open log file for append (create if absent)
  let logFd = -1;
  try {
    logFd = openSync(logPath, 'a');
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to open server log file ${logPath}: ${msg}`);
    // Continue without log file — use inherited stderr as fallback
  }

  // Build stdio target: use the fd if we opened it, otherwise inherit stderr
  const stdioTarget = logFd >= 0 ? logFd : 'inherit';

  // Spawn the server detached so it outlives the handler process
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(['bun', '--bun', SERVER_ENTRY], {
      stdin: 'ignore',
      stdout: stdioTarget,
      stderr: stdioTarget,
      detached: true,
    });
    // Close the log fd in the parent — the child inherits its own copy.
    // Leaving it open in the parent leaks a file descriptor.
    if (logFd >= 0) closeSync(logFd);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to spawn server: ${msg}`);
    if (logFd >= 0) closeSync(logFd);
    return { ok: false, failureKind: 'spawn' };
  }

  // Unref immediately — the handler must not wait for the server process
  child.unref();

  console.error('[hookwatch] Server spawned, polling health endpoint...');

  // Poll until the server is ready or timeout
  const port = await waitForHealth();

  if (port === null) {
    console.error(
      `[hookwatch] Server health check timed out after ${(HEALTH_MAX_ATTEMPTS * HEALTH_POLL_INTERVAL_MS) / 1000}s`,
    );
    return { ok: false, failureKind: 'retry' };
  }

  console.error(`[hookwatch] Server ready on port ${port}`);
  return { ok: true, port };
}
