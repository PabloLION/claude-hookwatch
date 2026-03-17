/**
 * Server spawn + health probe for hookwatch.
 *
 * Spawns the hookwatch server as a detached background process and polls
 * GET /health until the server is ready or a timeout is reached.
 *
 * STDOUT SUPPRESSION: All logging goes to stderr — NEVER console.log().
 *
 * Exported:
 *   spawnServer() — also reused by cli/ui.ts (the hookwatch ui command)
 */

import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { SPAWN_HEALTH_TIMEOUT_MS } from '@/config.ts';
import { errorMsg } from '@/errors.ts';
import { isErrnoException } from '@/guards.ts';
import { readPort, serverLogPath } from '@/paths.ts';

const HEALTH_POLL_INTERVAL_MS = 100;
const HEALTH_MAX_ATTEMPTS = 20; // 20 polls × 100ms sleep = 2s minimum; worst case ~12s with per-poll fetch timeout

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
    } catch (err) {
      // Connection refused and abort (timeout) are expected during startup.
      // Any other error type is unexpected — log it.
      const isExpected =
        (isErrnoException(err) &&
          (err.code === 'ConnectionRefused' || err.code === 'ECONNREFUSED')) ||
        err instanceof DOMException; // AbortSignal timeout fires as DOMException
      if (!isExpected) {
        console.error(`[hookwatch] Unexpected health probe error: ${errorMsg(err)}`);
      }
    }
  }

  return null;
}

/**
 * Result returned by spawnServer().
 *
 * Discriminated on the `ok` field:
 *   ok: true  → server is ready; `port` is the port it's listening on.
 *              `warning` is set when the log file could not be opened —
 *              the server still starts (inherited stderr fallback) but
 *              diagnostics may be lost.
 *   ok: false → server did not start; `failureKind` distinguishes:
 *     'spawn'  — Bun.spawn() itself threw (e.g. binary not found, EACCES).
 *     'retry'  — Bun.spawn() succeeded but health probe timed out.
 *     `message` carries the specific error for structured propagation to callers.
 *
 * Design note (G21): A `logFileOk: boolean` discriminant on the ok:true variant
 * was considered to distinguish "no warning" from "warning present" at the type
 * level. Skipped — there is only one call site and `warning !== undefined` already
 * covers the distinction without adding a redundant field callers must manage.
 */
export type SpawnResult =
  | { readonly ok: true; readonly port: number; readonly warning?: string }
  | { readonly ok: false; readonly failureKind: 'spawn' | 'retry'; readonly message: string };

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
 * Exported for reuse by cli/ui.ts (the hookwatch ui command).
 */
export async function spawnServer(): Promise<SpawnResult> {
  const logPath = serverLogPath();

  // recursive: true already handles EEXIST — real errors (EACCES, ENOSPC, etc.)
  // are caught and returned as a structured spawn failure.
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch (err) {
    const message = `Failed to create log directory: ${errorMsg(err)}`;
    console.error(`[hookwatch] ${message}`);
    return { ok: false, failureKind: 'spawn', message };
  }

  // Open log file for append (create if absent)
  let logFd = -1;
  let logFileWarning: string | undefined;
  try {
    logFd = openSync(logPath, 'a');
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] [warn] Failed to open server log file ${logPath}: ${msg}`);
    logFileWarning = `[warn] server log file unavailable (${msg}), diagnostics may be lost`;
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
    return { ok: false, failureKind: 'spawn', message: msg };
  }

  // Unref immediately — the handler must not wait for the server process
  child.unref();

  console.error('[hookwatch] Server spawned, polling health endpoint...');

  // Poll until the server is ready or timeout
  const port = await waitForHealth();

  if (port === null) {
    const timeoutSecs = (HEALTH_MAX_ATTEMPTS * HEALTH_POLL_INTERVAL_MS) / 1000;
    const message = `Server health check timed out after ${timeoutSecs}s`;
    console.error(`[hookwatch] ${message}`);
    return { ok: false, failureKind: 'retry', message };
  }

  console.error(`[hookwatch] Server ready on port ${port}`);
  return { ok: true, port, ...(logFileWarning !== undefined && { warning: logFileWarning }) };
}
