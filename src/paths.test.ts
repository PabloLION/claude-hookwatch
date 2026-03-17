/**
 * Unit tests for readPort() in src/paths.ts.
 *
 * readPort() reads the server port from the port file that the server writes
 * on startup. It returns { port, warning } and always falls back to
 * DEFAULT_PORT rather than throwing.
 *
 * Test strategy: set process.env.XDG_DATA_HOME to a temp directory so
 * portFilePath() resolves to a controlled location. Restore the env var in
 * afterEach to prevent cross-test pollution.
 *
 * Coverage:
 * - Valid port file → returns that port, warning is null
 * - Missing file (ENOENT) → returns DEFAULT_PORT, warning is null
 * - Invalid content (non-numeric, zero, >65535) → returns DEFAULT_PORT, warning is non-null
 * - OS error (EISDIR) → returns DEFAULT_PORT, warning is non-null string describing the error
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PORT } from '@/config.ts';
import { readPort } from './paths.ts';

const TEST_VALID_PORT = 7890;
const TEST_WHITESPACE_PORT = 8080;
const MAX_VALID_PORT = 65535;
const PORT_FILE_NAME = 'hookwatch.port';

// ---------------------------------------------------------------------------
// Test setup: isolated XDG_DATA_HOME per test
// ---------------------------------------------------------------------------

let originalXdgDataHome: string | undefined;
let tmpDir: string;

beforeEach(() => {
  originalXdgDataHome = process.env.XDG_DATA_HOME;
  tmpDir = mkdtempSync(join(tmpdir(), 'hookwatch-paths-test-'));
  process.env.XDG_DATA_HOME = tmpDir;
});

afterEach(() => {
  // Restore original env var (may be undefined — delete in that case)
  if (originalXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = originalXdgDataHome;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Writes the port file content inside the controlled XDG_DATA_HOME. */
function writePortFile(content: string): void {
  const dir = join(tmpDir, 'hookwatch');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PORT_FILE_NAME), content);
}

// ---------------------------------------------------------------------------
// Valid port file
// ---------------------------------------------------------------------------

describe('valid port file', () => {
  test('reads the exact port number from the file', () => {
    writePortFile(String(TEST_VALID_PORT));
    const result = readPort();
    expect(result.port).toBe(TEST_VALID_PORT);
    expect(result.warning).toBeNull();
  });

  test('trims surrounding whitespace before parsing', () => {
    writePortFile(`  ${TEST_WHITESPACE_PORT}\n`);
    const result = readPort();
    expect(result.port).toBe(TEST_WHITESPACE_PORT);
    expect(result.warning).toBeNull();
  });

  test('returns warning: null on success', () => {
    writePortFile('6004');
    const result = readPort();
    expect(result.warning).toBeNull();
  });

  test('accepts port 1 (minimum valid port)', () => {
    writePortFile('1');
    const result = readPort();
    expect(result.port).toBe(1);
    expect(result.warning).toBeNull();
  });

  test('accepts port 65535 (maximum valid port)', () => {
    writePortFile(String(MAX_VALID_PORT));
    const result = readPort();
    expect(result.port).toBe(MAX_VALID_PORT);
    expect(result.warning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Missing file (ENOENT)
// ---------------------------------------------------------------------------

describe('missing port file (ENOENT)', () => {
  test('returns DEFAULT_PORT when file does not exist', () => {
    // No writePortFile call — file is absent
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
  });

  test('returns warning: null on ENOENT (silent fallback)', () => {
    const result = readPort();
    expect(result.warning).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invalid content (non-numeric, out-of-range)
// ---------------------------------------------------------------------------

describe('invalid port file content', () => {
  test('non-numeric content → DEFAULT_PORT, non-null warning', () => {
    writePortFile('not-a-port');
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('not-a-port');
  });

  test('empty file → DEFAULT_PORT, non-null warning', () => {
    writePortFile('');
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
  });

  test('port 0 (invalid) → DEFAULT_PORT, non-null warning', () => {
    writePortFile('0');
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('0');
  });

  test('port 65536 (above max) → DEFAULT_PORT, non-null warning', () => {
    writePortFile('65536');
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('65536');
  });

  test('negative port number → DEFAULT_PORT, non-null warning', () => {
    writePortFile('-1');
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('-1');
  });

  test('non-numeric string → DEFAULT_PORT, non-null warning', () => {
    writePortFile('abc6');
    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('abc6');
  });
});

// ---------------------------------------------------------------------------
// OS errors (non-ENOENT) → warning returned
// ---------------------------------------------------------------------------

describe('OS error reading port file (non-ENOENT)', () => {
  test('EISDIR: port file path is a directory → DEFAULT_PORT with non-null warning', () => {
    // Create a directory where the port file should be — readFileSync throws EISDIR.
    // EISDIR is a reliable cross-platform non-ENOENT OS error for this scenario.
    const dir = join(tmpDir, 'hookwatch');
    const portFilePath = join(dir, PORT_FILE_NAME);
    mkdirSync(portFilePath, { recursive: true }); // create dir at file path

    const result = readPort();
    expect(result.port).toBe(DEFAULT_PORT);
    expect(result.warning).not.toBeNull();
    expect(typeof result.warning).toBe('string');
  });

  test('EISDIR: warning string mentions the error code or DEFAULT_PORT', () => {
    const dir = join(tmpDir, 'hookwatch');
    const portFilePath = join(dir, PORT_FILE_NAME);
    mkdirSync(portFilePath, { recursive: true });

    const result = readPort();
    // Warning should reference either the error code or the fallback
    const warning = result.warning ?? '';
    expect(warning.length).toBeGreaterThan(0);
    // The message includes either the OS code or a description
    const containsCode = warning.includes('EISDIR') || warning.includes('unknown');
    const containsFallback =
      warning.toLowerCase().includes('default_port') || warning.includes('DEFAULT_PORT');
    expect(containsCode || containsFallback).toBe(true);
  });
});
