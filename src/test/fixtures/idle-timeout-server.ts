/**
 * Standalone server fixture for idle-timeout integration tests.
 *
 * Spawned as a subprocess by idle-timeout.test.ts. On startup:
 *   1. Binds Bun.serve() on the first available port in [BASE_PORT, BASE_PORT+60].
 *   2. Writes the bound port to stdout (signals readiness to the parent).
 *   3. Starts an idle timer; each incoming request resets it.
 *   4. Exits with code 0 when the idle timer fires.
 *
 * Configuration via environment variables (set by the parent test):
 *   HOOKWATCH_TEST_IDLE_TIMEOUT_MS  — idle timeout in milliseconds (required)
 */

const BASE_PORT = 6900;
const HOSTNAME = '127.0.0.1';

const rawTimeout = process.env.HOOKWATCH_TEST_IDLE_TIMEOUT_MS;
if (rawTimeout === undefined) {
  process.stderr.write('[hookwatch-test] HOOKWATCH_TEST_IDLE_TIMEOUT_MS is not set\n');
  process.exit(1);
}
const IDLE_TIMEOUT_MS = Number.parseInt(rawTimeout, 10);
if (Number.isNaN(IDLE_TIMEOUT_MS) || IDLE_TIMEOUT_MS <= 0) {
  process.stderr.write(`[hookwatch-test] Invalid HOOKWATCH_TEST_IDLE_TIMEOUT_MS: ${rawTimeout}\n`);
  process.exit(1);
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

function resetIdleTimer(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    process.stderr.write('[hookwatch-test] Idle timeout reached — shutting down\n');
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
  idleTimer.unref();
}

let bound = false;
for (let port = BASE_PORT; port <= BASE_PORT + 60; port++) {
  try {
    Bun.serve({
      hostname: HOSTNAME,
      port,
      fetch(_req: Request): Response {
        resetIdleTimer();
        return new Response('ok');
      },
    });

    // Signal readiness to the parent process
    process.stdout.write(`${String(port)}\n`);

    // Start the initial idle timer
    resetIdleTimer();
    bound = true;
    break;
  } catch (err) {
    const isAddrInUse =
      err instanceof Error &&
      (('code' in err && err.code === 'EADDRINUSE') ||
        err.message.includes('address already in use'));
    if (isAddrInUse) continue;
    throw err;
  }
}

if (!bound) {
  process.stderr.write(
    `[hookwatch-test] No available port found in [${BASE_PORT}, ${BASE_PORT + 60}]\n`,
  );
  process.exit(1);
}
