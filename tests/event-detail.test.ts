/**
 * Playwright E2E tests for the EventDetail expand/collapse (Story 2.3).
 *
 * Covers:
 *   - Clicking a row expands the detail view below it
 *   - Clicking the same row again collapses the detail view
 *   - The detail view shows the full payload as formatted JSON
 *   - Tool-related events (PreToolUse) show tool_name and tool_input in a <dl>
 *   - Non-tool events (SessionStart) do NOT show the tool info header
 *   - Multiple rows can be expanded simultaneously (not exclusive accordion)
 *
 * Test setup pattern:
 *   1. Spawn hookwatch server as a subprocess with an isolated XDG_DATA_HOME
 *   2. Wait for /health to respond
 *   3. Seed events via POST /api/events
 *   4. Navigate Playwright to http://127.0.0.1:<port>/
 *   5. Assert on rendered DOM
 *   6. Kill server and clean up after test
 *
 * Run with: bun run test:e2e
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";
import type { ServerHandle } from "@/test";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const SERVER_PATH = new URL("../src/server/index.ts", import.meta.url).pathname;

const SESSION_START_EVENT = {
  session_id: "detail-test-session-001",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "SessionStart",
  source: "startup",
  model: "claude-sonnet-4-6",
};

const PRE_TOOL_USE_EVENT = {
  session_id: "detail-test-session-002",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_detail_test",
  tool_input: { command: "echo hello", description: "greet the world" },
};

// ---------------------------------------------------------------------------
// Server lifecycle helpers (same pattern as ui-e2e.test.ts)
// ---------------------------------------------------------------------------

function readPortFile(xdgDataHome: string): number | null {
  try {
    const content = readFileSync(join(xdgDataHome, "hookwatch", "hookwatch.port"), "utf8").trim();
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

  const proc = spawn("bun", ["--bun", SERVER_PATH], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: "pipe",
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
    throw new Error(`[e2e] server (${label}) did not write port file within 10s`);
  }

  const healthy = await waitForHealth(port);
  if (!healthy) {
    proc.kill();
    throw new Error(`[e2e] server (${label}) on port ${port} did not become healthy within 8s`);
  }

  const stop = (): void => {
    try {
      proc.kill("SIGTERM");
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
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status !== 201) {
    throw new Error(`[e2e] seedEvent failed: HTTP ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Global Playwright browser setup
// ---------------------------------------------------------------------------

let browser: Awaited<ReturnType<typeof chromium.launch>>;
const tmpRoot = join(tmpdir(), `hookwatch-event-detail-${Date.now()}`);

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
// Test 1: Clicking a row expands and collapses the detail view
// ---------------------------------------------------------------------------

test(
  "clicking a row expands the detail view; clicking again collapses it",
  async () => {
    const server = await startServer(tmpRoot, "expand-collapse-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, SESSION_START_EVENT);
      await page.goto(server.baseUrl);

      // Wait for the table to appear
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // The detail row should not be visible before clicking
      const detailRow = page.locator("[data-detail-for]");
      await expect(detailRow).not.toBeVisible();

      // Click the first row to expand it
      const firstRow = page.locator("tbody tr").first();
      await firstRow.click();

      // The detail view should now be visible
      await expect(detailRow).toBeVisible({ timeout: 5000 });

      // Click the same row again to collapse it
      await firstRow.click();

      // The detail view should be gone
      await expect(detailRow).not.toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 2: Detail view shows payload as formatted JSON
// ---------------------------------------------------------------------------

test(
  "detail view shows the full payload as formatted JSON inside pre/code",
  async () => {
    const server = await startServer(tmpRoot, "json-format-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, SESSION_START_EVENT);
      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // Expand the first row
      await page.locator("tbody tr").first().click();

      // The detail section should contain a <details> with <pre><code> payload
      const detailContainer = page.locator("[data-detail-for] .event-detail");
      await expect(detailContainer).toBeVisible({ timeout: 5000 });

      const preCode = detailContainer.locator("details pre code");
      await expect(preCode).toBeVisible();

      // The JSON should contain the session_id from the seeded event
      const codeText = await preCode.textContent();
      expect(codeText).toContain("detail-test-session-001");
      // Formatted JSON should contain indented key-value pairs
      expect(codeText).toContain('"session_id"');
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 3: Tool-related event shows tool_name and tool_input header
// ---------------------------------------------------------------------------

test(
  "tool-related event (PreToolUse) shows tool_name and tool_input in detail header",
  async () => {
    const server = await startServer(tmpRoot, "tool-info-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, PRE_TOOL_USE_EVENT);
      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // Click the PreToolUse row to expand it
      await page.locator("tbody tr").first().click();

      const detailContainer = page.locator("[data-detail-for] .event-detail");
      await expect(detailContainer).toBeVisible({ timeout: 5000 });

      // Should show a <dl> definition list with tool_name
      const dl = detailContainer.locator("dl");
      await expect(dl).toBeVisible();

      // The dl should contain "Tool name" and "Bash"
      await expect(dl.locator("dt", { hasText: "Tool name" })).toBeVisible();
      await expect(dl.locator("dd", { hasText: "Bash" })).toBeVisible();

      // The dl should contain "Tool input" with the JSON-formatted tool_input
      await expect(dl.locator("dt", { hasText: "Tool input" })).toBeVisible();
      const toolInputCode = dl.locator("pre code");
      await expect(toolInputCode).toBeVisible();
      const toolInputText = await toolInputCode.textContent();
      expect(toolInputText).toContain("echo hello");
      expect(toolInputText).toContain('"command"');
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 4: Non-tool event does NOT show tool info header
// ---------------------------------------------------------------------------

test(
  "non-tool event (SessionStart) does NOT show the tool info header",
  async () => {
    const server = await startServer(tmpRoot, "no-tool-header-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, SESSION_START_EVENT);
      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // Expand the SessionStart row
      await page.locator("tbody tr").first().click();

      const detailContainer = page.locator("[data-detail-for] .event-detail");
      await expect(detailContainer).toBeVisible({ timeout: 5000 });

      // The <dl> with tool info should NOT appear for SessionStart
      const dl = detailContainer.locator("dl");
      await expect(dl).not.toBeVisible();

      // But the payload <details> section should still appear
      const details = detailContainer.locator("details");
      await expect(details).toBeVisible();
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 5: Multiple rows can be expanded simultaneously
// ---------------------------------------------------------------------------

test(
  "multiple rows can be expanded simultaneously (not exclusive accordion)",
  async () => {
    const server = await startServer(tmpRoot, "multi-expand-test");
    const { context, page } = await freshPage();

    try {
      // Seed two different events
      await seedEvent(server.baseUrl, SESSION_START_EVENT);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await seedEvent(server.baseUrl, PRE_TOOL_USE_EVENT);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });
      await expect(page.locator("tbody tr[data-event-id]")).toHaveCount(2, { timeout: 10000 });

      // Click the first event row
      await page.locator("tbody tr[data-event-id]").nth(0).click();
      // Click the second event row
      await page.locator("tbody tr[data-event-id]").nth(1).click();

      // Both detail rows should be visible at the same time
      const detailRows = page.locator("[data-detail-for]");
      await expect(detailRows).toHaveCount(2, { timeout: 5000 });
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);
