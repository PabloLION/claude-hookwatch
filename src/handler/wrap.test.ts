/**
 * Tests for src/handler/wrap.ts
 *
 * Coverage:
 * - runWrapped: stdin is passed to child and returned as stdinContent
 * - runWrapped: child stdout/stderr are teed to process streams and captured
 * - runWrapped: child exit code is forwarded correctly (0, 1, 2, 3)
 * - runWrapped: non-existent command returns exit 1 with empty capture
 *
 * Strategy: a small fixture script (wrap-runner.fixture.ts) calls runWrapped()
 * and writes the WrapResult as JSON to stderr (WRAP_RESULT: prefix). Tests
 * spawn the fixture as a subprocess and parse the result from stderr.
 * This approach avoids polluting the test process's own streams.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Fixture runner
// ---------------------------------------------------------------------------

const WRAP_RUNNER_PATH = join(import.meta.dir, "wrap-runner.fixture.ts");

interface WrapResult {
  exitCode: number;
  stdinContent: string;
  capturedStdout: string;
  capturedStderr: string;
}

interface RunnerOutput {
  /** Exit code of the fixture runner process (mirrors child exit code) */
  runnerExitCode: number | null;
  /** Child's tee'd stdout (pass-through from child via teeStream) */
  runnerStdout: string;
  /** Parsed WrapResult from the WRAP_RESULT: stderr line */
  wrapResult: WrapResult | null;
  /** Non-result stderr lines (child's tee'd stderr + any errors) */
  runnerStderr: string;
}

/**
 * Spawns the wrap runner fixture with the given child command and stdin input.
 * Returns the combined output plus the parsed WrapResult from stderr.
 */
async function runWrapRunner(
  childCmd: string[],
  stdinInput = "",
  timeoutMs = 5000,
): Promise<RunnerOutput> {
  const proc = Bun.spawn(["bun", "--bun", WRAP_RUNNER_PATH, ...childCmd], {
    stdin: new TextEncoder().encode(stdinInput),
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutHandle = setTimeout(() => proc.kill(), timeoutMs);

  const [runnerExitCode, runnerStdout, stderrRaw] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timeoutHandle);

  // Extract WRAP_RESULT line from stderr
  const lines = stderrRaw.split("\n");
  const resultLine = lines.find((l) => l.startsWith("WRAP_RESULT:"));
  let wrapResult: WrapResult | null = null;
  if (resultLine) {
    try {
      wrapResult = JSON.parse(resultLine.slice("WRAP_RESULT:".length)) as WrapResult;
    } catch {
      // parse failure — wrapResult stays null
    }
  }

  const runnerStderr = lines.filter((l) => !l.startsWith("WRAP_RESULT:")).join("\n");

  return { runnerExitCode, runnerStdout, wrapResult, runnerStderr };
}

// ---------------------------------------------------------------------------
// Tests: tee and capture
// ---------------------------------------------------------------------------

describe("runWrapped — tee and capture", () => {
  test("child stdout is passed through to runner stdout and captured", async () => {
    const result = await runWrapRunner(["sh", "-c", "echo hello"], "event-json");

    expect(result.wrapResult).not.toBeNull();
    expect(result.wrapResult?.capturedStdout.trim()).toBe("hello");
    // Tee: the child's stdout also appears as the runner's own stdout
    expect(result.runnerStdout.trim()).toBe("hello");
  });

  test("child stderr is passed through to runner stderr and captured", async () => {
    const result = await runWrapRunner(["sh", "-c", "echo error-msg >&2"], "event-json");

    expect(result.wrapResult).not.toBeNull();
    expect(result.wrapResult?.capturedStderr.trim()).toBe("error-msg");
    // Tee: child stderr appears in the runner's stderr output
    expect(result.runnerStderr).toContain("error-msg");
  });

  test("stdin input is read into stdinContent and forwarded to child", async () => {
    const stdinInput = '{"hook_event_name":"SessionStart"}';
    const result = await runWrapRunner(["sh", "-c", "cat"], stdinInput);

    expect(result.wrapResult).not.toBeNull();
    // stdinContent should match what we sent
    expect(result.wrapResult?.stdinContent).toBe(stdinInput);
    // The child (cat) echoes stdin to stdout — captured and tee'd
    expect(result.wrapResult?.capturedStdout).toBe(stdinInput);
    expect(result.runnerStdout).toBe(stdinInput);
  });

  test("captures both stdout and stderr in a single run", async () => {
    const result = await runWrapRunner(
      ["sh", "-c", "echo out-line; echo err-line >&2"],
      "stdin-data",
    );

    expect(result.wrapResult?.capturedStdout.trim()).toBe("out-line");
    expect(result.wrapResult?.capturedStderr.trim()).toBe("err-line");
  });
});

// ---------------------------------------------------------------------------
// Tests: exit code forwarding
// ---------------------------------------------------------------------------

describe("runWrapped — exit code forwarding", () => {
  test("forwards exit code 0", async () => {
    const result = await runWrapRunner(["sh", "-c", "exit 0"], "");

    expect(result.runnerExitCode).toBe(0);
    expect(result.wrapResult?.exitCode).toBe(0);
  });

  test("forwards non-zero exit code (1)", async () => {
    const result = await runWrapRunner(["sh", "-c", "exit 1"], "");

    expect(result.runnerExitCode).toBe(1);
    expect(result.wrapResult?.exitCode).toBe(1);
  });

  test("forwards exit code 2 (block action in Claude Code hooks)", async () => {
    const result = await runWrapRunner(["sh", "-c", "exit 2"], "");

    expect(result.runnerExitCode).toBe(2);
    expect(result.wrapResult?.exitCode).toBe(2);
  });

  test("forwards arbitrary non-zero exit code (3)", async () => {
    const result = await runWrapRunner(["sh", "-c", "exit 3"], "");

    expect(result.runnerExitCode).toBe(3);
    expect(result.wrapResult?.exitCode).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: error cases
// ---------------------------------------------------------------------------

describe("runWrapped — error handling", () => {
  test("returns exit 1 for non-existent command", async () => {
    const result = await runWrapRunner(["/nonexistent-binary-that-does-not-exist"], "");

    // runWrapped catches spawn failure and returns exitCode 1
    expect(result.wrapResult?.exitCode).toBe(1);
    expect(result.wrapResult?.capturedStdout).toBe("");
    expect(result.wrapResult?.capturedStderr).toBe("");
  });
});
