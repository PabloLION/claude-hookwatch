/**
 * Tests for the Bun HTTP server (Story 1.3).
 *
 * Covers:
 *   - GET /health returns 200 with { status: "ok" }
 *   - POST /api/events with a valid payload returns 201 and an id
 *   - POST /api/events with invalid JSON returns 400 INVALID_QUERY
 *   - POST /api/events with a payload that fails Zod validation returns 400
 *   - Port auto-increment: binding a second server finds the next free port
 *   - Unknown routes return 404 NOT_FOUND
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { close as closeDb } from "@/db/connection.ts";
import { startServer } from "@/server/index.ts";

// Use a temp in-memory DB path for tests to avoid polluting real data.
// We override XDG_DATA_HOME so both connection.ts and index.ts use the temp dir.
const TMP_DATA_HOME = `/tmp/hookwatch-test-${Date.now()}`;

let serverPort: number;
let stopServer: () => void;

beforeAll(async () => {
  process.env.XDG_DATA_HOME = TMP_DATA_HOME;
  const result = await startServer();
  serverPort = result.port;
  stopServer = result.stop;
});

afterAll(() => {
  stopServer();
  closeDb();
  // Clean up env
  delete process.env.XDG_DATA_HOME;
});

function url(path: string): string {
  return `http://127.0.0.1:${serverPort}${path}`;
}

// ---------------------------------------------------------------------------
// Health endpoint
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  test("returns 200 with status ok", async () => {
    const res = await fetch(url("/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Event ingestion
// ---------------------------------------------------------------------------

const validSessionStart = {
  session_id: "test-session-001",
  transcript_path: "/tmp/transcript.json",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "SessionStart",
  source: "startup",
  model: "claude-opus-4-5",
};

describe("POST /api/events", () => {
  test("returns 201 with id for valid payload", async () => {
    const res = await fetch(url("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validSessionStart),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe("number");
    expect(body.id).toBeGreaterThan(0);
  });

  test("returns 400 for malformed JSON", async () => {
    const res = await fetch(url("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not valid json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  test("returns 400 when required Zod field is missing", async () => {
    // Missing session_id
    const res = await fetch(url("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript_path: "/tmp/t.json",
        cwd: "/home/user",
        permission_mode: "default",
        hook_event_name: "SessionStart",
        source: "startup",
        model: "claude-opus-4-5",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  test("returns 400 when hook_event_name value is wrong type for known event", async () => {
    const res = await fetch(url("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...validSessionStart,
        // "startup" is the valid value; use something invalid for source
        source: "invalid_source_value",
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_QUERY");
  });

  test("accepts unknown event type via fallback schema", async () => {
    const res = await fetch(url("/api/events"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "sess-002",
        transcript_path: "/tmp/t.json",
        cwd: "/home/user",
        permission_mode: "default",
        hook_event_name: "FutureUnknownEvent",
        extra_field: "preserved",
      }),
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  test("returns 404 for GET /nonexistent", async () => {
    const res = await fetch(url("/nonexistent"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// Port auto-increment
// ---------------------------------------------------------------------------

describe("port auto-increment", () => {
  test("second server binds to a different port when first port is taken", async () => {
    process.env.XDG_DATA_HOME = `${TMP_DATA_HOME}-port-test`;
    let stop2: (() => void) | undefined;
    try {
      const result2 = await startServer();
      stop2 = result2.stop;
      // Both servers bound successfully on different ports
      expect(result2.port).not.toBe(serverPort);
      expect(result2.port).toBeGreaterThan(serverPort);
    } finally {
      stop2?.();
      process.env.XDG_DATA_HOME = TMP_DATA_HOME;
    }
  });
});
