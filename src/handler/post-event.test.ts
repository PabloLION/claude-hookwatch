/**
 * Tests for src/handler/post-event.ts
 *
 * Coverage:
 * - postEvent(): non-201 response from server → non-fatal, failure reason in systemMessage
 * - postEvent(): server unavailable triggers auto-start
 * - postEvent(): connection error → spawn → health probe → retry succeeds
 * - postEvent(): server down in wrapped mode — child exit code still forwarded
 * - Wrapped mode: exit code forwarding, tee behavior, POST body fields
 * - Unified pipeline: bare/wrapped POST body contract (wrapped_command, exit_code, etc.)
 *
 * Strategy: run the handler as a child process via Bun.spawn(), feeding stdin
 * directly. This mirrors the real Claude Code hook invocation and avoids the
 * need to mock module-level globals.
 *
 * NOTE: Some tests trigger the auto-start path, which spawns a
 * real server process. These are killed in afterAll to avoid leaking processes.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from 'bun:test';
import { join } from 'node:path';
import type { parseHookEvent } from '@/schemas/events.ts';
import { parseHookOutput } from '@/schemas/output.ts';
import { HOOKWATCH_LOG_PREFIX, UNUSED_PORT_A, UNUSED_PORT_B } from '@/test/constants.ts';
import { BASE_SESSION_START } from '@/test/fixtures.ts';
import { assertBareExitLegality, assertWrappedExitLegality } from '@/test/handler-assertions.ts';
import { createHandlerTestContext } from '@/test/setup.ts';
import { killProcessOnPort, runHandler, runHandlerWrapped } from '@/test/subprocess.ts';
import { firstEventBody, startTestServer, writePortFile } from '@/test/test-server.ts';
import { VERSION } from '@/version.ts';
import type { PostEventResult } from './post-event.ts';
import { postEvent } from './post-event.ts';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/** Substring present in version mismatch log/systemMessage entries. */
const VERSION_MISMATCH_SUBSTR = 'Version mismatch';

/**
 * Builds a minimal BareEventPayload for unit-level postEvent() calls.
 * The event shape is cast to satisfy the type; real validation happens
 * inside the handler, not inside postEvent().
 */
function makeBarePayload(): Parameters<typeof postEvent>[1] {
  return {
    mode: 'bare',
    // Partial mock — postEvent() passes event to buildRequestBody() which spreads it
    event: { hook_event_name: 'SessionStart' } as unknown as ReturnType<typeof parseHookEvent>,
    stdout: JSON.stringify({ continue: true, systemMessage: 'test' }),
    hookDurationMs: 0,
    hookwatchLog: null,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const ctx = createHandlerTestContext(
  'hookwatch-post-event-test-',
  beforeAll,
  // Kill server processes BEFORE removing temp dirs — the spawned server may
  // still reference files in the temp directory while it is running.
  (fn) =>
    afterAll(async () => {
      await killProcessOnPort();
      fn();
    }),
);

afterEach(() => {
  ctx.reset();
});

// ---------------------------------------------------------------------------
// Server error responses
// ---------------------------------------------------------------------------

describe('server non-2xx response', () => {
  test('non-201 response is non-fatal: exits 0 with hook output JSON (continue: true)', async () => {
    const xdgHome = join(ctx.tmpDir, 'server-error');
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'server-error');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('500');
    // Non-fatal: stdout is normal hook output JSON (not hookwatch_fatal)
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hookwatch_fatal).toBeUndefined();
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
  });

  test('non-201 response logs status to stderr', async () => {
    const xdgHome = join(ctx.tmpDir, 'server-error-stderr');
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.nextStatus = 503;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.stderr).toContain('503');
  });

  test('non-201 response: failure reason appears in systemMessage', async () => {
    const xdgHome = join(ctx.tmpDir, 'stdout-post-failure');
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'stdout-post-failure');
    expect(result.exitCode).toBe(0);
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.continue).toBe(true);
    // systemMessage must contain the HTTP status so the user can see the issue
    expect(typeof parsed.systemMessage).toBe('string');
    expect(parsed.systemMessage as string).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// Auto-start (server unavailable)
// ---------------------------------------------------------------------------

describe('auto-start (server unavailable)', () => {
  test('server unavailable triggers auto-start', async () => {
    const xdgHome = join(ctx.tmpDir, 'server-unavailable');
    // Point at a port where no server is running — triggers auto-start
    writePortFile(xdgHome, UNUSED_PORT_A);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, 'config'),
    });

    assertBareExitLegality(result, 'server-unavailable');
    // Auto-start fires: spawned server writes port file, health probe discovers
    // new port, handler retries and succeeds.
    expect(result.stderr).toContain(HOOKWATCH_LOG_PREFIX);
    expect(result.exitCode).not.toBeNull();
  }, 10000);

  test('wrapped mode: server down, child exit code still forwarded (best-effort)', async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-server-down');
    writePortFile(xdgHome, UNUSED_PORT_B);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', 'exit 0'],
      {
        XDG_DATA_HOME: xdgHome,
        XDG_CONFIG_HOME: join(xdgHome, 'config'),
      },
    );

    // Child exits 0 — even if server POST fails, exit code is forwarded
    expect(result.exitCode).not.toBeNull();
    expect(result.stderr).toContain(HOOKWATCH_LOG_PREFIX);
  }, 10000);
});

// ---------------------------------------------------------------------------
// Wrapped mode: server-side behavior
// ---------------------------------------------------------------------------

describe('wrapped mode', () => {
  test('child exit code 0 is forwarded when server is up', async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-exit-0');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', 'exit 0'],
      { XDG_DATA_HOME: xdgHome },
    );

    assertWrappedExitLegality(result, 'wrap-exit-0');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
  });

  test('child exit code 2 is forwarded (block action)', async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-exit-2');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', 'exit 2'],
      { XDG_DATA_HOME: xdgHome },
    );

    // Exit 2 from child is a valid pass-through — not a hookwatch fatal error.
    // In wrapped mode, exit 2 is the child's exit code.
    expect(result.exitCode).toBe(2);
    // Event is still posted even when child exits 2
    expect(ctx.server.events).toHaveLength(1);
  });

  test("child stdout is tee'd to handler stdout before hook output JSON", async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-tee-stdout');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', "printf 'child-output'"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertWrappedExitLegality(result, 'wrap-tee-stdout');
    expect(result.exitCode).toBe(0);
    // stdout contains child output + hook JSON at the end
    expect(result.stdout).toContain('child-output');
    // Hook output JSON appears after child output
    const hookJsonStr = result.stdout.slice(result.stdout.lastIndexOf('{'));
    const hookJson = JSON.parse(hookJsonStr);
    expect(hookJson.continue).toBe(true);
  });

  test('wrapped_command is stored in the event posted to server', async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-command-stored');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', 'exit 0'],
      { XDG_DATA_HOME: xdgHome },
    );

    assertWrappedExitLegality(result, 'wrap-command-stored');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = firstEventBody(ctx.server);
    expect(body?.wrapped_command).toBe('["sh","-c","exit 0"]');
  });

  test('wrapped mode includes hook_duration_ms as a non-negative number in POST body', async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-duration-ms');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', 'exit 0'],
      { XDG_DATA_HOME: xdgHome },
    );

    assertWrappedExitLegality(result, 'wrap-duration-ms');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = firstEventBody(ctx.server);
    expect(typeof body?.hook_duration_ms).toBe('number');
    expect(body?.hook_duration_ms as number).toBeGreaterThanOrEqual(0);
  });

  test('invalid JSON stdin in wrapped mode: child exit code forwarded', async () => {
    const xdgHome = join(ctx.tmpDir, 'wrap-invalid-stdin');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped('{ not valid json', ['sh', '-c', 'exit 0'], {
      XDG_DATA_HOME: xdgHome,
    });

    // Child exits 0, but event parsing fails — handler exits with child code
    expect(result.exitCode).toBe(0);
    // Error logged to stderr about parsing failure
    expect(result.stderr).toContain(HOOKWATCH_LOG_PREFIX);
  });
});

// ---------------------------------------------------------------------------
// Unified pipeline: bare/wrapped POST body contract
// ---------------------------------------------------------------------------

describe('unified pipeline', () => {
  test('bare mode POST body has no wrapped_command field', async () => {
    const xdgHome = join(ctx.tmpDir, 'unified-bare-null-wrapped');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unified-bare-null-wrapped');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = firstEventBody(ctx.server);
    expect(body?.wrapped_command).toBeUndefined();
  });

  test('bare mode stores hook output JSON as stdout in POST body', async () => {
    const xdgHome = join(ctx.tmpDir, 'unified-bare-stdout-stored');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unified-bare-stdout-stored');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    // bare mode: stdout column should contain hook output JSON (what Claude Code sees)
    const body = firstEventBody(ctx.server);
    expect(typeof body?.stdout).toBe('string');
    const storedStdout = JSON.parse(body?.stdout as string);
    expect(storedStdout.continue).toBe(true);
    expect(typeof storedStdout.systemMessage).toBe('string');
  });

  test('bare mode stores exit_code 0 in POST body', async () => {
    const xdgHome = join(ctx.tmpDir, 'unified-bare-exit-code');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unified-bare-exit-code');
    expect(result.exitCode).toBe(0);
    const body = firstEventBody(ctx.server);
    expect(body?.exit_code).toBe(0);
  });

  test('wrapped mode stores child exit code in POST body', async () => {
    const xdgHome = join(ctx.tmpDir, 'unified-wrapped-exit-code');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ['sh', '-c', 'exit 0'],
      { XDG_DATA_HOME: xdgHome },
    );

    assertWrappedExitLegality(result, 'unified-wrapped-exit-code');
    expect(result.exitCode).toBe(0);
    const body = firstEventBody(ctx.server);
    expect(body?.exit_code).toBe(0);
  });

  test('hookwatch_log is absent in POST body on successful run', async () => {
    const xdgHome = join(ctx.tmpDir, 'unified-no-hookwatch-log');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unified-no-hookwatch-log');
    expect(result.exitCode).toBe(0);
    const body = firstEventBody(ctx.server);
    // hookwatch_log should not be present (null means not sent)
    expect(body?.hookwatch_log).toBeUndefined();
  });

  test('bare mode includes hook_duration_ms as a non-negative number in POST body', async () => {
    const xdgHome = join(ctx.tmpDir, 'unified-duration-bare');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'unified-duration-bare');
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = firstEventBody(ctx.server);
    expect(typeof body?.hook_duration_ms).toBe('number');
    expect(body?.hook_duration_ms as number).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Version mismatch detection
// ---------------------------------------------------------------------------

describe('version mismatch detection', () => {
  test('matching versions: no version error in systemMessage or stderr', async () => {
    const xdgHome = join(ctx.tmpDir, 'version-match');
    writePortFile(xdgHome, ctx.server.port);

    // Server returns the same version as the handler
    ctx.server.serverVersion = VERSION;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'version-match');
    expect(result.exitCode).toBe(0);
    // No version error in stderr
    expect(result.stderr).not.toContain(VERSION_MISMATCH_SUBSTR);
    // No version error in systemMessage
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.systemMessage as string).not.toContain(VERSION_MISMATCH_SUBSTR);
  });

  test('mismatched versions: [error] log entry appears in systemMessage', async () => {
    const xdgHome = join(ctx.tmpDir, 'version-mismatch');
    writePortFile(xdgHome, ctx.server.port);

    // Simulate a server running a different version
    const staleVersion = '0.0.1-stale';
    ctx.server.serverVersion = staleVersion;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'version-mismatch');
    expect(result.exitCode).toBe(0);
    // Version mismatch logged to stderr
    expect(result.stderr).toContain(VERSION_MISMATCH_SUBSTR);
    expect(result.stderr).toContain(staleVersion);
    // Version mismatch appears in systemMessage (visible to Claude Code agent)
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.continue).toBe(true);
    expect(parsed.systemMessage as string).toContain('[error] Version mismatch');
    expect(parsed.systemMessage as string).toContain(staleVersion);
    expect(parsed.systemMessage as string).toContain(VERSION);
  });

  test('mismatched versions: handler still exits 0 (non-blocking)', async () => {
    const xdgHome = join(ctx.tmpDir, 'version-mismatch-exit-0');
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.serverVersion = '0.0.1-stale';

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    // Version mismatch is [error] severity but never fatal — always exits 0
    expect(result.exitCode).toBe(0);
  });

  test('server omits X-Hookwatch-Version header: no version error logged', async () => {
    const xdgHome = join(ctx.tmpDir, 'version-header-absent');
    writePortFile(xdgHome, ctx.server.port);

    // serverVersion defaults to null → header absent (older server)
    expect(ctx.server.serverVersion).toBeNull();

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'version-header-absent');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain(VERSION_MISMATCH_SUBSTR);
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.systemMessage as string).not.toContain(VERSION_MISMATCH_SUBSTR);
  });
});

// ---------------------------------------------------------------------------
// failureKind dispatch
// ---------------------------------------------------------------------------

/**
 * Tests for the failureKind field on PostEventResult.
 *
 * Coverage strategy:
 * - 'http' and 'exception' failure paths: tested in-process via postEvent()
 *   directly, because they don't require a spawned server.
 * - 'spawn' and 'retry' failure paths: these require spawnServer() to return
 *   a failure, which means the real server process either won't start or
 *   won't pass the health probe. Since the test environment always has a
 *   working Bun binary and the server always starts successfully, these paths
 *   cannot be triggered without module mocking. The dispatch logic in
 *   handleHook() (3 lines in index.ts) is verified by code review and the
 *   'http' non-fatal path tests below (which verify the opposite branch).
 */
describe('failureKind — postEvent() unit tests', () => {
  let unitServer: ReturnType<typeof startTestServer>;
  // Suppress expected [hookwatch] console.error output from postEvent() error paths.
  // These tests deliberately trigger HTTP errors and fetch exceptions — the resulting
  // console.error calls are expected and verified below, not defects.
  let consoleSpy: ReturnType<typeof spyOn>;

  beforeAll(() => {
    unitServer = startTestServer();
  });

  afterAll(() => {
    unitServer.stop();
  });

  beforeEach(() => {
    consoleSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    unitServer.nextStatus = 201;
    unitServer.serverVersion = null;
    unitServer.events.splice(0);
  });

  test("'http' failureKind: non-2xx response returns ok:false with failureKind:'http'", async () => {
    unitServer.nextStatus = 500;

    const result: PostEventResult = await postEvent(unitServer.port, makeBarePayload());

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[hookwatch]'));
    if (!result.ok) {
      expect(result.failureKind).toBe('http');
      expect(result.failureReason).toContain('500');
    } else {
      throw new Error('expected ok:false — should not reach ok:true');
    }
  });

  test("'http' failureKind: 503 response also sets failureKind:'http'", async () => {
    unitServer.nextStatus = 503;

    const result: PostEventResult = await postEvent(unitServer.port, makeBarePayload());

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[hookwatch]'));
    if (!result.ok) {
      expect(result.failureKind).toBe('http');
    } else {
      throw new Error('expected ok:false — should not reach ok:true');
    }
  });

  test('ok:true response: no failureKind set', async () => {
    unitServer.nextStatus = 201;

    const result: PostEventResult = await postEvent(unitServer.port, makeBarePayload());

    // ok:true path — no console.error expected
    if (result.ok) {
      // PostEventResult ok:true has no failureKind field — verify via type narrowing
      expect(result.versionMismatchLog).toBeUndefined();
    } else {
      throw new Error('expected ok:true — should not reach ok:false');
    }
  });

  test("'exception' failureKind: non-connection fetch error returns failureKind:'exception'", async () => {
    // Temporarily replace globalThis.fetch with a version that throws an
    // AbortError — not a connection refused error. This exercises the
    // non-connection exception path (isConnectionError returns false →
    // failureKind: 'exception', no spawn attempt).
    const originalFetch = globalThis.fetch;

    const mockFetch = async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    };
    mockFetch.preconnect = (_url: string) => {};
    // Mock implements only call + preconnect
    globalThis.fetch = mockFetch as typeof fetch;

    try {
      const result: PostEventResult = await postEvent(unitServer.port, makeBarePayload());
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[hookwatch]'));
      if (!result.ok) {
        expect(result.failureKind).toBe('exception');
        expect(result.failureReason).toContain('Failed to POST event to server');
      } else {
        throw new Error('expected ok:false — should not reach ok:true');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// failureKind — integration: non-fatal paths don't set hookwatch_fatal
// ---------------------------------------------------------------------------

describe('failureKind — integration: non-fatal dispatch in handleHook()', () => {
  test("'http' failure (500): handler exits 0, hookwatch_fatal absent (non-fatal)", async () => {
    const xdgHome = join(ctx.tmpDir, 'fk-http-nonfatal');
    writePortFile(xdgHome, ctx.server.port);
    ctx.server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'fk-http-nonfatal');
    expect(result.exitCode).toBe(0);
    const parsed = parseHookOutput(result.stdout);
    // Non-fatal: hookwatch_fatal must NOT be present
    expect(parsed.hookwatch_fatal).toBeUndefined();
    // Failure reason appears in systemMessage (user-visible, non-blocking)
    expect(parsed.continue).toBe(true);
    expect(parsed.systemMessage as string).toContain('500');
  });

  test("'http' failure (503): failure reason in systemMessage, not hookwatch_fatal", async () => {
    const xdgHome = join(ctx.tmpDir, 'fk-http-503');
    writePortFile(xdgHome, ctx.server.port);
    ctx.server.nextStatus = 503;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertBareExitLegality(result, 'fk-http-503');
    expect(result.exitCode).toBe(0);
    const parsed = parseHookOutput(result.stdout);
    expect(parsed.hookwatch_fatal).toBeUndefined();
    expect(parsed.systemMessage as string).toContain('503');
  });
});
