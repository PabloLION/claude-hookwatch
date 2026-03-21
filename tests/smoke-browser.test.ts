/**
 * Browser-level smoke tests for the hookwatch web UI.
 * (Issue ch-13i.1 — Layer 2)
 *
 * Covers:
 *   1. Posted events appear in the event list table
 *   2. Clicking a row expands the event detail
 *   3. Event detail shows Full stdin with formatted JSON
 *   4. Wrapped events show the wrap-viewer with stdout/stderr panels
 *   5. Bare events show tool info header for PreToolUse events
 *
 * Test setup:
 *   1. Spawn hookwatch server as subprocess with isolated XDG_DATA_HOME
 *   2. Wait for /health to respond
 *   3. POST synthetic events via HTTP
 *   4. Open UI in Playwright and assert on rendered DOM
 *   5. Kill server and clean up
 *
 * Playwright runs in Node.js — use child_process.spawn (not Bun.spawn).
 *
 * Run with: playwright test tests/smoke-browser.test.ts
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type BrowserContext, chromium, expect, type Page, test } from '@playwright/test';
import type { ServerHandle } from '@/test';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const SERVER_PATH = new URL('../src/server/index.ts', import.meta.url).pathname;
/** Port 0 = OS auto-assigns a free port. The server writes the actual port to the port file. */
const TEST_PORT = 0;

/** A minimal valid SessionStart payload. */
const SESSION_START_EVENT = {
  hook_event_name: 'SessionStart',
  session_id: 'smoke-browser-session-001',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  source: 'startup',
  model: 'claude-sonnet-4-6',
};

/** A bare (non-wrapped) PreToolUse event — no wrap fields. */
const BARE_PRE_TOOL_USE = {
  hook_event_name: 'PreToolUse',
  session_id: 'smoke-browser-session-002',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_use_id: 'toolu_smoke_bare_001',
  tool_input: { command: 'ls -la', description: 'list files' },
};

/** A wrapped PreToolUse event with stdout, stderr, exit_code, wrapped_command. */
const WRAPPED_PRE_TOOL_USE = {
  hook_event_name: 'PreToolUse',
  session_id: 'smoke-browser-session-003',
  transcript_path: '/tmp/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
  tool_name: 'Bash',
  tool_use_id: 'toolu_smoke_wrapped_001',
  tool_input: { command: 'echo smoke test', description: 'smoke' },
  wrapped_command: "sh -c 'echo smoke test'",
  stdout: 'smoke test\n',
  stderr: 'warning: minor issue\n',
  exit_code: 0,
};

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

async function startServer(tmpBase: string, label: string): Promise<ServerHandle> {
  const xdgDataHome = join(tmpBase, label);
  mkdirSync(xdgDataHome, { recursive: true });

  const proc = spawn('bun', ['--bun', SERVER_PATH, '--port', String(TEST_PORT)], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: 'pipe',
    detached: false,
  });

  const portDeadline = Date.now() + 10000;
  let port: number | null = null;
  while (Date.now() < portDeadline) {
    port = readPortFile(xdgDataHome);
    if (port !== null) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }

  if (port === null) {
    proc.kill();
    throw new Error(`[smoke-browser] server (${label}) did not write port file within 10s`);
  }

  const healthy = await waitForHealth(port);
  if (!healthy) {
    proc.kill();
    throw new Error(
      `[smoke-browser] server (${label}) on port ${port} did not become healthy within 8s`,
    );
  }

  const stop = (): void => {
    try {
      proc.kill('SIGTERM');
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

async function seedEvent(baseUrl: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${baseUrl}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status !== 201) {
    throw new Error(`[smoke-browser] seedEvent failed: HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Global Playwright browser setup
// ---------------------------------------------------------------------------

let browser: Awaited<ReturnType<typeof chromium.launch>>;
const tmpRoot = join(tmpdir(), `hookwatch-smoke-browser-${Date.now()}`);

test.beforeAll(async () => {
  mkdirSync(tmpRoot, { recursive: true });
  browser = await chromium.launch({ headless: true });
});

test.afterAll(async () => {
  await browser.close();
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Ignore
  }
});

async function freshPage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

// ---------------------------------------------------------------------------
// Test 1: Posted events appear in the event list table
// ---------------------------------------------------------------------------

test(
  'posted events appear in the event list table',
  async () => {
    const server = await startServer(tmpRoot, 'event-list-test');
    const { context, page } = await freshPage();

    try {
      // Seed two events — SessionStart and PreToolUse
      await seedEvent(server.baseUrl, SESSION_START_EVENT);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await seedEvent(server.baseUrl, BARE_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      // Wait for the table to appear
      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Both events must appear (reverse-chronological, so PreToolUse is first)
      const eventRows = page.locator('tbody tr[data-event-id]');
      await expect(eventRows).toHaveCount(2, { timeout: 10000 });

      // First row is PreToolUse (most recent)
      const firstRow = eventRows.nth(0);
      await expect(firstRow.locator('td').nth(1)).toHaveText('PreToolUse');

      // Second row is SessionStart (oldest)
      const secondRow = eventRows.nth(1);
      await expect(secondRow.locator('td').nth(1)).toHaveText('SessionStart');
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 2: Clicking a row expands the event detail
// ---------------------------------------------------------------------------

test(
  'clicking a row expands the event detail view',
  async () => {
    const server = await startServer(tmpRoot, 'expand-detail-test');
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, SESSION_START_EVENT);

      await page.goto(server.baseUrl);

      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Detail row should not be visible before clicking
      const detailRow = page.locator('[data-detail-for]');
      await expect(detailRow).not.toBeVisible();

      // Click the event row
      const firstRow = page.locator('tbody tr[data-event-id]').first();
      await firstRow.click();

      // The detail view should now be visible
      await expect(detailRow).toBeVisible({ timeout: 5000 });

      // Clicking the same row again collapses the detail
      await firstRow.click();
      await expect(detailRow).not.toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 3: Event detail shows Full stdin with formatted JSON
// ---------------------------------------------------------------------------

test(
  'event detail shows Full stdin as formatted JSON inside pre/code',
  async () => {
    const server = await startServer(tmpRoot, 'stdin-json-test');
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, SESSION_START_EVENT);

      await page.goto(server.baseUrl);

      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Click the first row to expand
      await page.locator('tbody tr[data-event-id]').first().click();

      const detailContainer = page.locator('[data-detail-for] .event-detail');
      await expect(detailContainer).toBeVisible({ timeout: 5000 });

      // There should be a <details> with <pre><code> showing the JSON stdin
      const preCode = detailContainer.locator('details pre code');
      await expect(preCode).toBeVisible();

      const codeText = await preCode.textContent();
      // The JSON must contain the session_id
      expect(codeText).toContain('smoke-browser-session-001');
      // The JSON must contain hook_event_name key
      expect(codeText).toContain('"hook_event_name"');
      // Formatted JSON has indentation (at least 2 spaces)
      expect(codeText).toContain('  ');
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 4: Wrapped events show the wrap-viewer with stdout/stderr panels
// ---------------------------------------------------------------------------

test(
  'wrapped event detail shows wrap-viewer with stdout and stderr panels',
  async () => {
    const server = await startServer(tmpRoot, 'wrap-viewer-smoke-test');
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, WRAPPED_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Click the wrapped event row
      await page.locator('tbody tr[data-event-id]').first().click();

      // The wrap-viewer component must appear
      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).toBeVisible({ timeout: 5000 });

      // wrapped_command must be displayed
      const wrappedCmd = wrapViewer.locator("[data-testid='wrapped-command']");
      await expect(wrappedCmd).toBeVisible();
      await expect(wrappedCmd).toHaveText("sh -c 'echo smoke test'");

      // stdout panel must be present and show the captured output
      const stdoutPanel = wrapViewer.locator("[data-testid='stdout-panel']");
      await expect(stdoutPanel).toBeVisible();
      const stdoutContent = stdoutPanel.locator("[data-testid='stdout-content']");
      await expect(stdoutContent).toBeVisible();
      const stdoutText = await stdoutContent.textContent();
      expect(stdoutText).toContain('smoke test');

      // stderr panel must be present and show the captured error output
      const stderrPanel = wrapViewer.locator("[data-testid='stderr-panel']");
      await expect(stderrPanel).toBeVisible();
      const stderrContent = stderrPanel.locator("[data-testid='stderr-content']");
      await expect(stderrContent).toBeVisible();
      const stderrText = await stderrContent.textContent();
      expect(stderrText).toContain('warning: minor issue');

      // Exit code must be shown
      const exitCode = wrapViewer.locator("[data-testid='exit-code']");
      await expect(exitCode).toBeVisible();
      await expect(exitCode).toHaveText('0');
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 5: Bare PreToolUse events show tool info header (not wrap-viewer)
// ---------------------------------------------------------------------------

test(
  'bare PreToolUse event shows tool info header, not wrap-viewer',
  async () => {
    const server = await startServer(tmpRoot, 'bare-tool-header-test');
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, BARE_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator('table');
      await expect(table).toBeVisible({ timeout: 10000 });

      // Click the PreToolUse row
      await page.locator('tbody tr[data-event-id]').first().click();

      const detailContainer = page.locator('[data-detail-for] .event-detail');
      await expect(detailContainer).toBeVisible({ timeout: 5000 });

      // wrap-viewer must NOT appear for bare events
      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).not.toBeVisible();

      // Standard tool info <dl> must appear (PreToolUse is a tool event)
      const dl = detailContainer.locator('dl');
      await expect(dl).toBeVisible();

      // The dl must show "Tool name" and "Bash"
      await expect(dl.locator('dt', { hasText: 'Tool name' })).toBeVisible();
      await expect(dl.locator('dd', { hasText: 'Bash' })).toBeVisible();

      // Tool input must be present (command: ls -la)
      await expect(dl.locator('dt', { hasText: 'Tool input' })).toBeVisible();
      const toolInputCode = dl.locator('pre code');
      await expect(toolInputCode).toBeVisible();
      const toolInputText = await toolInputCode.textContent();
      expect(toolInputText).toContain('ls -la');
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);
