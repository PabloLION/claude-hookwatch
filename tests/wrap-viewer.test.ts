/**
 * Playwright E2E tests for the Wrap I/O Viewer (Story 3.2).
 *
 * Covers:
 *   - Bare handler events show hollow/outline badge style (data-wrapped="false")
 *   - Wrapped events show solid/filled badge style (data-wrapped="true")
 *   - Expanding a wrapped event renders the WrapViewer component
 *   - WrapViewer displays the wrapped_command
 *   - WrapViewer shows stdout panel (collapsible <details>)
 *   - WrapViewer shows stderr panel (collapsible <details>)
 *   - WrapViewer displays exit code with color (green=0, red=non-zero)
 *   - Collapsible panels (stdout/stderr) toggle open/closed
 *   - Bare event (wrapped_command null) still shows standard EventDetail
 *
 * NOTE: These tests require the rename agent (column rename) to be merged
 * first so that the server returns the new column names:
 *   timestamp (was ts), stdin (was payload), stdout, stderr, exit_code.
 * Until then, run these tests manually after the rename is merged.
 *
 * Test setup pattern:
 *   1. Spawn hookwatch server as subprocess with isolated XDG_DATA_HOME
 *   2. Wait for /health to respond
 *   3. Seed events via POST /api/events
 *   4. Navigate Playwright to http://127.0.0.1:<port>/
 *   5. Assert on rendered DOM
 *   6. Kill server and clean up after test
 *
 * Run with: bun run test:wrap-e2e
 */

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, expect, type Page, test } from "@playwright/test";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const SERVER_PATH = new URL("../src/server/index.ts", import.meta.url).pathname;

/** A bare (non-wrapped) PreToolUse event — wrapped_command is omitted. */
const BARE_PRE_TOOL_USE = {
  session_id: "wrap-test-session-bare",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_bare_test",
  tool_input: { command: "ls -la", description: "list files" },
};

/** A wrapped PreToolUse event with stdout, stderr, exit_code, wrapped_command. */
const WRAPPED_PRE_TOOL_USE = {
  session_id: "wrap-test-session-wrapped",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_wrapped_test",
  tool_input: { command: "echo hello", description: "greet the world" },
  // Top-level fields consumed by the server for wrap storage:
  wrapped_command: "sh -c 'echo hello'",
  stdout: "hello\n",
  stderr: "",
  exit_code: 0,
};

/** A wrapped event with non-zero exit code and stderr output. */
const WRAPPED_FAILING = {
  session_id: "wrap-test-session-fail",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_use_id: "toolu_fail_test",
  tool_input: { command: "cat /nonexistent", description: "fail on purpose" },
  wrapped_command: "sh -c 'cat /nonexistent'",
  stdout: "",
  stderr: "cat: /nonexistent: No such file or directory\n",
  exit_code: 1,
};

// ---------------------------------------------------------------------------
// Server lifecycle helpers
// ---------------------------------------------------------------------------

interface ServerHandle {
  port: number;
  xdgDataHome: string;
  proc: ChildProcess;
  baseUrl: string;
  stop: () => void;
}

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
const tmpRoot = join(tmpdir(), `hookwatch-wrap-${Date.now()}`);

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
// Test 1: Visual distinction — hollow badge for bare, solid for wrapped
// ---------------------------------------------------------------------------

test(
  "bare events show hollow badge; wrapped events show solid badge",
  async () => {
    const server = await startServer(tmpRoot, "badge-style-test");
    const { context, page } = await freshPage();

    try {
      // Seed a bare event followed by a wrapped event
      await seedEvent(server.baseUrl, BARE_PRE_TOOL_USE);
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      await seedEvent(server.baseUrl, WRAPPED_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // Two event rows expected
      const eventRows = page.locator("tbody tr[data-event-id]");
      await expect(eventRows).toHaveCount(2, { timeout: 10000 });

      // Wrapped event is first (reverse-chronological order)
      const wrappedRow = eventRows.nth(0);
      await expect(wrappedRow).toHaveAttribute("data-wrapped", "true");

      // Bare event is second
      const bareRow = eventRows.nth(1);
      await expect(bareRow).toHaveAttribute("data-wrapped", "false");

      // Wrapped badge has the --wrapped class
      const wrappedBadge = wrappedRow.locator("[data-testid='event-type-badge']");
      await expect(wrappedBadge).toBeVisible();
      await expect(wrappedBadge).toHaveClass(/event-type-badge--wrapped/);

      // Bare badge has the --bare class
      const bareBadge = bareRow.locator("[data-testid='event-type-badge']");
      await expect(bareBadge).toBeVisible();
      await expect(bareBadge).toHaveClass(/event-type-badge--bare/);
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 2: Expanding a wrapped event renders WrapViewer
// ---------------------------------------------------------------------------

test(
  "expanding a wrapped event renders the wrap-viewer component",
  async () => {
    const server = await startServer(tmpRoot, "wrap-viewer-render-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, WRAPPED_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      // Click the wrapped event row to expand it
      const eventRow = page.locator("tbody tr[data-event-id]").first();
      await eventRow.click();

      // WrapViewer should appear in the detail row
      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).toBeVisible({ timeout: 5000 });
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 3: WrapViewer shows wrapped_command, stdout, stderr, exit code
// ---------------------------------------------------------------------------

test(
  "wrap-viewer shows wrapped_command, stdout, stderr, and green exit code 0",
  async () => {
    const server = await startServer(tmpRoot, "wrap-viewer-content-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, WRAPPED_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      await page.locator("tbody tr[data-event-id]").first().click();

      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).toBeVisible({ timeout: 5000 });

      // Verify wrapped_command is displayed
      const wrappedCmd = wrapViewer.locator("[data-testid='wrapped-command']");
      await expect(wrappedCmd).toBeVisible();
      await expect(wrappedCmd).toHaveText("sh -c 'echo hello'");

      // Verify exit code is shown and is green (exit code 0)
      const exitCode = wrapViewer.locator("[data-testid='exit-code']");
      await expect(exitCode).toBeVisible();
      await expect(exitCode).toHaveText("0");

      // Verify stdout panel is present and contains stdout content
      const stdoutPanel = wrapViewer.locator("[data-testid='stdout-panel']");
      await expect(stdoutPanel).toBeVisible();
      const stdoutContent = stdoutPanel.locator("[data-testid='stdout-content']");
      await expect(stdoutContent).toBeVisible();
      const stdoutText = await stdoutContent.textContent();
      expect(stdoutText).toContain("hello");

      // Verify stderr panel is present — stderr is empty for this event
      const stderrPanel = wrapViewer.locator("[data-testid='stderr-panel']");
      await expect(stderrPanel).toBeVisible();
      const stderrEmpty = stderrPanel.locator("[data-testid='stderr-empty']");
      await expect(stderrEmpty).toBeVisible();
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 4: WrapViewer shows red exit code for non-zero and stderr content
// ---------------------------------------------------------------------------

test(
  "wrap-viewer shows red exit code for non-zero and stderr content",
  async () => {
    const server = await startServer(tmpRoot, "wrap-viewer-fail-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, WRAPPED_FAILING);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      await page.locator("tbody tr[data-event-id]").first().click();

      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).toBeVisible({ timeout: 5000 });

      // Exit code should be "1" and have red color styling
      const exitCode = wrapViewer.locator("[data-testid='exit-code']");
      await expect(exitCode).toBeVisible();
      await expect(exitCode).toHaveText("1");

      // stderr should have content
      const stderrPanel = wrapViewer.locator("[data-testid='stderr-panel']");
      await expect(stderrPanel).toBeVisible();
      const stderrContent = stderrPanel.locator("[data-testid='stderr-content']");
      await expect(stderrContent).toBeVisible();
      const stderrText = await stderrContent.textContent();
      expect(stderrText).toContain("No such file or directory");

      // stdout should be empty
      const stdoutPanel = wrapViewer.locator("[data-testid='stdout-panel']");
      const stdoutEmpty = stdoutPanel.locator("[data-testid='stdout-empty']");
      await expect(stdoutEmpty).toBeVisible();
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 5: Collapsible stdout/stderr panels can be toggled
// ---------------------------------------------------------------------------

test(
  "stdout and stderr panels in wrap-viewer can be collapsed and expanded",
  async () => {
    const server = await startServer(tmpRoot, "wrap-viewer-collapse-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, WRAPPED_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      await page.locator("tbody tr[data-event-id]").first().click();

      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).toBeVisible({ timeout: 5000 });

      // stdout panel starts open (open attribute)
      const stdoutPanel = wrapViewer.locator("[data-testid='stdout-panel']");
      await expect(stdoutPanel).toBeVisible();
      await expect(stdoutPanel).toHaveAttribute("open", "");

      // Click the stdout summary to close it
      await stdoutPanel.locator("summary").click();
      // After clicking, the panel should no longer have the open attribute
      await expect(stdoutPanel).not.toHaveAttribute("open");

      // Click again to re-open
      await stdoutPanel.locator("summary").click();
      await expect(stdoutPanel).toHaveAttribute("open", "");
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);

// ---------------------------------------------------------------------------
// Test 6: Bare event (wrapped_command null) still shows standard EventDetail
// ---------------------------------------------------------------------------

test(
  "bare event (wrapped_command null) shows standard EventDetail, not WrapViewer",
  async () => {
    const server = await startServer(tmpRoot, "bare-event-detail-test");
    const { context, page } = await freshPage();

    try {
      await seedEvent(server.baseUrl, BARE_PRE_TOOL_USE);

      await page.goto(server.baseUrl);

      const table = page.locator("table");
      await expect(table).toBeVisible({ timeout: 10000 });

      await page.locator("tbody tr[data-event-id]").first().click();

      const detailContainer = page.locator("[data-detail-for] .event-detail");
      await expect(detailContainer).toBeVisible({ timeout: 5000 });

      // WrapViewer should NOT appear for bare events
      const wrapViewer = page.locator("[data-testid='wrap-viewer']");
      await expect(wrapViewer).not.toBeVisible();

      // Standard tool info <dl> should appear (PreToolUse is a tool event)
      const dl = detailContainer.locator("dl");
      await expect(dl).toBeVisible();
      await expect(dl.locator("dt", { hasText: "Tool name" })).toBeVisible();
      await expect(dl.locator("dd", { hasText: "Bash" })).toBeVisible();
    } finally {
      await context.close();
      server.stop();
    }
  },
  { timeout: 30000 },
);
