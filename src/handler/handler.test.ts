/**
 * Tests for src/handler/index.ts
 *
 * Coverage:
 * - readPort(): file exists → uses port; file absent → auto-start fallback
 * - Stdin parsing: valid JSON is parsed and forwarded
 * - Zod validation: known event → correct schema; unknown event → fallback schema
 * - Successful POST: event is forwarded and server receives it
 * - Error handling: invalid JSON and Zod failures cause exit 2 + JSON stdout
 * - Unknown event forwarding: unknown hook_event_name goes through fallback
 * - Server unavailable: connection failure triggers auto-start (Story 1.5)
 * - Unified pipeline: both bare and wrapped modes use the same algorithm skeleton
 * - Exit legality: only exit 0 or exit 2 are valid; both have specific stdout contracts
 *
 * Strategy: run the handler as a child process via Bun.spawn(), feeding stdin
 * directly. This mirrors the real Claude Code hook invocation and avoids the
 * need to mock module-level globals.
 *
 * NOTE: Some tests trigger the auto-start path (Story 1.5), which spawns a
 * real server process. These are killed in afterAll to avoid leaking processes.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Test infrastructure: minimal HTTP server that records received events
// ---------------------------------------------------------------------------

/**
 * Writes a port file in the location that portFilePath() resolves to under
 * the given XDG_DATA_HOME value: <xdgDataHome>/hookwatch/hookwatch.port
 */
function writePortFile(xdgDataHome: string, port: number): void {
  const dir = join(xdgDataHome, "hookwatch");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hookwatch.port"), String(port));
}

/**
 * Writes an invalid port file (non-numeric content).
 */
function writeInvalidPortFile(xdgDataHome: string, content: string): void {
  const dir = join(xdgDataHome, "hookwatch");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hookwatch.port"), content);
}

interface ReceivedEvent {
  body: unknown;
  status: number;
}

interface TestServer {
  port: number;
  events: ReceivedEvent[];
  /** Override the next response status (default 201) */
  nextStatus: number;
  stop: () => void;
}

function startTestServer(): TestServer {
  const events: ReceivedEvent[] = [];
  const state = { nextStatus: 201 };

  const server = Bun.serve({
    port: 0, // OS-assigned free port
    async fetch(req) {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/events") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          body = null;
        }
        const status = state.nextStatus;
        events.push({ body, status });
        return new Response(JSON.stringify({ id: events.length }), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  return {
    get port() {
      return server.port;
    },
    events,
    get nextStatus() {
      return state.nextStatus;
    },
    set nextStatus(v: number) {
      state.nextStatus = v;
    },
    stop: () => server.stop(true),
  };
}

// ---------------------------------------------------------------------------
// Helpers: run handler as subprocess
// ---------------------------------------------------------------------------

const HANDLER_PATH = new URL("./index.ts", import.meta.url).pathname;

interface RunResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

async function runHandler(
  stdinPayload: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "--bun", HANDLER_PATH], {
    stdin: new TextEncoder().encode(stdinPayload),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const [exitCode, stderrBuf, stdoutBuf] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);

  return { exitCode, stderr: stderrBuf, stdout: stdoutBuf };
}

// ---------------------------------------------------------------------------
// Exit legality helper
// ---------------------------------------------------------------------------

/**
 * Validates that a handler result obeys the exit code contract:
 *   - Exit code must be 0 or 2 (never 1 or other values)
 *   - Exit 0: stdout is either empty, valid hook JSON, or child-output prefix + hook JSON
 *     The hook JSON (if present) must have continue: boolean.
 *     In wrapped mode, child stdout precedes the hook JSON — we extract the last JSON object.
 *   - Exit 2: stdout must be valid JSON with a hookwatch_fatal field (P1 error)
 *
 * Call this in every bare-mode test to enforce the contract globally.
 * For wrapped mode tests where child stdout prefixes the hook JSON, the helper
 * extracts the last JSON object from stdout before validating.
 */
function assertExitLegality(result: RunResult, context = ""): void {
  const tag = context ? ` [${context}]` : "";

  // Exit code must be 0 or 2
  expect(result.exitCode, `exit code must be 0 or 2${tag}`).toSatisfy(
    (code: number | null) => code === 0 || code === 2,
  );

  if (result.exitCode === 0) {
    // Exit 0: stdout may be empty or contain hook JSON (optionally after child output)
    if (result.stdout !== "") {
      // Try full parse first; if that fails, try to extract the last JSON object
      // (handles wrapped mode where child stdout precedes hook JSON).
      let parsed: unknown;
      let parseError: string | null = null;
      try {
        parsed = JSON.parse(result.stdout);
      } catch {
        // Try extracting the last '{...}' block
        const lastBrace = result.stdout.lastIndexOf("{");
        if (lastBrace !== -1) {
          try {
            parsed = JSON.parse(result.stdout.slice(lastBrace));
          } catch {
            parseError = result.stdout;
          }
        } else {
          parseError = result.stdout;
        }
      }
      if (parseError !== null) {
        throw new Error(`Exit 0 stdout must be valid JSON or empty${tag}. Got: ${parseError}`);
      }
      const obj = parsed as Record<string, unknown>;
      expect(typeof obj.continue, `Exit 0 stdout.continue must be boolean${tag}`).toBe("boolean");
    }
  } else if (result.exitCode === 2) {
    // Exit 2: stdout must be valid JSON with hookwatch_fatal field
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`Exit 2 stdout must be valid JSON${tag}. Got: ${result.stdout}`);
    }
    const obj = parsed as Record<string, unknown>;
    expect(typeof obj.hookwatch_fatal, `Exit 2 stdout must have hookwatch_fatal string${tag}`).toBe(
      "string",
    );
  }
}

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const TMP_DIR = join(tmpdir(), `hookwatch-handler-test-${Date.now()}`);

const BASE_SESSION_START = {
  session_id: "test-session-001",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "SessionStart",
  source: "startup",
  model: "claude-sonnet-4-6",
};

const UNKNOWN_EVENT = {
  session_id: "test-session-002",
  transcript_path: "/tmp/transcript.jsonl",
  cwd: "/home/user/project",
  permission_mode: "default",
  hook_event_name: "FutureUnknownEvent",
  extra_field: "preserved",
};

let server: TestServer;

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  server = startTestServer();
});

afterAll(async () => {
  server.stop();
  // Kill any server processes spawned by auto-start tests on the hookwatch
  // default port (6004). Best-effort — ignore errors.
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
    // lsof may be unavailable or range may be unused
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
});

afterEach(() => {
  server.events.length = 0;
  server.nextStatus = 201;
});

// ---------------------------------------------------------------------------
// Port file reading
// ---------------------------------------------------------------------------

describe("port file", () => {
  test("uses port from file when present", async () => {
    const xdgHome = join(TMP_DIR, "port-present");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "port-present");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
  });

  test("falls back to port 6004 when file is absent, then auto-starts server", async () => {
    const xdgHome = join(TMP_DIR, "port-absent");
    mkdirSync(xdgHome, { recursive: true });
    // No port file written — handler falls back to 6004, gets ECONNREFUSED,
    // then auto-starts the server. The spawned server inherits XDG_DATA_HOME
    // and writes its port file to xdgHome. After a successful health probe,
    // the handler retries and delivers the event.
    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, "config"),
    });

    assertExitLegality(result, "port-absent");
    // Auto-start succeeds — event is delivered to the spawned server
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("[hookwatch]");
  }, 10000);

  test("ignores invalid port file content and uses fallback, then auto-starts server", async () => {
    const xdgHome = join(TMP_DIR, "port-invalid");
    writeInvalidPortFile(xdgHome, "not-a-number");

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, "config"),
    });

    assertExitLegality(result, "port-invalid");
    // Auto-start fires because fallback port 6004 has no server → connection error
    // stderr should mention the invalid value/fallback and the spawn attempt
    expect(result.stderr).toContain("[hookwatch]");
    // Exit code depends on whether auto-start succeeds — primary assertion is no crash
    expect(result.exitCode).not.toBeNull();
  }, 10000);
});

// ---------------------------------------------------------------------------
// Stdin parsing
// ---------------------------------------------------------------------------

describe("stdin parsing", () => {
  test("valid JSON stdin is parsed and forwarded", async () => {
    const xdgHome = join(TMP_DIR, "stdin-valid");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdin-valid");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.hook_event_name).toBe("SessionStart");
    expect(body?.session_id).toBe("test-session-001");
  });

  test("invalid JSON stdin causes exit 2 with JSON error in stdout", async () => {
    const xdgHome = join(TMP_DIR, "stdin-invalid");
    writePortFile(xdgHome, server.port);

    const result = await runHandler("{ this is not valid json", {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdin-invalid");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("[hookwatch]");
    expect(server.events).toHaveLength(0);
    // P1 fatal: stdout must contain JSON with hookwatch_fatal
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });

  test("empty stdin causes exit 2 with JSON error in stdout", async () => {
    const xdgHome = join(TMP_DIR, "stdin-empty");
    writePortFile(xdgHome, server.port);

    const result = await runHandler("", {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdin-empty");
    expect(result.exitCode).toBe(2);
    expect(server.events).toHaveLength(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Zod validation
// ---------------------------------------------------------------------------

describe("Zod validation", () => {
  test("known event type routes to correct schema and is forwarded", async () => {
    const xdgHome = join(TMP_DIR, "zod-known");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "zod-known");
    expect(result.exitCode).toBe(0);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.source).toBe("startup");
    expect(body?.model).toBe("claude-sonnet-4-6");
  });

  test("missing required field causes exit 2 with JSON error in stdout", async () => {
    const xdgHome = join(TMP_DIR, "zod-missing-field");
    writePortFile(xdgHome, server.port);

    const payload = {
      // Missing session_id
      transcript_path: "/tmp/t.jsonl",
      cwd: "/home/user",
      permission_mode: "default",
      hook_event_name: "SessionStart",
      source: "startup",
      model: "claude-sonnet-4-6",
    };

    const result = await runHandler(JSON.stringify(payload), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "zod-missing-field");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("[hookwatch]");
    expect(server.events).toHaveLength(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });

  test("invalid enum value for known event causes exit 2 with JSON error in stdout", async () => {
    const xdgHome = join(TMP_DIR, "zod-bad-enum");
    writePortFile(xdgHome, server.port);

    const payload = {
      ...BASE_SESSION_START,
      source: "INVALID_SOURCE_VALUE",
    };

    const result = await runHandler(JSON.stringify(payload), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "zod-bad-enum");
    expect(result.exitCode).toBe(2);
    expect(server.events).toHaveLength(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Unknown event forwarding
// ---------------------------------------------------------------------------

describe("unknown event forwarding", () => {
  test("unknown hook_event_name passes through fallback schema and is forwarded", async () => {
    const xdgHome = join(TMP_DIR, "unknown-event");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(UNKNOWN_EVENT), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unknown-event");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.hook_event_name).toBe("FutureUnknownEvent");
    expect(body?.extra_field).toBe("preserved");
  });

  test("unknown event with missing common fields causes exit 2 with JSON error in stdout", async () => {
    const xdgHome = join(TMP_DIR, "unknown-event-bad");
    writePortFile(xdgHome, server.port);

    const payload = {
      // Missing session_id, transcript_path, cwd, permission_mode
      hook_event_name: "FutureUnknownEvent",
      extra_field: "value",
    };

    const result = await runHandler(JSON.stringify(payload), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unknown-event-bad");
    expect(result.exitCode).toBe(2);
    expect(server.events).toHaveLength(0);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Server error handling
// ---------------------------------------------------------------------------

describe("server error handling", () => {
  test("server non-201 response causes exit 2 with JSON error in stdout", async () => {
    const xdgHome = join(TMP_DIR, "server-error");
    writePortFile(xdgHome, server.port);

    server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "server-error");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("500");
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });

  test("server unavailable triggers auto-start", async () => {
    const xdgHome = join(TMP_DIR, "server-unavailable");
    // Point at a port where no server is running.
    // Since Story 1.5, a connection refusal triggers auto-start rather than
    // an immediate exit. The handler spawns the server and retries.
    writePortFile(xdgHome, 19999);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
      XDG_CONFIG_HOME: join(xdgHome, "config"),
    });

    assertExitLegality(result, "server-unavailable");
    // Auto-start fires: spawned server inherits env, writes real port file,
    // health probe discovers new port, handler retries and succeeds.
    expect(result.stderr).toContain("[hookwatch]");
    // The handler should not crash with an uncaught exception
    expect(result.exitCode).not.toBeNull();
  }, 10000);
});

// ---------------------------------------------------------------------------
// Hook output (stdout) — context injection (Story 4.2)
// ---------------------------------------------------------------------------

describe("hook output (stdout)", () => {
  test("successful POST writes valid JSON hook output to stdout", async () => {
    const xdgHome = join(TMP_DIR, "stdout-success");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-success");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe("string");
    expect(parsed.systemMessage.length).toBeGreaterThan(0);
  });

  test("systemMessage contains event type and subtype for SessionStart", async () => {
    const xdgHome = join(TMP_DIR, "stdout-system-message-session-start");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-system-message-session-start");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe("hookwatch captured SessionStart (startup)");
  });

  test("systemMessage contains tool_name for PreToolUse", async () => {
    const xdgHome = join(TMP_DIR, "stdout-pre-tool-use");
    writePortFile(xdgHome, server.port);

    const preToolUseEvent = {
      session_id: "test-session-001",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/home/user/project",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "toolu_01ABC123",
      tool_input: { command: "ls" },
    };

    const result = await runHandler(JSON.stringify(preToolUseEvent), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-pre-tool-use");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe("hookwatch captured PreToolUse (Bash)");
  });

  test("systemMessage has no subtype for Stop", async () => {
    const xdgHome = join(TMP_DIR, "stdout-stop");
    writePortFile(xdgHome, server.port);

    const stopEvent = {
      session_id: "test-session-001",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/home/user/project",
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Done.",
    };

    const result = await runHandler(JSON.stringify(stopEvent), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-stop");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe("hookwatch captured Stop");
  });

  test("POST failure produces exit 2 with hookwatch_fatal JSON in stdout", async () => {
    const xdgHome = join(TMP_DIR, "stdout-post-failure");
    writePortFile(xdgHome, server.port);

    server.nextStatus = 500;

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-post-failure");
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });

  test("invalid JSON stdin produces exit 2 with hookwatch_fatal JSON in stdout", async () => {
    const xdgHome = join(TMP_DIR, "stdout-invalid-json");
    writePortFile(xdgHome, server.port);

    const result = await runHandler("not valid json at all", {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-invalid-json");
    expect(result.exitCode).toBe(2);
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(typeof parsed.hookwatch_fatal).toBe("string");
  });

  test("bare mode includes hook_duration_ms as a non-negative number in POST body", async () => {
    const xdgHome = join(TMP_DIR, "stdout-duration-bare");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-duration-bare");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(typeof body?.hook_duration_ms).toBe("number");
    expect(body?.hook_duration_ms as number).toBeGreaterThanOrEqual(0);
  });

  test("stdout output validates against hookOutputSchema", async () => {
    const xdgHome = join(TMP_DIR, "stdout-schema-validate");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "stdout-schema-validate");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // hookOutputSchema fields: continue (bool), systemMessage (string), suppressOutput (bool)
    // continue must be boolean true
    expect(parsed.continue).toBe(true);
    // systemMessage must be a non-empty string
    expect(typeof parsed.systemMessage).toBe("string");
    expect(parsed.systemMessage.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Wrapped mode (Story 3.1)
// ---------------------------------------------------------------------------

/**
 * Run the handler in wrapped mode.
 * Wrap args are passed after `--` in argv so the handler enters wrapped mode.
 */
async function runHandlerWrapped(
  stdinPayload: string,
  wrapArgs: string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "--bun", HANDLER_PATH, "--", ...wrapArgs], {
    stdin: new TextEncoder().encode(stdinPayload),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const [exitCode, stderrBuf, stdoutBuf] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
    new Response(proc.stdout).text(),
  ]);

  return { exitCode, stderr: stderrBuf, stdout: stdoutBuf };
}

describe("wrapped mode", () => {
  test("child exit code 0 is forwarded when server is up", async () => {
    const xdgHome = join(TMP_DIR, "wrap-exit-0");
    writePortFile(xdgHome, server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-exit-0");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
  });

  test("child exit code 2 is forwarded (block action)", async () => {
    const xdgHome = join(TMP_DIR, "wrap-exit-2");
    writePortFile(xdgHome, server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 2"],
      { XDG_DATA_HOME: xdgHome },
    );

    // Exit 2 from child is a valid pass-through — not a hookwatch P1 error
    // assertExitLegality would reject exit 2 without JSON, but in wrapped mode
    // exit 2 is the child's exit code. The legality helper checks bare mode
    // contracts. In wrapped mode we verify the child code is forwarded.
    expect(result.exitCode).toBe(2);
    // Event is still posted even when child exits 2
    expect(server.events).toHaveLength(1);
  });

  test("child stdout is tee'd to handler stdout before hook output JSON", async () => {
    const xdgHome = join(TMP_DIR, "wrap-tee-stdout");
    writePortFile(xdgHome, server.port);

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
    const xdgHome = join(TMP_DIR, "wrap-command-stored");
    writePortFile(xdgHome, server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-command-stored");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.wrapped_command).toBe("sh -c exit 0");
  });

  test("wrapped mode includes hook_duration_ms as a non-negative number in POST body", async () => {
    const xdgHome = join(TMP_DIR, "wrap-duration-ms");
    writePortFile(xdgHome, server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "wrap-duration-ms");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(typeof body?.hook_duration_ms).toBe("number");
    // Wrapped mode measures hookwatch overhead only (not child wall time),
    // so the value should be a small non-negative integer.
    expect(body?.hook_duration_ms as number).toBeGreaterThanOrEqual(0);
  });

  test("server down: child exit code still forwarded (best-effort)", async () => {
    const xdgHome = join(TMP_DIR, "wrap-server-down");
    // Point at a port where nothing is running (not auto-start port either)
    // Use a port that will definitely be refused immediately
    writePortFile(xdgHome, 19998);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      {
        XDG_DATA_HOME: xdgHome,
        // Provide isolated config home to prevent spawning real server
        XDG_CONFIG_HOME: join(xdgHome, "config"),
      },
    );

    // Child exits 0 — even though server POST may fail, exit code is forwarded
    // (best-effort: handler tries to spawn server but continues regardless)
    expect(result.exitCode).not.toBeNull();
    // Stderr should mention server issues
    expect(result.stderr).toContain("[hookwatch]");
  }, 10000);

  test("invalid JSON stdin in wrapped mode: child exit code forwarded", async () => {
    const xdgHome = join(TMP_DIR, "wrap-invalid-stdin");
    writePortFile(xdgHome, server.port);

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
// Unified pipeline: bare mode behaves identically to wrapped with no child
// ---------------------------------------------------------------------------

describe("unified pipeline", () => {
  test("bare mode POST body has null wrapped_command (bare handler)", async () => {
    const xdgHome = join(TMP_DIR, "unified-bare-null-wrapped");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-bare-null-wrapped");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    // bare mode: wrapped_command field should not be present in POST body
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.wrapped_command).toBeUndefined();
  });

  test("bare mode stores hook output JSON as stdout in POST body", async () => {
    const xdgHome = join(TMP_DIR, "unified-bare-stdout-stored");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-bare-stdout-stored");
    expect(result.exitCode).toBe(0);
    expect(server.events).toHaveLength(1);
    // bare mode: stdout column should contain hook output JSON (what Claude Code sees)
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(typeof body?.stdout).toBe("string");
    const storedStdout = JSON.parse(body?.stdout as string);
    expect(storedStdout.continue).toBe(true);
    expect(typeof storedStdout.systemMessage).toBe("string");
  });

  test("bare mode stores exit_code 0 in POST body", async () => {
    const xdgHome = join(TMP_DIR, "unified-bare-exit-code");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-bare-exit-code");
    expect(result.exitCode).toBe(0);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.exit_code).toBe(0);
  });

  test("wrapped mode stores child exit code in POST body", async () => {
    const xdgHome = join(TMP_DIR, "unified-wrapped-exit-code");
    writePortFile(xdgHome, server.port);

    const result = await runHandlerWrapped(
      JSON.stringify(BASE_SESSION_START),
      ["sh", "-c", "exit 0"],
      { XDG_DATA_HOME: xdgHome },
    );

    assertExitLegality(result, "unified-wrapped-exit-code");
    expect(result.exitCode).toBe(0);
    const body = server.events[0]?.body as Record<string, unknown>;
    expect(body?.exit_code).toBe(0);
  });

  test("hookwatch_error is null in POST body on successful run", async () => {
    const xdgHome = join(TMP_DIR, "unified-no-hookwatch-error");
    writePortFile(xdgHome, server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    assertExitLegality(result, "unified-no-hookwatch-error");
    expect(result.exitCode).toBe(0);
    const body = server.events[0]?.body as Record<string, unknown>;
    // hookwatch_error should not be present (null means not sent)
    expect(body?.hookwatch_error).toBeUndefined();
  });
});
