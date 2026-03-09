/**
 * Shared in-process HTTP test server for hookwatch tests.
 *
 * Provides a minimal Bun HTTP server that records received events and can
 * be programmed to return specific status codes. Used by handler.test.ts
 * and any other test that needs to verify what the handler POSTs.
 *
 * Extracted from src/handler/handler.test.ts lines 51-102.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReceivedEvent {
  body: unknown;
  status: number;
}

export interface TestServer {
  port: number;
  events: ReceivedEvent[];
  /** Override the next response status (default 201). */
  nextStatus: number;
  stop: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Starts a minimal Bun HTTP server that:
 *   - Handles POST /api/events — records the parsed body and responds with
 *     the current nextStatus (default 201).
 *   - Returns 404 for all other routes.
 *
 * The server binds to an OS-assigned free port (port: 0).
 * Call stop() in afterAll to release the port.
 */
export function startTestServer(): TestServer {
  const events: ReceivedEvent[] = [];
  const state = { nextStatus: 201 };

  const server = Bun.serve({
    port: 0, // OS-assigned free port
    async fetch(req) {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/events") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          body = null;
        }
        const status = state.nextStatus;
        events.push({ body, status });
        return new Response(JSON.stringify({ id: events.length }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    get port() {
      return server.port;
    },
    events,
    get nextStatus() {
      return state.nextStatus;
    },
    set nextStatus(v: number) {
      state.nextStatus = v;
    },
    stop: () => server.stop(true),
  };
}

// ---------------------------------------------------------------------------
// Port file helpers (used alongside TestServer)
// ---------------------------------------------------------------------------

/**
 * Writes a port file to `<xdgDataHome>/hookwatch/hookwatch.port`.
 * This is the location that portFilePath() resolves to, so the handler
 * finds the test server when XDG_DATA_HOME is set to xdgDataHome.
 */
export function writePortFile(xdgDataHome: string, port: number): void {
  const dir = join(xdgDataHome, "hookwatch");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hookwatch.port"), String(port));
}

/**
 * Writes an invalid (non-numeric) port file for negative testing.
 */
export function writeInvalidPortFile(xdgDataHome: string, content: string): void {
  const dir = join(xdgDataHome, "hookwatch");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hookwatch.port"), content);
}
