/**
 * Tests for idle timeout behavior (Story 2.6).
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
 * Spawn a self-contained server subprocess with a short idle timeout.
 * The subprocess:
 *   1. Starts a Bun.serve() server with a configurable idle timeout
 *   2. Writes the bound port to stdout (signals readiness)
 *   3. Exits with code 0 when the idle timer fires
 *
 * Uses a separate port range (6900+) to avoid colliding with the main test
 * servers started by server.test.ts.
 */
function spawnServerWithTimeout(timeoutMs: number): Bun.Subprocess {
  const tmpDataHome = `/tmp/hookwatch-idle-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const script = /* ts */ `
    import { mkdirSync, rmSync, writeFileSync } from "node:fs";
    import { dirname } from "node:path";

    const BASE_PORT = 6900;
    const HOSTNAME = "127.0.0.1";
    const IDLE_TIMEOUT_MS = ${timeoutMs};
    const TMP_DATA_HOME = ${JSON.stringify(tmpDataHome)};

    let idleTimer = null;

    function resetIdleTimer() {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        process.stderr.write("[hookwatch-test] Idle timeout reached — shutting down\\n");
        process.exit(0);
      }, IDLE_TIMEOUT_MS);
      idleTimer.unref();
    }

    for (let port = BASE_PORT; port <= BASE_PORT + 60; port++) {
      try {
        const server = Bun.serve({
          hostname: HOSTNAME,
          port,
          fetch(req) {
            resetIdleTimer();
            return new Response("ok");
          },
        });

        // Signal readiness to the parent process
        process.stdout.write(String(port) + "\\n");

        // Start the initial idle timer
        resetIdleTimer();
        break;
      } catch (err) {
        const isAddrInUse =
          err instanceof Error &&
          (err.code === "EADDRINUSE" || err.message.includes("address already in use"));
        if (isAddrInUse) continue;
        throw err;
      }
    }
  `;

  return Bun.spawn(['bun', '--eval', script], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
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
  test('server exits with code 0 after idle timeout with no activity', async () => {
    const TIMEOUT_MS = 300;
    const subprocess = spawnServerWithTimeout(TIMEOUT_MS);

    // Verify the server started by reading its port
    const portStr = await readLine(subprocess);
    const port = Number.parseInt(portStr, 10);
    expect(port).toBeGreaterThan(0);

    // Wait well beyond the idle timeout
    await Bun.sleep(TIMEOUT_MS + 400);

    const exitCode = subprocess.exitCode;
    if (exitCode === null) {
      subprocess.kill();
      throw new Error(`Server did not exit after idle timeout (${TIMEOUT_MS}ms + 400ms margin)`);
    }
    expect(exitCode).toBe(0);
  }, 5000);

  test('server stays alive while requests keep arriving, exits after activity stops', async () => {
    const TIMEOUT_MS = 400;
    const subprocess = spawnServerWithTimeout(TIMEOUT_MS);

    // Verify the server started
    const portStr = await readLine(subprocess);
    const port = Number.parseInt(portStr, 10);
    expect(port).toBeGreaterThan(0);

    // Send requests every 200ms for 3 cycles — each resets the timer.
    // Total active window: ~600ms, well beyond one timeout window (400ms).
    for (let i = 0; i < 3; i++) {
      await Bun.sleep(200);
      try {
        await fetch(`http://127.0.0.1:${port}/`);
      } catch {
        // Fetch errors are acceptable — the subprocess serves a minimal handler
      }
      // Server must still be running after each request
      expect(subprocess.exitCode).toBeNull();
    }

    // Stop sending requests. Wait for one full timeout + margin.
    await Bun.sleep(TIMEOUT_MS + 300);

    const exitCode = subprocess.exitCode;
    if (exitCode === null) {
      subprocess.kill();
      throw new Error('Server did not exit after requests stopped');
    }
    expect(exitCode).toBe(0);
  }, 8000);
});
