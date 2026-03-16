/**
 * Tests for idle timeout behavior.
 *
 * Unit tests cover:
 *   - resetIdleTimer is callable without throwing
 *   - calling resetIdleTimer multiple times does not throw (idempotent setup)
 *
 * Integration tests cover (via subprocess with a short hardcoded timeout):
 *   - Server exits with code 0 after idle timeout with no activity
 *   - Server stays alive when HTTP requests arrive before each timeout expires,
 *     then exits after activity stops
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** Number of keep-alive request cycles in the activity test. */
const KEEPALIVE_CYCLES = 3;
/** Interval between keep-alive requests (ms). */
const KEEPALIVE_INTERVAL_MS = 200;
/** Extra sleep margin added on top of the timeout in the first test (ms). */
const NO_ACTIVITY_MARGIN_MS = 400;
/** Extra sleep margin after requests stop in the second test (ms). */
const POST_ACTIVITY_MARGIN_MS = 300;
/** bun:test timeout for the no-activity test (ms). */
const NO_ACTIVITY_TEST_TIMEOUT_MS = 5000;
/** bun:test timeout for the keep-alive test (ms). */
const KEEPALIVE_TEST_TIMEOUT_MS = 8000;

/**
 * Absolute path to the idle-timeout server fixture script.
 * Resolved relative to this test file so it works regardless of cwd.
 */
const FIXTURE_SCRIPT = resolve(import.meta.dir, '../test/fixtures/idle-timeout-server.ts');

// ---------------------------------------------------------------------------
// Unit tests — verify resetIdleTimer is exported and callable
// ---------------------------------------------------------------------------

describe('resetIdleTimer (unit)', () => {
  test('is exported and callable without throwing', async () => {
    const { resetIdleTimer } = await import('@/server/index.ts');
    expect(() => resetIdleTimer()).not.toThrow();
  });

  test('calling multiple times does not throw', async () => {
    const { resetIdleTimer } = await import('@/server/index.ts');
    expect(() => {
      resetIdleTimer();
      resetIdleTimer();
      resetIdleTimer();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — subprocess with short timeout
// ---------------------------------------------------------------------------

/**
 * Spawn the idle-timeout server fixture with a short idle timeout.
 * The subprocess:
 *   1. Starts a Bun.serve() server with a configurable idle timeout
 *   2. Writes the bound port to stdout (signals readiness)
 *   3. Exits with code 0 when the idle timer fires
 *
 * Uses a separate port range (6900+) to avoid colliding with the main test
 * servers started by server.test.ts.
 *
 * @param timeoutMs - Idle timeout in milliseconds passed to the fixture via env.
 */
function spawnServerWithTimeout(timeoutMs: number): Bun.Subprocess {
  return Bun.spawn(['bun', 'run', FIXTURE_SCRIPT], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      HOOKWATCH_TEST_IDLE_TIMEOUT_MS: String(timeoutMs),
    },
  });
}

/** Read one line from a subprocess stdout reader. */
async function readLine(subprocess: Bun.Subprocess): Promise<string> {
  const reader = (subprocess.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
    if (buf.includes('\n')) break;
  }
  reader.releaseLock();
  return buf.trim();
}

describe('idle timeout integration', () => {
  test(
    'server exits with code 0 after idle timeout with no activity',
    async () => {
      const TIMEOUT_MS = 300;
      const subprocess = spawnServerWithTimeout(TIMEOUT_MS);

      // Verify the server started by reading its port
      const portStr = await readLine(subprocess);
      const port = Number.parseInt(portStr, 10);
      expect(port).toBeGreaterThan(0);

      // Wait well beyond the idle timeout
      await Bun.sleep(TIMEOUT_MS + NO_ACTIVITY_MARGIN_MS);

      const exitCode = subprocess.exitCode;
      if (exitCode === null) {
        subprocess.kill();
        throw new Error(
          `Server did not exit after idle timeout (${TIMEOUT_MS}ms + ${NO_ACTIVITY_MARGIN_MS}ms margin)`,
        );
      }
      expect(exitCode).toBe(0);
    },
    NO_ACTIVITY_TEST_TIMEOUT_MS,
  );

  test(
    'server stays alive while requests keep arriving, exits after activity stops',
    async () => {
      const TIMEOUT_MS = 400;
      const subprocess = spawnServerWithTimeout(TIMEOUT_MS);

      // Verify the server started
      const portStr = await readLine(subprocess);
      const port = Number.parseInt(portStr, 10);
      expect(port).toBeGreaterThan(0);

      // Send requests every KEEPALIVE_INTERVAL_MS for KEEPALIVE_CYCLES — each resets the timer.
      for (let i = 0; i < KEEPALIVE_CYCLES; i++) {
        await Bun.sleep(KEEPALIVE_INTERVAL_MS);
        try {
          await fetch(`http://127.0.0.1:${port}/`);
        } catch {
          // Fetch errors are acceptable — the subprocess serves a minimal handler
        }
        // Server must still be running after each request
        expect(subprocess.exitCode).toBeNull();
      }

      // Stop sending requests. Wait for one full timeout + margin.
      await Bun.sleep(TIMEOUT_MS + POST_ACTIVITY_MARGIN_MS);

      const exitCode = subprocess.exitCode;
      if (exitCode === null) {
        subprocess.kill();
        throw new Error('Server did not exit after requests stopped');
      }
      expect(exitCode).toBe(0);
    },
    KEEPALIVE_TEST_TIMEOUT_MS,
  );
});
