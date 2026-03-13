/**
 * HTTP-level smoke tests for the hookwatch server ingest endpoint.
 * (Issue ch-13i.1 — Layer 1)
 *
 * Covers:
 *   - Valid SessionStart event → 201, verify via POST /api/query
 *   - Valid PreToolUse event → 201, verify tool_name stored
 *   - Invalid JSON body → 400 INVALID_QUERY
 *   - Valid JSON but missing hook_event_name → 400
 *   - Extra unknown fields pass through (schemas use .loose())
 *   - Very long stdin payload (10KB+) succeeds
 *   - Wrapped event with stdout/stderr/exit_code → 201, verify all wrap fields stored
 *   - Event with hook_duration_ms → 201, verify stored
 *
 * Strategy: Start the hookwatch server as a subprocess with an isolated
 * XDG_DATA_HOME, use fetch() to POST events directly to /api/events, and
 * verify stored data via POST /api/query.
 *
 * Runs with: bun test tests/smoke-http.test.ts
 * NOTE: This is a bun:test file — it uses Bun.spawn, not child_process.spawn.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerHandle } from '@/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SERVER_PATH = new URL('../src/server/index.ts', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

function readPortFile(xdgDataHome: string): number | null {
  try {
    const content = readFileSync(join(xdgDataHome, 'hookwatch', 'hookwatch.port'), 'utf8').trim();
    const port = Number.parseInt(content, 10);
    return Number.isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

async function waitForHealth(port: number, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return true;
    } catch {
      // Connection refused — server not ready yet
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function startServer(
  tmpBase: string,
  label: string,
): Promise<ServerHandle<ReturnType<typeof Bun.spawn>>> {
  const xdgDataHome = join(tmpBase, label);
  mkdirSync(xdgDataHome, { recursive: true });

  const proc = Bun.spawn(['bun', '--bun', SERVER_PATH], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // Poll port file, then health
  const portDeadline = Date.now() + 10000;
  let port: number | null = null;
  while (Date.now() < portDeadline) {
    port = readPortFile(xdgDataHome);
    if (port !== null) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  if (port === null) {
    proc.kill();
    throw new Error(`[smoke-http] server (${label}) did not write port file within 10s`);
  }

  const healthy = await waitForHealth(port);
  if (!healthy) {
    proc.kill();
    throw new Error(
      `[smoke-http] server (${label}) on port ${port} did not become healthy within 8s`,
    );
  }

  const stop = (): void => {
    try {
      proc.kill();
    } catch {
      // Already dead
    }
    try {
      rmSync(xdgDataHome, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { port, xdgDataHome, proc, baseUrl: `http://127.0.0.1:${port}`, stop };
}

/**
 * POST a JSON payload to /api/events. Returns the raw Response.
 */
async function postEvent(baseUrl: string, payload: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * POST /api/query and return the rows array.
 */
async function queryEvents(
  baseUrl: string,
  filter: Record<string, unknown> = {},
): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  });
  if (!res.ok) {
    throw new Error(`[smoke-http] query failed: HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>[]>;
}

// ---------------------------------------------------------------------------
// Common test payloads
// ---------------------------------------------------------------------------

/** Minimal valid SessionStart event. */
const SESSION_START = {
  hook_event_name: 'SessionStart',
  session_id: 'smoke-session-001',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  source: 'startup',
  model: 'claude-sonnet-4-6',
};

/** Minimal valid PreToolUse event. */
const PRE_TOOL_USE = {
  hook_event_name: 'PreToolUse',
  session_id: 'smoke-session-002',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_use_id: 'toolu_smoke_001',
  tool_input: { command: 'echo hello', description: 'greet' },
};

// ---------------------------------------------------------------------------
// Test lifecycle — one server shared across all HTTP smoke tests
// ---------------------------------------------------------------------------

const tmpRoot = join(tmpdir(), `hookwatch-smoke-http-${Date.now()}`);
let server: ServerHandle<ReturnType<typeof Bun.spawn>>;

beforeAll(async () => {
  mkdirSync(tmpRoot, { recursive: true });
  server = await startServer(tmpRoot, 'shared');
}, 20000);

afterAll(() => {
  server.stop();
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

// ---------------------------------------------------------------------------
// Test 1: Valid SessionStart → 201, verify via /api/query
// ---------------------------------------------------------------------------

describe('valid SessionStart event', () => {
  test('returns 201 and the event is retrievable via /api/query', async () => {
    const res = await postEvent(server.baseUrl, SESSION_START);
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: number };
    expect(typeof body.id).toBe('number');

    // Verify the event is in the DB
    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-001',
    });
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.event).toBe('SessionStart');
    expect(row.session_id).toBe('smoke-session-001');
    expect(row.cwd).toBe('/home/user/project');
    // stdin must be valid JSON containing the original payload
    const stdin = JSON.parse(row.stdin as string) as Record<string, unknown>;
    expect(stdin.hook_event_name).toBe('SessionStart');
    expect(stdin.source).toBe('startup');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Valid PreToolUse → 201, verify tool_name stored
// ---------------------------------------------------------------------------

describe('valid PreToolUse event', () => {
  test('returns 201 and tool_name is stored in the events table', async () => {
    const res = await postEvent(server.baseUrl, PRE_TOOL_USE);
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-002',
    });
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0];
    expect(row.event).toBe('PreToolUse');
    expect(row.tool_name).toBe('Bash');
  });
});

// ---------------------------------------------------------------------------
// Test 3: Invalid JSON body → 400 INVALID_QUERY
// ---------------------------------------------------------------------------

describe('invalid JSON body', () => {
  test('returns 400 with INVALID_QUERY error code', async () => {
    const res = await fetch(`${server.baseUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not json {{{',
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_QUERY');
  });
});

// ---------------------------------------------------------------------------
// Test 4: Valid JSON but missing hook_event_name → 400
// ---------------------------------------------------------------------------

describe('valid JSON but missing hook_event_name', () => {
  test('returns 400 when hook_event_name is absent', async () => {
    const res = await postEvent(server.baseUrl, {
      session_id: 'smoke-missing-event-name',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user',
      permission_mode: 'default',
      // hook_event_name intentionally omitted
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_QUERY');
  });
});

// ---------------------------------------------------------------------------
// Test 5: Extra unknown fields pass through (.loose())
// ---------------------------------------------------------------------------

describe('extra unknown fields', () => {
  test('returns 201 when extra fields are present (passthrough schema)', async () => {
    const res = await postEvent(server.baseUrl, {
      ...SESSION_START,
      session_id: 'smoke-session-passthrough',
      unknown_future_field: 'some-value',
      another_extra_field: 42,
      nested_extra: { key: 'value' },
    });
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-passthrough',
    });
    expect(rows.length).toBeGreaterThan(0);
    // Extra fields are preserved in stdin JSON
    const stdin = JSON.parse(rows[0].stdin as string) as Record<string, unknown>;
    expect(stdin.unknown_future_field).toBe('some-value');
  });
});

// ---------------------------------------------------------------------------
// Test 6: Very long stdin payload (10KB+) succeeds
// ---------------------------------------------------------------------------

describe('very long stdin payload', () => {
  test('returns 201 for a 10KB+ payload', async () => {
    // Build a large tool_input object to push the payload over 10KB
    const largeData: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      largeData[`key_${i}`] = `value_${'x'.repeat(50)}_${i}`;
    }

    const largePayload = {
      hook_event_name: 'PreToolUse',
      session_id: 'smoke-session-large',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/home/user/project',
      permission_mode: 'default',
      tool_name: 'Write',
      tool_use_id: 'toolu_large_001',
      tool_input: largeData,
    };

    const body = JSON.stringify(largePayload);
    expect(body.length).toBeGreaterThan(10 * 1024); // Confirm it's actually > 10KB

    const res = await postEvent(server.baseUrl, largePayload);
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-large',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].event).toBe('PreToolUse');
  });
});

// ---------------------------------------------------------------------------
// Test 7: Wrapped event with wrapped_command + stdout + stderr + exit_code → 201
// ---------------------------------------------------------------------------

describe('wrapped event fields', () => {
  test('returns 201 and all wrap fields are stored correctly', async () => {
    const wrappedPayload = {
      hook_event_name: 'PreToolUse',
      session_id: 'smoke-session-wrapped',
      transcript_path: '/tmp/transcript.jsonl',
      cwd: '/home/user/project',
      permission_mode: 'default',
      tool_name: 'Bash',
      tool_use_id: 'toolu_wrapped_smoke',
      tool_input: { command: 'echo hello world' },
      // Top-level wrap fields
      wrapped_command: "sh -c 'echo hello world'",
      stdout: 'hello world\n',
      stderr: '',
      exit_code: 0,
    };

    const res = await postEvent(server.baseUrl, wrappedPayload);
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-wrapped',
    });
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0];
    expect(row.wrapped_command).toBe("sh -c 'echo hello world'");
    expect(row.stdout).toBe('hello world\n');
    expect(row.stderr).toBe('');
    expect(row.exit_code).toBe(0);
    // Bare-handler nulls should NOT appear
    expect(row.wrapped_command).not.toBeNull();
  });

  test('bare event (no wrap fields) has null wrapped_command/stdout/stderr and exit_code 0', async () => {
    const res = await postEvent(server.baseUrl, {
      ...PRE_TOOL_USE,
      session_id: 'smoke-session-bare-verify',
      tool_use_id: 'toolu_bare_verify',
    });
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-bare-verify',
    });
    expect(rows.length).toBeGreaterThan(0);

    const row = rows[0];
    expect(row.wrapped_command).toBeNull();
    expect(row.stdout).toBeNull();
    expect(row.stderr).toBeNull();
    // exit_code is NOT NULL DEFAULT 0 — bare events always have 0
    expect(row.exit_code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 8: Event with hook_duration_ms → 201, verify stored
// ---------------------------------------------------------------------------

describe('hook_duration_ms field', () => {
  test('returns 201 and hook_duration_ms is stored (not null)', async () => {
    const res = await postEvent(server.baseUrl, {
      ...SESSION_START,
      session_id: 'smoke-session-duration',
      hook_duration_ms: 137,
    });
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-duration',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].hook_duration_ms).toBe(137);
  });

  test('hook_duration_ms is null when not provided', async () => {
    const res = await postEvent(server.baseUrl, {
      ...SESSION_START,
      session_id: 'smoke-session-no-duration',
    });
    expect(res.status).toBe(201);

    const rows = await queryEvents(server.baseUrl, {
      session_id: 'smoke-session-no-duration',
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].hook_duration_ms).toBeNull();
  });
});
