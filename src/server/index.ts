/**
 * Bun HTTP server for hookwatch.
 *
 * Responsibilities:
 *   - Bind to 127.0.0.1 (never 0.0.0.0) — AC #1
 *   - Route dispatch: GET /health, POST /api/events, 404 fallback
 *   - Port auto-increment: start at 6004, retry on EADDRINUSE — AC #4
 *   - Write chosen port to XDG port file after successful bind — Story 1.3 decision
 *   - Graceful shutdown: remove port file, close DB
 *   - Idle timeout: self-terminate after 1 hour of no HTTP requests — Story 2.6
 *
 * Error codes used in responses: DB_LOCKED, NOT_FOUND, INVALID_QUERY, INTERNAL
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { close as closeDb } from "@/db/connection.ts";
import { portFilePath } from "@/paths.ts";
import { errorResponse } from "@/server/errors.ts";
import { handleHealth } from "@/server/health.ts";
import { handleIngest } from "@/server/ingest.ts";
import { handleQuery } from "@/server/query.ts";
import { handleStatic } from "@/server/static.ts";
import { closeAll as closeSseClients, handleStream } from "@/server/stream.ts";

const BASE_PORT = 6004;
const MAX_PORT = 6064; // 60 retries before giving up
const HOSTNAME = "127.0.0.1";

// ---------------------------------------------------------------------------
// Idle timeout
// ---------------------------------------------------------------------------

/** Duration of inactivity before the server self-terminates.
 * TODO: configurable via config.toml (ch-1ex5.1)
 */
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

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
    process.stderr.write("[hookwatch] Idle timeout reached — shutting down server\n");
    if (shutdownCallback !== null) shutdownCallback();
    closeSseClients();
    closeDb();
    removePortFile();
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
  // Allow the process to exit even while the timer is pending.
  // Without this, Node/Bun keeps the event loop alive indefinitely.
  // .unref() is a Bun/Node extension that prevents the timer from keeping the
  // process alive. It may not be present when setTimeout is mocked in tests.
  if (typeof (idleTimer as { unref?: () => void }).unref === "function") {
    (idleTimer as { unref: () => void }).unref();
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
 */
function writePortFile(port: number): void {
  const portFile = portFilePath();
  mkdirSync(dirname(portFile), { recursive: true });
  writeFileSync(portFile, String(port), { encoding: "utf8" });
}

/**
 * Delete the port file on graceful shutdown.
 */
function removePortFile(): void {
  const portFile = portFilePath();
  try {
    rmSync(portFile);
  } catch {
    // Ignore — file may already be gone
  }
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
function dispatch(req: Request): Response | Promise<Response> {
  resetIdleTimer();
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/health") {
    return handleHealth(req);
  }

  if (req.method === "POST" && url.pathname === "/api/events") {
    return handleIngest(req);
  }

  if (req.method === "POST" && url.pathname === "/api/query") {
    return handleQuery(req);
  }

  if (req.method === "GET" && url.pathname === "/api/events/stream") {
    return handleStream(req);
  }

  if (req.method === "GET") {
    return handleStatic(url.pathname);
  }

  return errorResponse("NOT_FOUND", `No route for ${req.method} ${url.pathname}`, 404);
}

/**
 * Start the server, incrementing the port on EADDRINUSE.
 * Returns the bound server instance.
 */
export async function startServer(): Promise<{ port: number; stop: () => void }> {
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    try {
      const server = Bun.serve({
        hostname: HOSTNAME,
        port,
        fetch: dispatch,
      });

      writePortFile(port);

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

      return { port, stop };
    } catch (err) {
      const isAddrInUse =
        err instanceof Error &&
        // Bun exposes .code on the error object; message text varies by platform
        ((err as NodeJS.ErrnoException).code === "EADDRINUSE" ||
          err.message.includes("address already in use"));

      if (isAddrInUse && port < MAX_PORT) {
        // Try next port
        continue;
      }

      throw err;
    }
  }

  // Should be unreachable — loop always returns or throws inside
  throw new Error(`No available port in range [${BASE_PORT}, ${MAX_PORT}]`);
}

// ---------------------------------------------------------------------------
// Main entry — only runs when this file is executed directly (not imported)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const { port, stop } = await startServer();
  console.log(`hookwatch server listening on http://${HOSTNAME}:${port}`);

  process.on("SIGINT", () => {
    stop();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(0);
  });
}
