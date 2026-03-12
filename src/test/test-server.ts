/**
 * Shared in-process HTTP test server for hookwatch tests.
 *
 * Provides a minimal Bun HTTP server that records received events and can
 * be programmed to return specific status codes. Used by handler.test.ts
 * and any other test that needs to verify what the handler POSTs.
 *
 * Extracted from src/handler/handler.test.ts (originally lines 51-102).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
  /**
   * Version string to return in X-Hookwatch-Version response header.
   * Defaults to null (header absent). Set to a semver string to simulate
   * version mismatch detection in the handler.
   */
  serverVersion: string | null;
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
  const state = { nextStatus: 201, serverVersion: null as string | null };

  const server = Bun.serve({
    port: 0, // OS-assigned free port
    async fetch(req) {
      if (req.method === 'POST' && new URL(req.url).pathname === '/api/events') {
        let body: unknown;
        try {
          body = await req.json();
        } catch (err) {
          console.error('[test-server] req.json() parse failed:', err);
          body = null;
        }
        const status = state.nextStatus;
        events.push({ body, status });
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (state.serverVersion !== null) {
          headers['X-Hookwatch-Version'] = state.serverVersion;
        }
        return new Response(JSON.stringify({ id: events.length }), { status, headers });
      }
      return new Response('not found', { status: 404 });
    },
  });

  const { port } = server;
  if (port === undefined) throw new Error('Bun.serve() did not assign a port');

  return {
    port,
    events,
    get nextStatus() {
      return state.nextStatus;
    },
    set nextStatus(v: number) {
      state.nextStatus = v;
    },
    get serverVersion() {
      return state.serverVersion;
    },
    set serverVersion(v: string | null) {
      state.serverVersion = v;
    },
    stop: () => server.stop(true),
  };
}

// ---------------------------------------------------------------------------
// Port file helpers (used alongside TestServer)
// ---------------------------------------------------------------------------

/**
 * Returns the parsed body of the first recorded event as a plain object.
 * Convenience helper to avoid repeating `server.events[0]?.body as Record<string, unknown>`
 * in every test that needs to inspect the POST body.
 */
export function firstEventBody(server: TestServer): Record<string, unknown> {
  return server.events[0]?.body as Record<string, unknown>;
}

/**
 * Writes a port file to `<xdgDataHome>/hookwatch/hookwatch.port`.
 * This is the location that portFilePath() resolves to, so the handler
 * finds the test server when XDG_DATA_HOME is set to xdgDataHome.
 *
 * Pass a number for a valid port; pass a string for invalid content (negative
 * testing).
 */
export function writePortFile(xdgDataHome: string, content: number | string): void {
  const dir = join(xdgDataHome, 'hookwatch');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'hookwatch.port'), String(content));
}
