/**
 * Bun HTTP server for hookwatch.
 *
 * Responsibilities:
 *   - Bind to 127.0.0.1 (never 0.0.0.0)
 *   - Route dispatch: GET /health, POST /api/events, 404 fallback
 *   - Fixed port DEFAULT_PORT — error and exit if occupied (no auto-increment)
 *   - Write port to XDG port file after successful bind
 *   - Graceful shutdown: remove port file, close DB
 *   - Idle timeout: self-terminate after 1 hour of no HTTP requests
 *
 * Error codes used in responses: DB_LOCKED, NOT_FOUND, INVALID_QUERY, INTERNAL
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_PORT, IDLE_TIMEOUT_MS } from '@/config.ts';
import { close as closeDb } from '@/db/connection.ts';
import { errorMsg } from '@/errors.ts';
import { isErrnoException } from '@/guards.ts';
import { portFilePath } from '@/paths.ts';
import { errorResponse } from '@/server/errors.ts';
import { handleHealth } from '@/server/health.ts';
import { handleIngest } from '@/server/ingest.ts';
import { handleQuery } from '@/server/query.ts';
import { handleStatic } from '@/server/static.ts';
import { closeAll as closeSseClients, handleStream } from '@/server/stream.ts';
import { VERSION } from '@/version.ts';

const HOSTNAME = '127.0.0.1';

// ---------------------------------------------------------------------------
// Idle timeout
// ---------------------------------------------------------------------------

let idleTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownCallback: (() => void) | null = null;

/**
 * (Re)start the idle timer. Every incoming HTTP request must call this.
 * When the timer fires, the server shuts down gracefully.
 * Exported so tests can exercise timer behavior directly.
 */
export function resetIdleTimer(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    process.stderr.write('[hookwatch] Idle timeout reached — shutting down server\n');
    // Each cleanup step runs independently so a failure in one does not
    // prevent the remaining steps from executing.
    try {
      if (shutdownCallback !== null) shutdownCallback();
    } catch (err) {
      process.stderr.write(
        `[hookwatch] Error in shutdownCallback during idle shutdown: ${errorMsg(err)}\n`,
      );
    }
    try {
      closeSseClients();
    } catch (err) {
      process.stderr.write(
        `[hookwatch] Error closing SSE clients during idle shutdown: ${errorMsg(err)}\n`,
      );
    }
    try {
      closeDb();
    } catch (err) {
      process.stderr.write(`[hookwatch] Error closing DB during idle shutdown: ${errorMsg(err)}\n`);
    }
    try {
      removePortFile();
    } catch (err) {
      process.stderr.write(
        `[hookwatch] Error removing port file during idle shutdown: ${errorMsg(err)}\n`,
      );
    }
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
  // .unref() prevents the timer from keeping the process alive.
  // Guard: may be absent when setTimeout is mocked in tests.
  if (idleTimer !== null && 'unref' in idleTimer && typeof idleTimer.unref === 'function') {
    idleTimer.unref();
  }
}

/**
 * Cancel the idle timer. Called during explicit (non-timeout) shutdown so the
 * timer does not fire after the server is already stopped.
 */
function cancelIdleTimer(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Write the active port to the port file so the hook handler can discover it.
 * Failure is non-fatal — the handler falls back to DEFAULT_PORT when the file
 * is absent, so a failed write should not crash the server.
 */
async function writePortFile(port: number): Promise<void> {
  const portFile = portFilePath();
  try {
    mkdirSync(dirname(portFile), { recursive: true });
    await Bun.write(portFile, String(port));
  } catch (err) {
    process.stderr.write(
      `[hookwatch] Warning: could not write port file ${portFile}: ${errorMsg(err)}\n`,
    );
  }
}

/**
 * Delete the port file on graceful shutdown.
 */
function removePortFile(): void {
  const portFile = portFilePath();
  try {
    rmSync(portFile);
  } catch (err) {
    // ENOENT is expected — file may already be gone or was never created.
    // All other errors (EACCES, EBUSY, etc.) indicate a real problem.
    if (!isErrnoException(err) || err.code !== 'ENOENT') {
      process.stderr.write(
        `[hookwatch] Warning: could not remove port file ${portFile}: ${errorMsg(err)}\n`,
      );
    }
  }
}

/**
 * Attach X-Hookwatch-Version to every response.
 * Handles both synchronous Response values and Promise<Response>.
 * Creates a new Response that copies all existing headers and adds the version
 * header on top. SSE streaming responses (ReadableStream body) are forwarded
 * as-is — the body is not buffered or consumed.
 */
async function withVersionHeader(res: Response | Promise<Response>): Promise<Response> {
  const resolved = await res;
  const headers = new Headers(resolved.headers);
  headers.set('X-Hookwatch-Version', VERSION);
  return new Response(resolved.body, {
    status: resolved.status,
    statusText: resolved.statusText,
    headers,
  });
}

/**
 * Route a request to the correct handler.
 * Resets the idle timer on every request so inactivity is measured from the
 * last real HTTP activity on any endpoint.
 *
 * Route table:
 *   GET  /health              — health check
 *   POST /api/events          — event ingestion
 *   POST /api/query           — event query
 *   GET  /api/events/stream   — SSE live event stream
 *   GET  /                    — serve index.html
 *   GET  /*                   — serve UI assets (static or transpiled .ts)
 */
function dispatch(req: Request): Promise<Response> {
  resetIdleTimer();
  const url = new URL(req.url);

  if (req.method === 'GET' && url.pathname === '/health') {
    return withVersionHeader(handleHealth(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/events') {
    return withVersionHeader(handleIngest(req));
  }

  if (req.method === 'POST' && url.pathname === '/api/query') {
    return withVersionHeader(handleQuery(req));
  }

  if (req.method === 'GET' && url.pathname === '/api/events/stream') {
    return withVersionHeader(handleStream(req));
  }

  if (req.method === 'GET') {
    return withVersionHeader(handleStatic(url.pathname));
  }

  return withVersionHeader(
    errorResponse('NOT_FOUND', `No route for ${req.method} ${url.pathname}`),
  );
}

/** Thrown by startServer() when DEFAULT_PORT is already occupied. */
export class PortInUseError extends Error {
  constructor(public readonly port: number) {
    super(`Port ${port} is already in use — is another hookwatch server running?`);
    this.name = 'PortInUseError';
  }
}

/**
 * Start the server on DEFAULT_PORT. Throws PortInUseError if the port is
 * already occupied — no auto-increment.
 * Returns the bound server instance.
 */
export async function startServer(): Promise<{ port: number; stop: () => void }> {
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: HOSTNAME,
      port: DEFAULT_PORT,
      fetch: dispatch,
    });
  } catch (err) {
    // Bun exposes .code on the error object; message text varies by platform
    const isAddrInUse =
      (isErrnoException(err) && err.code === 'EADDRINUSE') ||
      (err instanceof Error && err.message.includes('address already in use'));

    if (isAddrInUse) {
      throw new PortInUseError(DEFAULT_PORT);
    }

    throw err;
  }

  await writePortFile(DEFAULT_PORT);

  const stop = (): void => {
    cancelIdleTimer();
    shutdownCallback = null;
    removePortFile();
    closeSseClients();
    closeDb();
    server.stop(true);
  };

  // Register the stop callback so the idle timeout handler can invoke it
  shutdownCallback = stop;

  // Start the initial idle timer now that the server is bound
  resetIdleTimer();

  return { port: DEFAULT_PORT, stop };
}

// ---------------------------------------------------------------------------
// Main entry — only runs when this file is executed directly (not imported)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  let serverRef: { port: number; stop: () => void };
  try {
    serverRef = await startServer();
  } catch (err) {
    if (err instanceof PortInUseError) {
      process.stderr.write(`[hookwatch] ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const { port, stop } = serverRef;
  console.log(`hookwatch server listening on http://${HOSTNAME}:${port}`);

  process.on('SIGINT', () => {
    stop();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stop();
    process.exit(0);
  });
}
