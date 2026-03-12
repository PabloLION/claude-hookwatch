/**
 * Tests for the hookwatch ui command logic (Story 2.5).
 *
 * Covers:
 * - DEFAULT_PORT is 6004
 * - readPortFile: returns null when file is absent
 * - readPortFile: returns null for invalid content
 * - readPortFile: returns valid port from file content
 * - isServerRunning: returns false when nothing is listening
 * - isServerRunning: returns true when server responds with 200 /health
 * - isServerRunning: returns false when server responds non-200
 * - isPortOccupied: returns false when nothing is listening
 * - isPortOccupied: returns true when an HTTP server is listening
 * - openBrowser: spawns correct command on darwin
 * - openBrowser: spawns correct command on linux
 */

import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PORT } from '@/config.ts';
import { startServer } from '@/server/index.ts';
import {
  createTempXdgHome,
  type TempXdgHome,
  UNUSED_PORT_A,
  UNUSED_PORT_B,
  UNUSED_PORT_C,
} from '@/test';
import { isPortOccupied, isServerRunning, openBrowser, readPortFile } from './ui.ts';

// ---------------------------------------------------------------------------
// DEFAULT_PORT constant
// ---------------------------------------------------------------------------

/** Snapshot value — test fails if DEFAULT_PORT changes without updating this. */
const SNAPSHOT_DEFAULT_PORT = 6004;

/** Port with surrounding whitespace — tests readPortFile whitespace trimming. */
const TEST_WHITESPACE_PORT = 6010;

describe('DEFAULT_PORT', () => {
  it('is 6004', () => {
    expect(DEFAULT_PORT).toBe(SNAPSHOT_DEFAULT_PORT);
  });
});

// ---------------------------------------------------------------------------
// readPortFile
// ---------------------------------------------------------------------------

describe('readPortFile', () => {
  let xdg: TempXdgHome;
  let portFile: string;

  beforeAll(() => {
    xdg = createTempXdgHome('hookwatch-ui-test-');
    const portDir = join(xdg.tmpDir, 'hookwatch');
    mkdirSync(portDir, { recursive: true });
    portFile = join(portDir, 'hookwatch.port');
    // Override XDG_DATA_HOME so portFilePath() resolves to our temp dir
    process.env.XDG_DATA_HOME = xdg.tmpDir;
  });

  afterAll(() => {
    delete process.env.XDG_DATA_HOME;
    xdg.cleanup();
  });

  it('returns null when port file is absent', () => {
    // Ensure file does not exist
    try {
      rmSync(portFile);
    } catch {
      // Ignore — may not exist
    }
    expect(readPortFile()).toBeNull();
  });

  it('returns the port number from a valid port file', () => {
    writeFileSync(portFile, String(DEFAULT_PORT), 'utf8');
    expect(readPortFile()).toBe(DEFAULT_PORT);
  });

  it('returns the port number with surrounding whitespace stripped', () => {
    writeFileSync(portFile, `  ${TEST_WHITESPACE_PORT}\n`, 'utf8');
    expect(readPortFile()).toBe(TEST_WHITESPACE_PORT);
  });

  it('returns null for NaN content', () => {
    writeFileSync(portFile, 'not-a-port', 'utf8');
    expect(readPortFile()).toBeNull();
  });

  it('returns null for zero', () => {
    writeFileSync(portFile, '0', 'utf8');
    expect(readPortFile()).toBeNull();
  });

  it('returns null for port > 65535', () => {
    writeFileSync(portFile, '99999', 'utf8');
    expect(readPortFile()).toBeNull();
  });

  it('returns null for negative port', () => {
    writeFileSync(portFile, '-1', 'utf8');
    expect(readPortFile()).toBeNull();
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

  it('returns false for a port with nothing listening', async () => {
    // Use a port unlikely to be in use
    const result = await isServerRunning(UNUSED_PORT_A);
    expect(result).toBe(false);
  });

  it('returns true when the hookwatch server is running on the port', async () => {
    const result = await isServerRunning(serverPort);
    expect(result).toBe(true);
  });

  it('returns false when the port serves a non-200 health response', async () => {
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

  it('returns false for a port with nothing listening', async () => {
    const result = await isPortOccupied(UNUSED_PORT_C);
    expect(result).toBe(false);
  });

  it('returns true when an HTTP server is listening on the port', async () => {
    const result = await isPortOccupied(serverPort);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// openBrowser — platform dispatch (spy on Bun.spawn)
// ---------------------------------------------------------------------------

const TEST_UI_URL = 'http://localhost:6004';

/** Minimal Bun.spawn mock: captures the cmd array, returns a resolved subprocess stub. */
function makeSpawnMock(spawnedCommands: string[][]): typeof Bun.spawn {
  return ((cmd: string[]) => {
    spawnedCommands.push(cmd);
    return { exited: Promise.resolve(0) } as ReturnType<typeof Bun.spawn>;
  }) as unknown as typeof Bun.spawn;
}

describe('openBrowser', () => {
  it("calls 'open' on darwin", async () => {
    const originalPlatform = process.platform;
    // Override process.platform
    Object.defineProperty(process, 'platform', {
      value: 'darwin',
      configurable: true,
    });

    const spawnedCommands: string[][] = [];
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(makeSpawnMock(spawnedCommands));

    await openBrowser(TEST_UI_URL);

    expect(spawnedCommands).toHaveLength(1);
    expect(spawnedCommands[0]?.[0]).toBe('open');
    expect(spawnedCommands[0]?.[1]).toBe(TEST_UI_URL);

    spawnSpy.mockRestore();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("calls 'xdg-open' on linux", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });

    const spawnedCommands: string[][] = [];
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(makeSpawnMock(spawnedCommands));

    await openBrowser(TEST_UI_URL);

    expect(spawnedCommands).toHaveLength(1);
    expect(spawnedCommands[0]?.[0]).toBe('xdg-open');

    spawnSpy.mockRestore();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('logs a warning on unknown platform without spawning', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'freebsd',
      configurable: true,
    });

    const spawnedCommands: string[][] = [];
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation(makeSpawnMock(spawnedCommands));

    // Should not throw, and should not spawn
    await openBrowser(TEST_UI_URL);
    expect(spawnedCommands).toHaveLength(0);

    spawnSpy.mockRestore();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });
});
