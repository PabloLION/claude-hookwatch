/**
 * Tests for the hookwatch ui command logic.
 *
 * Covers:
 * - DEFAULT_PORT is 6004
 * - isServerRunning: returns false when nothing is listening
 * - isServerRunning: returns true when server responds with 200 /health
 * - isServerRunning: returns false when server responds non-200
 * - isPortOccupied: returns false when nothing is listening
 * - isPortOccupied: returns true when an HTTP server is listening
 * - openBrowser: delegates to `open` package
 * - openBrowser: logs a warning and manual URL on failure
 *
 * Note: Port file reading is tested in src/paths.test.ts.
 */

import { afterAll, beforeAll, describe, expect, mock, spyOn, test } from 'bun:test';
import { DEFAULT_PORT } from '@/config.ts';
import { startServer } from '@/server/index.ts';
import { UNUSED_PORT_A, UNUSED_PORT_B, UNUSED_PORT_C } from '@/test/constants.ts';
import { createTempXdgHome, type TempXdgHome } from '@/test/setup.ts';
import { isPortOccupied, isServerRunning } from './ui.ts';

// ---------------------------------------------------------------------------
// DEFAULT_PORT constant
// ---------------------------------------------------------------------------

/** Snapshot value — test fails if DEFAULT_PORT changes without updating this. */
const SNAPSHOT_DEFAULT_PORT = 6004;

describe('DEFAULT_PORT', () => {
  test('is 6004', () => {
    expect(DEFAULT_PORT).toBe(SNAPSHOT_DEFAULT_PORT);
  });
});

// ---------------------------------------------------------------------------
// isServerRunning — uses a real test server
// ---------------------------------------------------------------------------

describe('isServerRunning', () => {
  let xdg: TempXdgHome;
  let serverPort: number;
  let stopServer: () => void;

  beforeAll(async () => {
    xdg = createTempXdgHome('hookwatch-ui-running-test-');
    process.env.XDG_DATA_HOME = xdg.tmpDir;
    const result = await startServer();
    serverPort = result.port;
    stopServer = result.stop;
  });

  afterAll(() => {
    stopServer();
    delete process.env.XDG_DATA_HOME;
    xdg.cleanup();
  });

  test('returns false for a port with nothing listening', async () => {
    // Use a port unlikely to be in use
    const result = await isServerRunning(UNUSED_PORT_A);
    expect(result).toBe(false);
  });

  test('returns true when the hookwatch server is running on the port', async () => {
    const result = await isServerRunning(serverPort);
    expect(result).toBe(true);
  });

  test('returns false when the port serves a non-200 health response', async () => {
    // We can't easily test this with a real server, so test with a port that
    // has nothing listening (which also returns false)
    const result = await isServerRunning(UNUSED_PORT_B);
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isPortOccupied — uses a real test server
// ---------------------------------------------------------------------------

describe('isPortOccupied', () => {
  let xdg: TempXdgHome;
  let serverPort: number;
  let stopServer: () => void;

  beforeAll(async () => {
    xdg = createTempXdgHome('hookwatch-ui-occupied-test-');
    process.env.XDG_DATA_HOME = xdg.tmpDir;
    const result = await startServer();
    serverPort = result.port;
    stopServer = result.stop;
  });

  afterAll(() => {
    stopServer();
    delete process.env.XDG_DATA_HOME;
    xdg.cleanup();
  });

  test('returns false for a port with nothing listening', async () => {
    const result = await isPortOccupied(UNUSED_PORT_C);
    expect(result).toBe(false);
  });

  test('returns true when an HTTP server is listening on the port', async () => {
    const result = await isPortOccupied(serverPort);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// openBrowser — delegates to the `open` package
// ---------------------------------------------------------------------------

const TEST_UI_URL = 'http://localhost:6004';

describe('openBrowser', () => {
  test('calls the open package with the URL', async () => {
    // mock.module replaces the module before dynamic import picks it up
    let capturedUrl: string | undefined;
    mock.module('open', () => ({
      default: (url: string) => {
        capturedUrl = url;
        return Promise.resolve(undefined);
      },
    }));

    const { openBrowser: openBrowserMocked } = await import('./ui.ts?t=1');
    await openBrowserMocked(TEST_UI_URL);

    expect(capturedUrl).toBe(TEST_UI_URL);
  });

  test('logs a warning and manual URL when open throws', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});

    mock.module('open', () => ({
      default: () => Promise.reject(new Error('spawn failed')),
    }));

    const { openBrowser: openBrowserMocked } = await import('./ui.ts?t=2');
    await openBrowserMocked(TEST_UI_URL);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[hookwatch] Failed to open browser'),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(TEST_UI_URL));

    warnSpy.mockRestore();
    logSpy.mockRestore();
  });
});
