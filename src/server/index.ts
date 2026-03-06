/**
 * Bun HTTP server for hookwatch.
 *
 * Responsibilities:
 *   - Bind to 127.0.0.1 (never 0.0.0.0) — AC #1
 *   - Route dispatch: GET /health, POST /api/events, 404 fallback
 *   - Port auto-increment: start at 6004, retry on EADDRINUSE — AC #4
 *   - Write chosen port to XDG port file after successful bind — Story 1.3 decision
 *   - Graceful shutdown: remove port file, close DB
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

const BASE_PORT = 6004;
const MAX_PORT = 6064; // 60 retries before giving up
const HOSTNAME = "127.0.0.1";

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
 *
 * Route table:
 *   GET  /health        — health check
 *   POST /api/events    — event ingestion
 *   POST /api/query     — event query
 *   GET  /              — serve index.html
 *   GET  /*             — serve UI assets (static or transpiled .ts)
 */
function dispatch(req: Request): Response | Promise<Response> {
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
        removePortFile();
        closeDb();
        server.stop(true);
      };

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
