/**
 * Tests for the Bun HTTP server (Stories 1.3, 2.1a, ch-f2tr).
 *
 * Covers:
 *   - GET /health returns 200 with { status: "ok", app: "hookwatch", version: "<semver>" }
 *   - X-Hookwatch-Version header present on all routes
 *   - POST /api/events with a valid payload returns 201 and an id
 *   - POST /api/events with invalid JSON returns 400 INVALID_QUERY
 *   - POST /api/events with a payload that fails Zod validation returns 400
 *   - Fixed port: startServer() throws PortInUseError when port is occupied
 *   - Unknown routes return 404 NOT_FOUND
 *   - POST /api/query: valid filter, empty result, invalid filter (Story 2.1a)
 *   - GET /: serves index.html (Story 2.1a)
 *   - GET /app.ts: transpiles .ts file (Story 2.1a)
 *   - GET /nonexistent.html: 404 for missing UI file (Story 2.1a)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { close as closeDb } from '@/db/connection.ts';
import { PortInUseError, startServer } from '@/server/index.ts';
import { BASE_SESSION_START } from '@/test';
import { VERSION } from '@/version.ts';

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

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const res = await fetch(url('/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });

  test('returns app and version fields in JSON body', async () => {
    const res = await fetch(url('/health'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.app).toBe('hookwatch');
    expect(typeof body.version).toBe('string');
    expect(body.version).toBe(VERSION);
    // version must be a valid semver string (e.g. "0.1.0")
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// X-Hookwatch-Version header
// ---------------------------------------------------------------------------

describe('X-Hookwatch-Version header', () => {
  test('present on GET /health', async () => {
    const res = await fetch(url('/health'));
    expect(res.headers.get('X-Hookwatch-Version')).toBe(VERSION);
  });

  test('present on POST /api/events (201)', async () => {
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASE_SESSION_START),
    });
    expect(res.headers.get('X-Hookwatch-Version')).toBe(VERSION);
  });

  test('present on POST /api/events (400 error response)', async () => {
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json',
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('X-Hookwatch-Version')).toBe(VERSION);
  });

  test('present on POST /api/query', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.headers.get('X-Hookwatch-Version')).toBe(VERSION);
  });

  test('present on GET / (static file)', async () => {
    const res = await fetch(url('/'));
    expect(res.headers.get('X-Hookwatch-Version')).toBe(VERSION);
  });

  test('present on 404 for unknown route', async () => {
    const res = await fetch(url('/no-such-route-xyz'));
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Hookwatch-Version')).toBe(VERSION);
  });
});

// ---------------------------------------------------------------------------
// Event ingestion
// ---------------------------------------------------------------------------

const validSessionStart = BASE_SESSION_START;

describe('POST /api/events', () => {
  test('returns 201 with id for valid payload', async () => {
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validSessionStart),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('number');
    expect(body.id).toBeGreaterThan(0);
  });

  test('returns 400 for malformed JSON', async () => {
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not valid json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  test('returns 400 when required Zod field is missing', async () => {
    // Missing session_id
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript_path: '/tmp/t.json',
        cwd: '/home/user',
        permission_mode: 'default',
        hook_event_name: 'SessionStart',
        source: 'startup',
        model: 'claude-opus-4-5',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  test('returns 400 when hook_event_name value is wrong type for known event', async () => {
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validSessionStart,
        // "startup" is the valid value; use something invalid for source
        source: 'invalid_source_value',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  test('accepts unknown event type via fallback schema', async () => {
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: 'sess-002',
        transcript_path: '/tmp/t.json',
        cwd: '/home/user',
        permission_mode: 'default',
        hook_event_name: 'FutureUnknownEvent',
        extra_field: 'preserved',
      }),
    });
    expect(res.status).toBe(201);
  });

  test('accepts wrapped_command field and returns 201 (Story 3.1)', async () => {
    // When the handler runs in wrapped mode, it POSTs the event with an
    // additional wrapped_command field. The server should accept it.
    const res = await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...validSessionStart,
        session_id: 'wrap-test-session',
        wrapped_command: './my-hook.sh arg1',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe('unknown routes', () => {
  test('returns 404 for GET /nonexistent', async () => {
    const res = await fetch(url('/nonexistent'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Fixed port — PortInUseError when occupied
// ---------------------------------------------------------------------------

describe('fixed port', () => {
  test('startServer() throws PortInUseError when DEFAULT_PORT is already bound', async () => {
    // The global beforeAll already bound DEFAULT_PORT.
    // A second startServer() call should throw PortInUseError, not succeed.
    process.env.XDG_DATA_HOME = `${TMP_DATA_HOME}-port-test`;
    try {
      await expect(startServer()).rejects.toBeInstanceOf(PortInUseError);
    } finally {
      process.env.XDG_DATA_HOME = TMP_DATA_HOME;
    }
  });
});

// ---------------------------------------------------------------------------
// Query endpoint (Story 2.1a)
// ---------------------------------------------------------------------------

describe('POST /api/query', () => {
  // Insert a known event before running query tests
  beforeAll(async () => {
    await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validSessionStart),
    });
  });

  test('returns 200 with an array for empty filter (uses defaults)', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  test('filters by session_id and returns matching events', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: validSessionStart.session_id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect(row.session_id).toBe(validSessionStart.session_id);
    }
  });

  test('returns empty array when no events match the filter', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'no-such-session-xyz' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test('returns 400 INVALID_QUERY when limit is not a number', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 'not-a-number' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  test('returns 400 INVALID_QUERY for malformed JSON body', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ bad json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_QUERY');
  });

  test('filters by hook_event_name', async () => {
    const res = await fetch(url('/api/query'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'SessionStart' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const row of body) {
      expect(row.event).toBe('SessionStart');
    }
  });
});

// ---------------------------------------------------------------------------
// Static file handler (Story 2.1a)
// ---------------------------------------------------------------------------

describe('GET /', () => {
  test('serves index.html with text/html content-type', async () => {
    const res = await fetch(url('/'));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('<!doctype html');
  });
});

describe('GET /app.ts', () => {
  test('transpiles .ts file and serves as application/javascript', async () => {
    const res = await fetch(url('/app.ts'));
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('application/javascript');
    const body = await res.text();
    // The transpiler output should not contain TypeScript-only syntax
    expect(body).not.toContain('import type');
  });
});

describe('GET missing UI file', () => {
  test('returns 404 NOT_FOUND for non-existent asset', async () => {
    const res = await fetch(url('/does-not-exist.html'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// SSE stream endpoint (Story 2.4a)
// ---------------------------------------------------------------------------

describe('GET /api/events/stream', () => {
  test('returns SSE response with correct headers and delivers broadcast event', async () => {
    const decoder = new TextDecoder();
    const abort = new AbortController();

    // Start the SSE fetch. Do NOT await — the response headers arrive
    // immediately but the body stream stays open until we cancel.
    const ssePromise = fetch(url('/api/events/stream'), { signal: abort.signal });

    // Give the server a moment to accept the connection and register the client
    await Bun.sleep(50);

    // Post a new event — this should trigger broadcast to our SSE client
    const payload = {
      session_id: 'sse-integration-test',
      transcript_path: '/tmp/sse.json',
      cwd: '/home/sse',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'claude-opus-4-5',
    };

    await fetch(url('/api/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Now await the SSE response headers — they should already be available
    const sseRes = await ssePromise;
    expect(sseRes.status).toBe(200);
    const ct = sseRes.headers.get('content-type') ?? '';
    expect(ct).toContain('text/event-stream');

    // Read the broadcasted chunk.
    // sseRes.body is always present for a streaming SSE response.
    if (sseRes.body === null) throw new Error('SSE response has no body');
    const reader = sseRes.body.getReader();
    const chunkPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SSE chunk timeout — broadcast not received')), 2000),
    );

    const { value, done } = await Promise.race([chunkPromise, timeoutPromise]);

    expect(done).toBe(false);
    const text = decoder.decode(value);
    expect(text.startsWith('data: ')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(true);

    const json = text.slice('data: '.length, -2);
    const row = JSON.parse(json);
    expect(row.event).toBe('SessionStart');
    expect(row.session_id).toBe('sse-integration-test');
    expect(typeof row.id).toBe('number');

    // Clean up — cancel both the reader and the SSE connection
    await reader.cancel();
    abort.abort();
  });
});
