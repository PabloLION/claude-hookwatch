/**
 * Wrap mode execution for hookwatch.
 *
 * When invoked as `hookwatch PreToolUse ./hook.sh arg1`, the trailing args
 * after the event type are passed here. This module:
 *
 *   1. Reads stdin into a buffer (for event validation by the caller).
 *   2. Spawns the child command (Bun.spawn), piping the buffered stdin to it.
 *   3. Tees child stdout → process.stdout AND a capture buffer.
 *   4. Tees child stderr → process.stderr AND a capture buffer.
 *   5. Returns a WrapResult with { outcome, exitCode, stdin, stdout, stderr, hookwatchLog }.
 *
 * The caller (index.ts) validates the stdin as an event, then POSTs
 * the event with captured I/O to the server.
 *
 * STDOUT CONTRACT: The tee writes to process.stdout directly (for the child's
 * real output). The hook output JSON written by index.ts AFTER runWrapped()
 * returns is appended after the child's output.
 *
 * Best-effort: if the child process fails to spawn, stdin cannot be read, or
 * the command array is empty, we still return an exit code of 1 with null
 * stdout/stderr — the caller handles server reporting. If the child is
 * signal-killed, Bun's proc.exited is typed as Promise<number> but we guard
 * against null defensively. Signal deaths are
 * detected via proc.signalCode with a 128+N fallback computed from the signal
 * number. A [warn] log entry is included in WrapResult.hookwatchLog for the
 * caller.
 *
 * STDOUT SUPPRESSION REMINDER: All hookwatch-internal logging goes to stderr
 * (console.error / process.stderr.write) — NEVER console.log().
 */

import { errorMsg } from '@/errors.ts';
import type { WrapResult } from '@/types.ts';
import { describeExitCode, signalExitCode } from './signals.ts';

/**
 * Runs the given command as a child process with tee behaviour:
 * - stdin is read from process.stdin, buffered, and piped to the child
 * - stdout is written to process.stdout AND a capture buffer
 * - stderr is written to process.stderr AND a capture buffer
 *
 * Returns the child exit code, buffered stdin, captured output strings, and
 * a hookwatchLog entry for signal deaths (null when the child exited normally).
 * Never throws — errors are reported to stderr and exit code 1 is returned.
 * Signal deaths are converted to 128+N (e.g. SIGKILL → 137) and reported via
 * WrapResult.hookwatchLog.
 */
export async function runWrapped(cmd: string[]): Promise<WrapResult> {
  if (cmd.length === 0) {
    console.error('[hookwatch] runWrapped called with empty command');
    return {
      outcome: 'error',
      exitCode: 1,
      stdin: '',
      stdout: null,
      stderr: null,
      hookwatchLog: '[error] runWrapped called with empty command',
    };
  }

  // Read stdin into a buffer so we can both pass it to the child AND parse it
  // as the event JSON ourselves.
  let stdinContent: string;
  let stdinBytes: Uint8Array;
  try {
    stdinContent = await Bun.stdin.text();
    stdinBytes = new TextEncoder().encode(stdinContent);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to read stdin: ${msg}`);
    return {
      outcome: 'error',
      exitCode: 1,
      stdin: '',
      stdout: null,
      stderr: null,
      hookwatchLog: `[error] failed to read stdin: ${msg}`,
    };
  }

  // ReadableSubprocess = Subprocess<any, "pipe", "pipe"> — narrows stdout/stderr
  // to ReadableStream<Uint8Array> at the type level (no runtime cast needed).
  let child: Bun.ReadableSubprocess;
  try {
    child = Bun.spawn(cmd, {
      // Pipe the buffered stdin bytes to the child so it receives the event JSON
      stdin: stdinBytes,
      stdout: 'pipe',
      stderr: 'pipe',
    });
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to spawn wrapped command: ${msg}`);
    return {
      outcome: 'error',
      exitCode: 1,
      stdin: stdinContent,
      stdout: null,
      stderr: null,
      hookwatchLog: `[error] failed to spawn wrapped command: ${msg}`,
    };
  }

  // Tee stdout and stderr concurrently while waiting for the child to exit.
  const [rawExitCode, rawStdout, rawStderr] = await Promise.all([
    child.exited,
    teeStream(child.stdout, process.stdout),
    teeStream(child.stderr, process.stderr),
  ]);

  // Empty capture = null (nothing to store). Invariant: DB fields are either
  // null (nothing) or a non-empty string (content). No empty strings stored.
  const capturedStdout = rawStdout || null;
  const capturedStderr = rawStderr || null;

  // In Bun, proc.exited typically resolves to the 128+N value for signal-killed
  // children, but may return null in edge cases (proc.exitCode is null when
  // signaled). We detect signal deaths by checking proc.signalCode rather than
  // rawExitCode. signalExitCode() is the fallback if rawExitCode is null without
  // a known signal code.
  const signalCode = child.signalCode ?? null;
  const isSignalKill = signalCode !== null;

  // Resolve final exit code:
  //   - Normal exit: rawExitCode is the numeric exit code (0-255)
  //   - Signal kill: rawExitCode is already 128+N from Bun; signalExitCode is
  //     the fallback if rawExitCode is somehow null
  const exitCode = rawExitCode === null ? signalExitCode(signalCode) : rawExitCode;

  // Build a [warn] log entry for signal deaths so the caller can store it in
  // hookwatch_log and surface it in the systemMessage.
  if (isSignalKill) {
    const description = describeExitCode(exitCode);
    const label = description === null ? '' : ` (${description})`;
    const hookwatchLog = `[warn] exit ${exitCode}${label}`;
    console.error(`[hookwatch] Child killed by signal: ${hookwatchLog}`);
    return {
      outcome: 'signal',
      exitCode,
      stdin: stdinContent,
      stdout: capturedStdout,
      stderr: capturedStderr,
      hookwatchLog,
    };
  }

  return {
    outcome: 'normal',
    exitCode,
    stdin: stdinContent,
    stdout: capturedStdout,
    stderr: capturedStderr,
    hookwatchLog: null,
  };
}

/**
 * Reads all bytes from a ReadableStream, writes each chunk to the given
 * WritableStream (tee), and accumulates the chunks into a string buffer.
 *
 * Returns the full accumulated string when the source stream ends.
 * dest.write() errors are caught and logged once (per-chunk logging would flood
 * stderr). Capture continues even if the tee destination fails — the accumulated
 * buffer is more important than the pass-through.
 */
async function teeStream(
  source: ReadableStream<Uint8Array>,
  dest: NodeJS.WritableStream,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = source.getReader();
  let destErrorLogged = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      try {
        dest.write(value);
      } catch (err) {
        if (!destErrorLogged) {
          process.stderr.write(`[hookwatch] teeStream dest.write error: ${errorMsg(err)}\n`);
          destErrorLogged = true;
        }
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf-8');
}
