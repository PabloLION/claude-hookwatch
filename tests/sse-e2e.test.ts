/**
 * Playwright E2E tests for SSE live updates in the hookwatch browser UI.
 * (Story 2.4c: SSE integration tests)
 *
 * Covers:
 *   - New event appears in the table without a page refresh (SSE push)
 *   - Newly arrived event is at the TOP of the list (reverse-chronological)
 *   - Session filter blocks SSE events whose session_id does not match
 *   - Session filter passes SSE events whose session_id matches
 *   - Multiple events posted in sequence arrive in reverse-chronological order
 *
 * Test setup pattern:
 *   1. Spawn hookwatch server as a subprocess with an isolated XDG_DATA_HOME
 *   2. Wait for /health to respond
 *   3. Optionally seed events via POST /api/events before page load
 *   4. Navigate Playwright to http://127.0.0.1:<port>/
 *   5. POST new events to the live server (SSE broadcasts them to the browser)
 *   6. Assert on updated DOM without calling page.reload()
 *   7. Kill server and clean up after test
 *
 * Playwright runs in Node.js — we use child_process.spawn (not Bun.spawn)
 * for server lifecycle management.
 *
 * Run with: bun run test:sse-e2e
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

/** A minimal valid SessionStart payload. */
function makeSessionStart(sessionId: string): Record<string, unknown> {
  return {
    hook_event_name: "SessionStart",
    session_id: sessionId,
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/home/user/project",
    permission_mode: "default",
    source: "startup",
    model: "claude-sonnet-4-6",
  };
}

/** A minimal valid PreToolUse payload with a tool name. */
function makePreToolUse(sessionId: string, toolName: string): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/home/user/project",
    permission_mode: "default",
    tool_name: toolName,
    tool_use_id: "toolu_01SSEtest",
    tool_input: { command: "echo hello", description: "print" },
  };
}

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
const tmpRoot = join(tmpdir(), `hookwatch-sse-e2e-${Date.now()}`);

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
// Test 1: New event appears in the table without page refresh (SSE push)
// ---------------------------------------------------------------------------

test(
  "live event appears at the top of the list without page refresh",
  async () => {
    const server = await startServer(tmpRoot, "sse-live-update-test");
    const { context, page } = await freshPage();

    try {
      // Navigate to the empty UI — no events yet
      await page.goto(server.baseUrl);

      // Wait for the empty state to confirm page loaded and SSE is connected
      const emptyMsg = page.locator(
        "text=No events captured yet. Interact with Claude Code to generate events.",
      );
      await expect(emptyMsg).toBeVisible({ timeout: 10000 });

      // POST a SessionStart event to the live server.
      // The server inserts it into the DB, then broadcasts it over SSE.
      // The browser SSE client receives it and prepends it to eventList.
      await seedEvent(server.baseUrl, makeSessionStart("sse-session-001"));

      // Assert the table appears WITHOUT reloading the page
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // One row must be present
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(1, { timeout: 10000 });

      // The row must show the correct event type and session ID
      const firstRow = rows.nth(0);
      await expect(firstRow.locator("td").nth(1)).toHaveText("SessionStart");
      await expect(firstRow.locator("td").nth(2)).toHaveText("sse-session-001");
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 2: SSE event for a different session_id is filtered out;
//          SSE event for the active session_id appears
// ---------------------------------------------------------------------------

test(
  "session filter blocks SSE events from other sessions and passes matching ones",
  async () => {
    const server = await startServer(tmpRoot, "sse-session-filter-test");
    const { context, page } = await freshPage();

    try {
      // Seed a SessionStart so session-A exists in the dropdown before page load.
      // We need the dropdown to be populated so we can select it.
      await seedEvent(server.baseUrl, makeSessionStart("filter-session-A"));

      await page.goto(server.baseUrl);

      // Wait for the initial event to render
      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });
      await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 10000 });

      // Wait for the session filter dropdown to be enabled (sessions fetched)
      const select = page.locator("select#session-filter");
      await expect(select).not.toBeDisabled({ timeout: 10000 });

      // Select filter-session-A — only events from session-A should appear
      await select.selectOption({ value: "filter-session-A" });

      // Row count stays at 1 (only session-A event)
      await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 10000 });

      // POST an event from a DIFFERENT session (session-B).
      // The SSE client should drop it because activeSession !== "filter-session-A".
      await seedEvent(server.baseUrl, makePreToolUse("filter-session-B", "Read"));

      // Give the browser time to receive the SSE message (100 ms is enough;
      // if filtering works, the row will NOT appear).
      await page.waitForTimeout(500);

      // Row count must still be 1 — session-B event was filtered client-side
      await expect(page.locator("tbody tr")).toHaveCount(1, { timeout: 5000 });

      // Now POST an event from session-A (the active session).
      // The SSE client should prepend it to eventList.
      await seedEvent(server.baseUrl, makePreToolUse("filter-session-A", "Write"));

      // Two rows must now appear (both session-A events)
      await expect(page.locator("tbody tr")).toHaveCount(2, { timeout: 10000 });

      // The newest event (PreToolUse) must be first (reverse-chronological)
      const firstRow = page.locator("tbody tr").nth(0);
      await expect(firstRow.locator("td").nth(1)).toHaveText("PreToolUse");
      await expect(firstRow.locator("td").nth(2)).toHaveText("filter-session-A");
      await expect(firstRow.locator("td").nth(3)).toHaveText("Write");
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 3: Multiple events arrive in reverse-chronological order
// ---------------------------------------------------------------------------

test(
  "multiple SSE events arrive and appear in reverse-chronological order",
  async () => {
    const server = await startServer(tmpRoot, "sse-order-test");
    const { context, page } = await freshPage();

    try {
      // Start with an empty page — the empty-state confirms page+SSE are ready
      await page.goto(server.baseUrl);

      const emptyMsg = page.locator(
        "text=No events captured yet. Interact with Claude Code to generate events.",
      );
      await expect(emptyMsg).toBeVisible({ timeout: 10000 });

      // POST three events in sequence with small delays so their DB timestamps differ
      await seedEvent(server.baseUrl, makeSessionStart("order-session-001"));
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      await seedEvent(server.baseUrl, makePreToolUse("order-session-001", "Bash"));
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      await seedEvent(server.baseUrl, makePreToolUse("order-session-001", "Read"));

      // All three events must appear without a page refresh
      const rows = page.locator("tbody tr");
      await expect(rows).toHaveCount(3, { timeout: 15000 });

      // SSE client prepends each incoming event, so the last-sent event is at
      // the top. Insertion order:
      //   1st sent → SessionStart    → ends up at index 2 (pushed down by later events)
      //   2nd sent → PreToolUse/Bash → ends up at index 1
      //   3rd sent → PreToolUse/Read → ends up at index 0 (most recent)
      const firstRow = rows.nth(0);
      await expect(firstRow.locator("td").nth(1)).toHaveText("PreToolUse");
      await expect(firstRow.locator("td").nth(3)).toHaveText("Read");

      const secondRow = rows.nth(1);
      await expect(secondRow.locator("td").nth(1)).toHaveText("PreToolUse");
      await expect(secondRow.locator("td").nth(3)).toHaveText("Bash");

      const thirdRow = rows.nth(2);
      await expect(thirdRow.locator("td").nth(1)).toHaveText("SessionStart");
      // SessionStart has no tool — EventList renders em-dash (U+2014)
      await expect(thirdRow.locator("td").nth(3)).toHaveText("\u2014");
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 45000 },
);
