#!/usr/bin/env bun
/**
 * Fixture script for wrap.test.ts.
 *
 * Calls runWrapped() with the command specified in argv[2..] and writes the
 * WrapResult as JSON to stderr (prefixed with "WRAP_RESULT:") so test code
 * can parse it without mixing with the child's tee output.
 *
 * The child receives stdin from this process's stdin (Bun.stdin).
 * The child's stdout/stderr are tee'd to this process's stdout/stderr.
 * Exits with the child's exit code.
 */

import { runWrapped } from './wrap.ts';

const cmd = process.argv.slice(2);
if (cmd.length === 0) {
  process.stderr.write(`${JSON.stringify({ error: 'no command provided' })}\n`);
  process.exit(1);
}

const result = await runWrapped(cmd);
// Write result to stderr so it doesn't mix with child stdout tee on stdout
process.stderr.write(`WRAP_RESULT:${JSON.stringify(result)}\n`);
process.exit(result.exitCode);
