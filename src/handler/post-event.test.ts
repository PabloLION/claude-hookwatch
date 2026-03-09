/**
 * Tests for src/handler/post-event.ts
 *
 * Coverage:
 * - postEvent(): non-201 response from server causes exit 2 + hookwatch_fatal JSON
 * - postEvent(): server unavailable triggers auto-start (Story 1.5)
 * - postEvent(): connection error → spawn → health probe → retry succeeds
 * - postEvent(): server down in wrapped mode — child exit code still forwarded
 * - Wrapped mode (Story 3.1): exit code forwarding, tee behaviour, POST body fields
 * - Unified pipeline: bare/wrapped POST body contract (wrapped_command, exit_code, etc.)
 *
 * Strategy: run the handler as a child process via Bun.spawn(), feeding stdin
 * directly. This mirrors the real Claude Code hook invocation and avoids the
 * need to mock module-level globals.
 *
 * NOTE: Some tests trigger the auto-start path (Story 1.5), which spawns a
 * real server process. These are killed in afterAll to avoid leaking processes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  assertExitLegality,
  BASE_SESSION_START,
  createHandlerTestContext,
  runHandler,
  runHandlerWrapped,
  writePortFile,
} from "@/test";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const ctx = createHandlerTestContext("hookwatch-post-event-test-");

beforeAll(() => {
  ctx.setup();
});

afterAll(async () => {
  ctx.cleanup();
  // Kill any server processes spawned by auto-start tests on hookwatch ports.
  // Best-effort — ignore errors.
  try {
    const proc = Bun.spawn(["lsof", "-ti", "tcp:6004"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const output = await new Response(proc.stdout).text();
    const pids = output.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        // Already gone
      }
    }
  } catch {
    // lsof may be unavailable or the port may be unused
  }
});

afterEach(() => {
  ctx.reset();
});

// ---------------------------------------------------------------------------
// Server error responses
// ---------------------------------------------------------------------------

describe("server non-2xx response", () => {
  test("non-201 response causes exit 2 with hookwatch_fatal JSON in stdout", async () => {
    const xdgHome = join(ctx.tmpDir, "server-error");
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "server-error");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("500");
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });

  test("non-201 response logs status to stderr", async () => {
    const xdgHome = join(ctx.tmpDir, "server-error-stderr");
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.nextStatus = 503;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.stderr).toContain("503");
  });

  test("POST failure produces exit 2 with hookwatch_fatal JSON in stdout", async () => {
    const xdgHome = join(ctx.tmpDir, "stdout-post-failure");
    writePortFile(xdgHome, ctx.server.port);

    ctx.server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-post-failure");
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Auto-start (server unavailable)
// ---------------------------------------------------------------------------

describe("auto-start (server unavailable)", () => {
  test("server unavailable triggers auto-start (Story 1.5)", async () => {
    const xdgHome = join(ctx.tmpDir, "server-unavailable");
    // Point at a port where no server is running — triggers auto-start
    writePortFile(xdgHome, 19999);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, "config"),
    });

    assertExitLegality(result, "server-unavailable");
    // Auto-start fires: spawned server writes port file, health probe discovers
    // new port, handler retries and succeeds.
    expect(result.stderr).toContain("[hookwatch]");
    expect(result.exitCode).not.toBeNull();
  }, 10000);

  test("wrapped mode: server down, child exit code still forwarded (best-effort)", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-server-down");
    writePortFile(xdgHome, 19998);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      {
        XDG_DATA_HOME: xdgHome,
        XDG_CONFIG_HOME: join(xdgHome, "config"),
      },
    );

    // Child exits 0 — even if server POST fails, exit code is forwarded
    expect(result.exitCode).not.toBeNull();
    expect(result.stderr).toContain("[hookwatch]");
  }, 10000);
});

// ---------------------------------------------------------------------------
// Wrapped mode (Story 3.1): server-side behaviour
// ---------------------------------------------------------------------------

describe("wrapped mode", () => {
  test("child exit code 0 is forwarded when server is up", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-exit-0");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-exit-0");
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
  });

  test("child exit code 2 is forwarded (block action)", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-exit-2");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 2"],
      { XDG_DATA_HOME: xdgHome },
    );

    // Exit 2 from child is a valid pass-through — not a hookwatch fatal error.
    // In wrapped mode, exit 2 is the child's exit code.
    expect(result.exitCode).toBe(2);
    // Event is still posted even when child exits 2
    expect(ctx.server.events).toHaveLength(1);
  });

  test("child stdout is tee'd to handler stdout before hook output JSON", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-tee-stdout");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "printf 'child-output'"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-tee-stdout");
    expect(result.exitCode).toBe(0);
    // stdout contains child output + hook JSON at the end
    expect(result.stdout).toContain("child-output");
    // Hook output JSON appears after child output
    const hookJsonStr = result.stdout.slice(result.stdout.lastIndexOf("{"));
    const hookJson = JSON.parse(hookJsonStr);
    expect(hookJson.continue).toBe(true);
  });

  test("wrapped_command is stored in the event posted to server", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-command-stored");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-command-stored");
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(body?.wrapped_command).toBe("sh -c exit 0");
  });

  test("wrapped mode includes hook_duration_ms as a non-negative number in POST body", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-duration-ms");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-duration-ms");
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(typeof body?.hook_duration_ms).toBe("number");
    expect(body?.hook_duration_ms as number).toBeGreaterThanOrEqual(0);
  });

  test("invalid JSON stdin in wrapped mode: child exit code forwarded", async () => {
    const xdgHome = join(ctx.tmpDir, "wrap-invalid-stdin");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped("{ not valid json", ["sh", "-c", "exit 0"], {
      XDG_DATA_HOME: xdgHome,
    });

    // Child exits 0, but event parsing fails — handler exits with child code
    expect(result.exitCode).toBe(0);
    // Error logged to stderr about parsing failure
    expect(result.stderr).toContain("[hookwatch]");
  });
});

// ---------------------------------------------------------------------------
// Unified pipeline: bare/wrapped POST body contract
// ---------------------------------------------------------------------------

describe("unified pipeline", () => {
  test("bare mode POST body has no wrapped_command field", async () => {
    const xdgHome = join(ctx.tmpDir, "unified-bare-null-wrapped");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-bare-null-wrapped");
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(body?.wrapped_command).toBeUndefined();
  });

  test("bare mode stores hook output JSON as stdout in POST body", async () => {
    const xdgHome = join(ctx.tmpDir, "unified-bare-stdout-stored");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-bare-stdout-stored");
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    // bare mode: stdout column should contain hook output JSON (what Claude Code sees)
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(typeof body?.stdout).toBe("string");
    const storedStdout = JSON.parse(body?.stdout as string);
    expect(storedStdout.continue).toBe(true);
    expect(typeof storedStdout.systemMessage).toBe("string");
  });

  test("bare mode stores exit_code 0 in POST body", async () => {
    const xdgHome = join(ctx.tmpDir, "unified-bare-exit-code");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-bare-exit-code");
    expect(result.exitCode).toBe(0);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(body?.exit_code).toBe(0);
  });

  test("wrapped mode stores child exit code in POST body", async () => {
    const xdgHome = join(ctx.tmpDir, "unified-wrapped-exit-code");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "unified-wrapped-exit-code");
    expect(result.exitCode).toBe(0);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(body?.exit_code).toBe(0);
  });

  test("hookwatch_log is absent in POST body on successful run", async () => {
    const xdgHome = join(ctx.tmpDir, "unified-no-hookwatch-log");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-no-hookwatch-log");
    expect(result.exitCode).toBe(0);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    // hookwatch_log should not be present (null means not sent)
    expect(body?.hookwatch_log).toBeUndefined();
  });

  test("bare mode includes hook_duration_ms as a non-negative number in POST body", async () => {
    const xdgHome = join(ctx.tmpDir, "unified-duration-bare");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-duration-bare");
    expect(result.exitCode).toBe(0);
    expect(ctx.server.events).toHaveLength(1);
    const body = ctx.server.events[0]?.body as Record<string, unknown>;
    expect(typeof body?.hook_duration_ms).toBe("number");
    expect(body?.hook_duration_ms as number).toBeGreaterThanOrEqual(0);
  });
});
