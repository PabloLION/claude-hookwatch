/**
 * Shared subprocess helpers for hookwatch tests.
 *
 * Decision: runHandler() and runWrapRunner() are kept as two separate
 * exports rather than unified into one generic function. The divergence
 * points are significant enough to make unification more confusing than
 * helpful:
 *   - runHandler: no timeout, extra-args extend argv (wrap mode via --),
 *     env overlay only.
 *   - runWrapRunner: mandatory timeout + proc.kill() guard, WRAP_RESULT
 *     parsing from stderr, separate RunnerOutput type (not RunResult).
 *
 * Both are built on a shared runSubprocess() primitive that handles the
 * common Bun.spawn pattern.
 */

import { join } from 'node:path';
import { DEFAULT_PORT } from '@/config.ts';

import type { WrapResult } from '@/types.ts';

export type { WrapResult } from '@/types.ts';

/** Milliseconds to wait after SIGTERM before assuming the process has exited. */
const KILL_WAIT_MS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface RunnerOutput {
  /** Exit code of the fixture runner process (mirrors child exit code). */
  runnerExitCode: number | null;
  /** Child's tee'd stdout (pass-through from child via teeStream). */
  runnerStdout: string;
  /** Parsed WrapResult from the WRAP_RESULT: stderr line. */
  wrapResult: WrapResult | null;
  /** Non-result stderr lines (child's tee'd stderr + any errors). */
  runnerStderr: string;
}

// ---------------------------------------------------------------------------
// Process cleanup
// ---------------------------------------------------------------------------

/**
 * Kills any server process listening on the given port.
 * Best-effort: ignores errors (lsof unavailable, port already unused, etc.).
 *
 * Used in afterAll blocks to clean up auto-started hookwatch server processes
 * that survive past individual tests. Always call this BEFORE removing temp
 * directories so the server is not still referencing files being deleted.
 *
 * Default port is DEFAULT_PORT (6004).
 */
export async function killProcessOnPort(port: number = DEFAULT_PORT): Promise<void> {
  try {
    const proc = Bun.spawn(['lsof', '-ti', `tcp:${port}`], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const output = await new Response(proc.stdout).text();
    const pids = output.trim().split('\n').filter(Boolean);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        // Process may already be gone
      }
    }
    // Give the process a moment to terminate
    if (pids.length > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, KILL_WAIT_MS));
    }
  } catch {
    // lsof may not be available or port may be unused
  }
}

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

/** Parse handler subprocess stdout as a JSON record. */
export function parseStdout(stdout: string): Record<string, unknown> {
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (err) {
    const preview = stdout.length > 200 ? `${stdout.slice(0, 200)}…` : stdout;
    throw new Error(`Failed to parse handler stdout as JSON: ${preview}`, { cause: err });
  }
}

// ---------------------------------------------------------------------------
// Shared primitive
// ---------------------------------------------------------------------------

/**
 * Generic subprocess runner: spawns `bun --bun <scriptPath> [...extraArgs]`
 * with the given stdin payload and env overlay.
 *
 * This is the shared primitive. Prefer the higher-level runHandler() or
 * runWrapRunner() in tests; use runSubprocess() directly only when you need
 * a custom subprocess shape.
 */
export async function runSubprocess(
  scriptPath: string,
  stdinPayload: string,
  env: Record<string, string> = {},
  extraArgs: string[] = [],
): Promise<RunResult> {
  const proc = Bun.spawn(['bun', '--bun', scriptPath, ...extraArgs], {
    stdin: new TextEncoder().encode(stdinPayload),
    stdout: 'pipe',
    stderr: 'pipe',
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
// runHandler — bare mode
// ---------------------------------------------------------------------------

const HANDLER_PATH = new URL('../handler/index.ts', import.meta.url).pathname;

/**
 * Runs the hookwatch handler in bare mode (no wrapped command).
 *
 * Equivalent to the handler subprocess pattern in handler.test.ts and
 * post-event.test.ts. Feeds stdinPayload as stdin and returns
 * exitCode, stdout, stderr.
 */
export async function runHandler(
  stdinPayload: string,
  env: Record<string, string> = {},
): Promise<RunResult> {
  return runSubprocess(HANDLER_PATH, stdinPayload, env);
}

/**
 * Runs the hookwatch handler in wrapped mode.
 * Wrap args are appended after `--` in argv so the handler enters wrapped mode.
 */
export async function runHandlerWrapped(
  stdinPayload: string,
  wrapArgs: string[],
  env: Record<string, string> = {},
): Promise<RunResult> {
  return runSubprocess(HANDLER_PATH, stdinPayload, env, ['--', ...wrapArgs]);
}

// ---------------------------------------------------------------------------
// runWrapRunner — wrap fixture runner
// ---------------------------------------------------------------------------

const WRAP_RUNNER_PATH = join(
  new URL('../handler', import.meta.url).pathname,
  'wrap-runner.fixture.ts',
);

/**
 * Spawns the wrap runner fixture with the given child command and stdin.
 * Returns the combined output plus the parsed WrapResult from stderr.
 *
 * The fixture writes `WRAP_RESULT:<json>` to stderr; this helper extracts
 * and parses that line separately from the remaining stderr output.
 */
export async function runWrapRunner(
  childCmd: string[],
  stdinInput = '',
  timeoutMs = 5000,
): Promise<RunnerOutput> {
  const proc = Bun.spawn(['bun', '--bun', WRAP_RUNNER_PATH, ...childCmd], {
    stdin: new TextEncoder().encode(stdinInput),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const timeoutHandle = setTimeout(() => proc.kill(), timeoutMs);

  const [runnerExitCode, runnerStdout, stderrRaw] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  clearTimeout(timeoutHandle);

  // Extract WRAP_RESULT line from stderr
  const lines = stderrRaw.split('\n');
  const resultLine = lines.find((l) => l.startsWith('WRAP_RESULT:'));
  let wrapResult: WrapResult | null = null;
  if (resultLine) {
    try {
      wrapResult = JSON.parse(resultLine.slice('WRAP_RESULT:'.length)) as WrapResult;
    } catch (err) {
      console.error(
        '[subprocess] WRAP_RESULT JSON parse failed. Raw line:',
        resultLine,
        'Error:',
        err,
      );
      // wrapResult stays null
    }
  }

  const runnerStderr = lines.filter((l) => !l.startsWith('WRAP_RESULT:')).join('\n');

  return { runnerExitCode, runnerStdout, wrapResult, runnerStderr };
}
