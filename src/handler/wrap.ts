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
 *   5. Returns { exitCode, stdin, stdout, stderr }.
 *
 * The caller (index.ts) validates the stdin as an event, then POSTs
 * the event with captured I/O to the server.
 *
 * STDOUT CONTRACT: The tee writes to process.stdout directly (for the child's
 * real output). The hook output JSON written by index.ts AFTER runWrapped()
 * returns is appended after the child's output.
 *
 * Best-effort: if the child process fails to spawn, we still return an exit
 * code of 1 with empty capture buffers — the caller handles server reporting.
 *
 * STDOUT SUPPRESSION REMINDER: All hookwatch-internal logging goes to stderr
 * (console.error / process.stderr.write) — NEVER console.log().
 */

import { errorMsg } from "./errors.ts";

/** Result returned by runWrapped() after the child process exits. */
export interface WrapResult {
  exitCode: number;
  /** Raw stdin content (the Claude Code event JSON) — for the caller to parse. */
  stdin: string;
  stdout: string;
  stderr: string;
}

/**
 * Runs the given command as a child process with tee behaviour:
 * - stdin is read from process.stdin, buffered, and piped to the child
 * - stdout is written to process.stdout AND a capture buffer
 * - stderr is written to process.stderr AND a capture buffer
 *
 * Returns the child exit code, buffered stdin, and captured output strings.
 * Never throws — errors are reported to stderr and exit code 1 is returned.
 */
export async function runWrapped(cmd: string[]): Promise<WrapResult> {
  if (cmd.length === 0) {
    console.error("[hookwatch] runWrapped called with empty command");
    return { exitCode: 1, stdin: "", stdout: "", stderr: "" };
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
    return { exitCode: 1, stdin: "", stdout: "", stderr: "" };
  }

  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(cmd, {
      // Pipe the buffered stdin bytes to the child so it receives the event JSON
      stdin: stdinBytes,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to spawn wrapped command: ${msg}`);
    return { exitCode: 1, stdin: stdinContent, stdout: "", stderr: "" };
  }

  // Tee stdout and stderr concurrently while waiting for the child to exit.
  const [exitCode, capturedStdout, capturedStderr] = await Promise.all([
    child.exited,
    teeStream(child.stdout, process.stdout),
    teeStream(child.stderr, process.stderr),
  ]);

  return {
    exitCode: exitCode ?? 1,
    stdin: stdinContent,
    stdout: capturedStdout,
    stderr: capturedStderr,
  };
}

/**
 * Reads all bytes from a ReadableStream, writes each chunk to the given
 * WritableStream (tee), and accumulates the chunks into a string buffer.
 *
 * Returns the full accumulated string when the source stream ends.
 */
async function teeStream(
  source: ReadableStream<Uint8Array>,
  dest: NodeJS.WritableStream,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = source.getReader();

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Write to terminal immediately (pass-through)
      dest.write(value);
      // Accumulate for capture
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Decode all chunks into a single string
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
