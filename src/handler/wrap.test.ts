/**
 * Tests for src/handler/wrap.ts
 *
 * Coverage:
 * - runWrapped: stdin is passed to child and returned as stdin
 * - runWrapped: child stdout/stderr are teed to process streams and captured
 * - runWrapped: child exit code is forwarded correctly (0, 1, 2, 3)
 * - runWrapped: non-existent command returns exit 1 with empty capture
 * - runWrapped: signal-killed child → exit code 128+N, hookwatchLog [warn]
 *
 * Strategy: a small fixture script (wrap-runner.fixture.ts) calls runWrapped()
 * and writes the WrapResult as JSON to stderr (WRAP_RESULT: prefix). Tests
 * spawn the fixture as a subprocess and parse the result from stderr.
 * This approach avoids polluting the test process's own streams.
 */

import { describe, expect, test } from 'bun:test';
import { runWrapRunner } from '@/test';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Arbitrary non-zero exit code for forwarding tests. */
const EXIT_CODE_ARBITRARY = 3;

/** Exit code for SIGKILL: 128 + signal 9. */
const EXIT_CODE_SIGKILL = 137;

/** Arbitrary non-zero clean exit code (not signal-killed). */
const EXIT_CODE_CLEAN_NONZERO = 42;

/** Shell command that sends SIGKILL to itself. */
const SIGKILL_SELF_CMD = 'kill -9 $$';

// ---------------------------------------------------------------------------
// Tests: tee and capture
// ---------------------------------------------------------------------------

describe('runWrapped — tee and capture', () => {
  test('child stdout is passed through to runner stdout and captured', async () => {
    const result = await runWrapRunner(['sh', '-c', 'echo hello'], 'event-json');

    expect(result.wrapResult).not.toBeNull();
    expect(result.wrapResult?.stdout.trim()).toBe('hello');
    // Tee: the child's stdout also appears as the runner's own stdout
    expect(result.runnerStdout.trim()).toBe('hello');
  });

  test('child stderr is passed through to runner stderr and captured', async () => {
    const result = await runWrapRunner(['sh', '-c', 'echo error-msg >&2'], 'event-json');

    expect(result.wrapResult).not.toBeNull();
    expect(result.wrapResult?.stderr.trim()).toBe('error-msg');
    // Tee: child stderr appears in the runner's stderr output
    expect(result.runnerStderr).toContain('error-msg');
  });

  test('stdin input is read into stdin and forwarded to child', async () => {
    const stdinInput = '{"hook_event_name":"SessionStart"}';
    const result = await runWrapRunner(['sh', '-c', 'cat'], stdinInput);

    expect(result.wrapResult).not.toBeNull();
    // stdin should match what we sent
    expect(result.wrapResult?.stdin).toBe(stdinInput);
    // The child (cat) echoes stdin to stdout — captured and tee'd
    expect(result.wrapResult?.stdout).toBe(stdinInput);
    expect(result.runnerStdout).toBe(stdinInput);
  });

  test('captures both stdout and stderr in a single run', async () => {
    const result = await runWrapRunner(
      ['sh', '-c', 'echo out-line; echo err-line >&2'],
      'stdin-data',
    );

    expect(result.wrapResult?.stdout.trim()).toBe('out-line');
    expect(result.wrapResult?.stderr.trim()).toBe('err-line');
  });
});

// ---------------------------------------------------------------------------
// Tests: exit code forwarding
// ---------------------------------------------------------------------------

describe('runWrapped — exit code forwarding', () => {
  test('forwards exit code 0', async () => {
    const result = await runWrapRunner(['sh', '-c', 'exit 0'], '');

    expect(result.runnerExitCode).toBe(0);
    expect(result.wrapResult?.exitCode).toBe(0);
  });

  test('forwards non-zero exit code (1)', async () => {
    const result = await runWrapRunner(['sh', '-c', 'exit 1'], '');

    expect(result.runnerExitCode).toBe(1);
    expect(result.wrapResult?.exitCode).toBe(1);
  });

  test('forwards exit code 2 (block action in Claude Code hooks)', async () => {
    const result = await runWrapRunner(['sh', '-c', 'exit 2'], '');

    expect(result.runnerExitCode).toBe(2);
    expect(result.wrapResult?.exitCode).toBe(2);
  });

  test('forwards arbitrary non-zero exit code (3)', async () => {
    const result = await runWrapRunner(['sh', '-c', `exit ${EXIT_CODE_ARBITRARY}`], '');

    expect(result.runnerExitCode).toBe(EXIT_CODE_ARBITRARY);
    expect(result.wrapResult?.exitCode).toBe(EXIT_CODE_ARBITRARY);
  });
});

// ---------------------------------------------------------------------------
// Tests: error cases
// ---------------------------------------------------------------------------

describe('runWrapped — error handling', () => {
  test('returns exit 1 for non-existent command', async () => {
    const result = await runWrapRunner(['/nonexistent-binary-that-does-not-exist'], '');

    // runWrapped catches spawn failure and returns exitCode 1
    expect(result.wrapResult?.exitCode).toBe(1);
    expect(result.wrapResult?.stdout).toBe('');
    expect(result.wrapResult?.stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Tests: signal handling (ch-qddi)
// ---------------------------------------------------------------------------

describe('runWrapped — signal-killed child', () => {
  test('SIGKILL child returns exit code 137 (128+9)', async () => {
    // `kill -9 $$` kills the shell with SIGKILL inside the child process
    const result = await runWrapRunner(['sh', '-c', SIGKILL_SELF_CMD], '');

    // exit code 137 = 128 + SIGKILL(9)
    expect(result.wrapResult?.exitCode).toBe(EXIT_CODE_SIGKILL);
  });

  test('SIGKILL child: hookwatchLog contains [warn] with exit code', async () => {
    const result = await runWrapRunner(['sh', '-c', SIGKILL_SELF_CMD], '');

    const log = result.wrapResult?.hookwatchLog;
    expect(typeof log).toBe('string');
    expect(log).toContain('[warn]');
    expect(log).toContain(String(EXIT_CODE_SIGKILL));
  });

  test('SIGKILL child: hookwatchLog describes likely SIGKILL', async () => {
    const result = await runWrapRunner(['sh', '-c', SIGKILL_SELF_CMD], '');

    const log = result.wrapResult?.hookwatchLog;
    expect(log).toContain('likely SIGKILL');
    expect(log).toContain('forced termination');
  });

  test('SIGKILL child: signal death is logged to stderr by runWrapped', async () => {
    const result = await runWrapRunner(['sh', '-c', SIGKILL_SELF_CMD], '');

    // runWrapped logs to console.error which appears in the runner's stderr
    expect(result.runnerStderr).toContain('[hookwatch]');
    expect(result.runnerStderr).toContain('signal');
  });

  test('normal exit: hookwatchLog is absent from WrapResult', async () => {
    const result = await runWrapRunner(['sh', '-c', 'exit 0'], '');

    // No signal death — hookwatchLog should be undefined (not present in JSON)
    expect(result.wrapResult?.hookwatchLog).toBeUndefined();
  });

  test('non-zero clean exit: hookwatchLog is absent (not a signal death)', async () => {
    const result = await runWrapRunner(['sh', '-c', `exit ${EXIT_CODE_CLEAN_NONZERO}`], '');

    expect(result.wrapResult?.exitCode).toBe(EXIT_CODE_CLEAN_NONZERO);
    expect(result.wrapResult?.hookwatchLog).toBeUndefined();
  });
});
