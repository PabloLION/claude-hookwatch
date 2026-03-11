/**
 * Playwright E2E tests for the hookwatch Event List and Session Filter UI
 * (Stories 2.1d and 2.2).
 *
 * Covers:
 *   - index.html loads with Pico CSS applied
 *   - Empty state renders "No events captured yet" when DB is empty
 *   - Event list renders seeded events in reverse chronological order
 *     with correct columns: timestamp, event type, session ID, tool name
 *   - Session filter dropdown populates with distinct session IDs
 *   - Selecting a session filters the event list to that session only
 *   - Selecting "All sessions" restores all events
 *
 * Test setup pattern:
 *   1. Spawn hookwatch server as a subprocess with an isolated XDG_DATA_HOME
 *   2. Wait for /health to respond
 *   3. Seed events via POST /api/events
 *   4. Navigate Playwright to http://127.0.0.1:<port>/
 *   5. Assert on rendered DOM
 *   6. Kill server and clean up after test
 *
 * Playwright runs in Node.js — we use child_process.spawn (not Bun.spawn)
 * for server lifecycle management.
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
const BASE_SESSION_START = {
  session_id: "e2e-test-session-001",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "SessionStart",
  source: "startup",
  model: "claude-sonnet-4-6",
};

const PRE_TOOL_USE_BASH = {
  session_id: "e2e-test-session-002",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_01ABC123",
  tool_input: { command: "ls -la", description: "list files" },
};

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Read the port from the hookwatch port file.
 * Returns null if absent or non-numeric.
 */
function readPortFile(xdgDataHome: string): number | null {
  try {
    const content = readFileSync(join(xdgDataHome, "hookwatch", "hookwatch.port"), "utf8").trim();
    const port = Number.parseInt(content, 10);
    return Number.isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

/**
 * Poll /health until the server responds or timeout expires.
 * Returns true when healthy, false on timeout.
 */
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

/**
 * Spawn the hookwatch server with an isolated temp directory using Node's
 * child_process.spawn (Playwright runs in Node.js, not Bun).
 * Waits until /health responds before returning.
 * Throws if the server fails to start within the timeout.
 */
async function startServer(tmpBase: string, label: string): Promise<ServerHandle> {
  const xdgDataHome = join(tmpBase, label);
  mkdirSync(xdgDataHome, { recursive: true });

  const proc = spawn("bun", ["--bun", SERVER_PATH], {
    env: {
      ...process.env,
      XDG_DATA_HOME: xdgDataHome,
    },
    stdio: "pipe",
    detached: false,
  });

  // Poll the port file until the server writes it, then poll /health
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

/**
 * POST a single event payload to the server and assert 201.
 */
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
const tmpRoot = join(tmpdir(), `hookwatch-e2e-${Date.now()}`);

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

// ---------------------------------------------------------------------------
// Helper: create a fresh browser context + page for one test
// ---------------------------------------------------------------------------

async function freshPage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

// ---------------------------------------------------------------------------
// Test 1: index.html loads with Pico CSS
// ---------------------------------------------------------------------------

test(
  "index.html loads with Pico CSS applied",
  async () => {
    const server = await startServer(tmpRoot, "pico-css-test");
    const { context, page } = await freshPage();

    try {
      await page.goto(server.baseUrl);

      // The page title should be "hookwatch"
      await expect(page).toHaveTitle("hookwatch");

      // Pico CSS is linked as /pico.min.css in index.html.
      // Verify the stylesheet was loaded by checking for a <link> element.
      const picoLink = page.locator('link[rel="stylesheet"][href="/pico.min.css"]');
      await expect(picoLink).toBeAttached();

      // Pico CSS adds styles to semantic elements — verify the <main> tag is
      // present in the DOM (App component renders <main class="container">)
      const main = page.locator("main.container");
      await expect(main).toBeVisible();

      // Pico CSS itself is served — verify its HTTP status
      const picoRes = await page.request.get(`${server.baseUrl}/pico.min.css`);
      expect(picoRes.status()).toBe(200);
      const ct = picoRes.headers()["content-type"] ?? "";
      expect(ct).toContain("text/css");
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 2: Empty state when no events exist
// ---------------------------------------------------------------------------

test(
  "empty state displays when no events exist",
  async () => {
    const server = await startServer(tmpRoot, "empty-state-test");
    const { context, page } = await freshPage();

    try {
      // Navigate without seeding any events
      await page.goto(server.baseUrl);

      // Wait for the UI to mount and fetch (empty) results from /api/query.
      // The EventList component renders this text when eventList.value === [].
      const emptyMsg = page.locator(
        "text=No events captured yet. Interact with Claude Code to generate events.",
      );
      await expect(emptyMsg).toBeVisible({ timeout: 10000 });

      // The events table must NOT be present in the empty state
      const table = page.locator("table");
      await expect(table).not.toBeVisible();
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 3: Event list renders seeded events with correct columns
// ---------------------------------------------------------------------------

test(
  "event list renders seeded events in reverse chronological order with correct columns",
  async () => {
    const server = await startServer(tmpRoot, "event-list-test");
    const { context, page } = await freshPage();

    try {
      // Seed two events with a small delay between them so timestamps differ
      await seedEvent(server.baseUrl, BASE_SESSION_START);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await seedEvent(server.baseUrl, PRE_TOOL_USE_BASH);

      // Load the page — the UI fetches from /api/query on mount
      await page.goto(server.baseUrl);

      // Wait for the table to appear (events present)
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // Verify the table header columns
      await expect(page.locator("th", { hasText: "Timestamp" })).toBeVisible();
      await expect(page.locator("th", { hasText: "Event Type" })).toBeVisible();
      await expect(page.locator("th", { hasText: "Session ID" })).toBeVisible();
      await expect(page.locator("th", { hasText: "Tool Name" })).toBeVisible();

      // Verify both events appear in the table body
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(2, { timeout: 10000 });

      // /api/query returns events in reverse chronological order (most recent first).
      // PreToolUse was inserted last, so it should be row 0.
      const firstRow = rows.nth(0);
      await expect(firstRow.locator("td").nth(1)).toHaveText("PreToolUse");
      await expect(firstRow.locator("td").nth(2)).toHaveText("e2e-test-session-002");
      await expect(firstRow.locator("td").nth(3)).toHaveText("Bash");

      // SessionStart was inserted first, so it should be row 1.
      const secondRow = rows.nth(1);
      await expect(secondRow.locator("td").nth(1)).toHaveText("SessionStart");
      await expect(secondRow.locator("td").nth(2)).toHaveText("e2e-test-session-001");
      // SessionStart has no tool_name — EventList renders em-dash (U+2014)
      await expect(secondRow.locator("td").nth(3)).toHaveText("\u2014");
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 4: Session filter dropdown populates and filtering works (Story 2.2)
// ---------------------------------------------------------------------------

test(
  "session filter dropdown populates, filtering works, clearing restores all",
  async () => {
    const server = await startServer(tmpRoot, "session-filter-test");
    const { context, page } = await freshPage();

    try {
      // Seed two events from different sessions
      await seedEvent(server.baseUrl, BASE_SESSION_START); // session-001
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await seedEvent(server.baseUrl, PRE_TOOL_USE_BASH); // session-002

      await page.goto(server.baseUrl);

      // Wait for the table to appear (both events loaded)
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });
      await expect(page.locator("tbody tr")).toHaveCount(2, { timeout: 10000 });

      // The session filter dropdown must be present and enabled
      const select = page.locator("select#session-filter");
      await expect(select).toBeVisible({ timeout: 10000 });
      await expect(select).not.toBeDisabled();

      // Dropdown must have "All sessions" plus one option per distinct session
      // (2 sessions seeded → 3 options total)
      const options = select.locator("option");
      await expect(options).toHaveCount(3, { timeout: 10000 });
      await expect(options.nth(0)).toHaveText("All sessions");

      // Select session-001 — only that session's events should appear
      await select.selectOption({ value: "e2e-test-session-001" });
      await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 10000 });
      const filteredRow = page.locator("tbody tr").nth(0);
      await expect(filteredRow.locator("td").nth(1)).toHaveText("SessionStart");
      await expect(filteredRow.locator("td").nth(2)).toHaveText("e2e-test-session-001");

      // Select "All sessions" (empty value) — both events should be restored
      await select.selectOption({ value: "" });
      await expect(page.locator("tbody tr")).toHaveCount(2, { timeout: 10000 });
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);
