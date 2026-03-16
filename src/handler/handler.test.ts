/**
 * Tests for src/handler/index.ts
 *
 * Coverage:
 * - readPort(): file exists → uses port; file absent → auto-start fallback
 * - Stdin parsing: valid JSON is parsed and forwarded
 * - Zod validation: known event → correct schema; unknown event → fallback schema
 * - Successful POST: event is forwarded and server receives it
 * - Error handling: invalid JSON and Zod failures cause exit 0 + JSON stdout with hookwatch_fatal
 * - Unknown event forwarding: unknown hook_event_name goes through fallback
 * - Exit legality: exit 0 always (hookwatch never exits non-zero in bare mode)
 *
 * Strategy: run the handler as a child process via Bun.spawn(), feeding stdin
 * directly. This mirrors the real Claude Code hook invocation and avoids the
 * need to mock module-level globals.
 *
 * NOTE: Some tests trigger the auto-start path (Story 1.5), which spawns a
 * real server process. These are killed in afterAll to avoid leaking processes.
 *
 * Wrapped mode, unified pipeline, server error, and auto-start tests live in
 * post-event.test.ts. Context injection / systemMessage tests live in
 * context.test.ts.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHookOutput } from '@/schemas/output.ts';
import { HOOKWATCH_LOG_PREFIX } from '@/test/constants.ts';
import { BASE_SESSION_START } from '@/test/fixtures.ts';
import { assertBareExitLegality } from '@/test/handler-assertions.ts';
import { createHandlerTestContext } from '@/test/setup.ts';
import { killProcessOnPort, runHandler } from '@/test/subprocess.ts';
import { firstEventBody, writePortFile } from '@/test/test-server.ts';

// ---------------------------------------------------------------------------
// Shared test fixtures and constants
// ---------------------------------------------------------------------------

const UNKNOWN_EVENT = {
  session_id: 'test-session-002',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  hook_event_name: 'FutureUnknownEvent',
  extra_field: 'preserved',
};

const ctx = createHandlerTestContext('hookwatch-handler-test-');

beforeAll(() => {
  ctx.setup();
});

afterAll(async () => {
  // Kill server processes BEFORE removing temp dirs — the spawned server may
  // still reference files in the temp directory while it is running.
  await killProcessOnPort();
  ctx.cleanup();
});

afterEach(() => {
  ctx.reset();
});

// ---------------------------------------------------------------------------
// Port file reading
// ---------------------------------------------------------------------------

describe('port file', () => {
  test('uses port from file when present', async () => {
    const xdgHome = join(ctx.tmpDir, 'port-present');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'port-present');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
  });

  test('falls back to port 6004 when file is absent, then auto-starts server', async () => {
    const xdgHome = join(ctx.tmpDir, 'port-absent');
    mkdirSync(xdgHome, { recursive: true });
    // No port file written — handler falls back to 6004, gets ECONNREFUSED,
    // then auto-starts the server. The spawned server inherits XDG_DATA_HOME
    // and writes its port file to xdgHome. After a successful health probe,
    // the handler retries and delivers the event.
    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, 'config'),
    });

    assertBareExitLegality(result, 'port-absent');
    // Auto-start succeeds — event is delivered to the spawned server
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(HOOKWATCH_LOG_PREFIX);
  }, 10000);

  test('ignores invalid port file content and uses fallback, does not crash', async () => {
    const xdgHome = join(ctx.tmpDir, 'port-invalid');
    writePortFile(xdgHome, 'not-a-number');

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, 'config'),
    });

    // Invalid port content is now returned as a warning (not logged to stderr).
    // The handler falls back to DEFAULT_PORT silently and either connects to an
    // existing server or auto-starts one. Either way it must not crash.
    assertBareExitLegality(result, 'port-invalid');
    expect(result.exitCode).not.toBeNull();
  }, 10000);
});

// ---------------------------------------------------------------------------
// Stdin parsing
// ---------------------------------------------------------------------------

describe('stdin parsing', () => {
  test('valid JSON stdin is parsed and forwarded', async () => {
    const xdgHome = join(ctx.tmpDir, 'stdin-valid');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'stdin-valid');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = firstEventBody(ctx.server);
    expect(body?.hook_event_name).toBe('SessionStart');
    expect(body?.session_id).toBe('test-session-001');
  });

  test('invalid JSON stdin causes exit 0 with hookwatch_fatal JSON in stdout', async () => {
    const xdgHome = join(ctx.tmpDir, 'stdin-invalid');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler('{ this is not valid json', {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'stdin-invalid');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(HOOKWATCH_LOG_PREFIX);
    expect(ctx.server.events).toHaveLength(0);
    const parsed = parseHookOutput(result.stdout);
    expect(typeof parsed.hookwatch_fatal).toBe('string');
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
  });

  test('empty stdin causes exit 0 with hookwatch_fatal JSON in stdout', async () => {
    const xdgHome = join(ctx.tmpDir, 'stdin-empty');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler('', {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'stdin-empty');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(0);
    const parsed = parseHookOutput(result.stdout);
    expect(typeof parsed.hookwatch_fatal).toBe('string');
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

describe('Zod validation', () => {
  test('known event type routes to correct schema and is forwarded', async () => {
    const xdgHome = join(ctx.tmpDir, 'zod-known');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'zod-known');
    expect(result.exitCode).toBe(0);
    const body = firstEventBody(ctx.server);
    expect(body?.source).toBe('startup');
    expect(body?.model).toBe('claude-sonnet-4-6');
  });

  test('missing required field causes exit 0 with hookwatch_fatal JSON in stdout', async () => {
    const xdgHome = join(ctx.tmpDir, 'zod-missing-field');
    writePortFile(xdgHome, ctx.server.port);

    const payload = {
      // Missing session_id
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'claude-sonnet-4-6',
    };

    const result = await runHandler(JSON.stringify(payload), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'zod-missing-field');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(HOOKWATCH_LOG_PREFIX);
    expect(ctx.server.events).toHaveLength(0);
    const parsed = parseHookOutput(result.stdout);
    expect(typeof parsed.hookwatch_fatal).toBe('string');
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
  });

  test('invalid enum value for known event causes exit 0 with hookwatch_fatal JSON in stdout', async () => {
    const xdgHome = join(ctx.tmpDir, 'zod-bad-enum');
    writePortFile(xdgHome, ctx.server.port);

    const payload = {
      ...BASE_SESSION_START,
      source: 'INVALID_SOURCE_VALUE',
    };

    const result = await runHandler(JSON.stringify(payload), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'zod-bad-enum');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(0);
    const parsed = parseHookOutput(result.stdout);
    expect(typeof parsed.hookwatch_fatal).toBe('string');
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Unknown event forwarding
// ---------------------------------------------------------------------------

describe('unknown event forwarding', () => {
  test('unknown hook_event_name passes through fallback schema and is forwarded', async () => {
    const xdgHome = join(ctx.tmpDir, 'unknown-event');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(UNKNOWN_EVENT), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unknown-event');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = firstEventBody(ctx.server);
    expect(body?.hook_event_name).toBe('FutureUnknownEvent');
    expect(body?.extra_field).toBe('preserved');
  });

  test('unknown event with missing common fields causes exit 0 with hookwatch_fatal JSON in stdout', async () => {
    const xdgHome = join(ctx.tmpDir, 'unknown-event-bad');
    writePortFile(xdgHome, ctx.server.port);

    const payload = {
      // Missing session_id, transcript_path, cwd, permission_mode
      hook_event_name: 'FutureUnknownEvent',
      extra_field: 'value',
    };

    const result = await runHandler(JSON.stringify(payload), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unknown-event-bad');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(0);
    const parsed = parseHookOutput(result.stdout);
    expect(typeof parsed.hookwatch_fatal).toBe('string');
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
  });
});
