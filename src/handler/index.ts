/**
 * Hook handler entry point for hookwatch.
 *
 * Two modes (controlled via the wrappedCommand parameter):
 *
 * Bare mode (wrappedCommand undefined/null):
 *   Reads a Claude Code hook event from stdin, validates it with Zod, POSTs
 *   it to the local hookwatch server for storage, and writes a hook output JSON
 *   to stdout so Claude Code injects a systemMessage into the agent's context.
 *
 * Wrapped mode (wrappedCommand is a non-empty string array):
 *   Reads stdin concurrently, spawns the wrapped command, tees its stdout/stderr
 *   to both terminal and capture buffers, waits for it to exit, then POSTs the
 *   event with captured I/O to the server. Always passes the child exit code
 *   through. If the server is unreachable, still passes through I/O.
 *
 * STDOUT CONTRACT: Claude Code interprets ANY stdout as hook output JSON.
 * All other logging goes to stderr (console.error / process.stderr.write) —
 * NEVER console.log().
 *
 * Exit codes:
 *   0 — always (hookwatch never exits non-zero in bare mode)
 *   In wrapped mode: child exit code is forwarded (pass-through)
 *   Never exits with code 1 — Claude Code shows generic "hook error" for exit 1
 *   and does not surface stderr.
 *
 * Fatal errors (schema parse failure in bare mode):
 *   exit 0 + JSON stdout with hookwatch_fatal + continue: true + systemMessage.
 *   Claude Code only parses stdout JSON at exit 0 — exit 2 JSON is silently
 *   ignored. Using exit 0 + systemMessage makes the error visible to the user
 *   while never blocking Claude Code (passive observer principle).
 *
 * Error handling priority chain:
 *   Fatal (stdin parse failure): exit 0 + JSON stdout with hookwatch_fatal.
 *   POST failure (server unreachable / HTTP error): non-fatal — failure reason
 *     appears in the systemMessage written to stdout. Claude Code is informed
 *     but never blocked (passive observer principle).
 *   Wrapped mode: forward child exit code (best-effort — never change it).
 *   Non-fatal error (hookwatch internal issue): hookwatch_log in DB.
 *   Warn: event captured, hookwatch_log with [warn] prefix.
 *   Never mutate wrapped command exit code.
 */

import { readPort } from '@/paths.ts';
import { parseHookEvent } from '@/schemas/events.ts';
import { hookOutputSchema } from '@/schemas/output.ts';
import { buildSystemMessage } from './context.ts';
import { errorMsg } from './errors.ts';
import type { EventPostPayload, PostEventResult } from './post-event.ts';
import { postEvent } from './post-event.ts';
import { runWrapped } from './wrap.ts';

const SLOW_THRESHOLD_MS = 100;

// ---------------------------------------------------------------------------
// Fatal error: exit 0 + JSON stdout with hookwatch_fatal + systemMessage
// ---------------------------------------------------------------------------

/**
 * Writes a fatal error JSON to stdout and exits with code 0.
 *
 * Claude Code only parses stdout JSON at exit 0 — at exit 2, stdout is
 * silently ignored. By exiting 0 + JSON we make the hookwatch error visible
 * to the user via systemMessage, while never blocking Claude Code (passive
 * observer principle). continue: true ensures no pre/post tool use blocking.
 *
 * In bare mode this is always exit 0. In wrapped mode, exitFatal is NOT called
 * after the child exits — the child exit code is forwarded instead (best-effort).
 * exitFatal is only called in wrapped mode if an error occurs before the child
 * is spawned (e.g. stdin read failure at the process level).
 */
function exitFatal(message: string): never {
  const errorOutput = JSON.stringify({
    hookwatch_fatal: message,
    continue: true,
    systemMessage: `[hookwatch fatal] ${message}`,
  });
  process.stdout.write(errorOutput);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Event parsing helper
// ---------------------------------------------------------------------------

/**
 * Parses jsonStr as JSON and validates it against the HookEvent discriminated
 * union schema. On any error, logs to stderr and terminates the process.
 *
 * The fallbackExitCode parameter controls error handling:
 *   - null (bare mode): calls exitFatal() → exit 0 + JSON stdout (fatal)
 *   - non-null (wrapped mode): calls process.exit(fallbackExitCode) to forward
 *     the child's exit code even when event parsing fails (best-effort)
 *
 * This helper eliminates duplicate try-catch blocks across the two error paths.
 *
 * @param jsonStr - Raw stdin JSON string from Claude Code
 * @param fallbackExitCode - Child process exit code to forward on failure, or
 *   null for bare mode (use exitFatal instead)
 * @returns Parsed and validated hook event. Never returns on failure.
 */
function parseEventSafely(
  jsonStr: string,
  fallbackExitCode: number | null,
): ReturnType<typeof parseHookEvent> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to parse stdin as JSON: ${msg}`);
    if (fallbackExitCode !== null) {
      process.exit(fallbackExitCode);
    }
    exitFatal(`Failed to parse stdin as JSON: ${msg}`);
  }

  try {
    return parseHookEvent(parsed);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Zod validation failed: ${msg}`);
    if (fallbackExitCode !== null) {
      process.exit(fallbackExitCode);
    }
    exitFatal(`Zod validation failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Unified pipeline helpers
// ---------------------------------------------------------------------------

/**
 * Shape returned by readStdinAndWrapOutput() — discriminated on mode.
 *
 * 'bare'    — stdin was read directly; no child was spawned.
 * 'wrapped' — a child was spawned; all I/O fields are populated.
 *
 * The discriminant eliminates runtime null assertions in buildPostPayload():
 * childStdout/childStderr are typed as string (not string|null) in the wrapped
 * variant, so the compiler enforces correctness instead of a throw.
 */
type StdinAndWrapOutput =
  | { mode: 'bare'; stdinJson: string }
  | {
      mode: 'wrapped';
      stdinJson: string;
      /** The original wrapArgs array — stored here to avoid a separate wrapArgs parameter. */
      wrapArgs: string[];
      childStdout: string;
      childStderr: string;
      childExitCode: number;
      /** Signal-death warning from wrapped mode, if any. */
      hookwatchLogFromWrap: string | null;
    };

/**
 * Steps 1+2: Reads stdin and — in wrapped mode — spawns the child process,
 * tees its I/O, and captures its exit code.
 *
 * In bare mode, returns mode:'bare' with stdinJson only.
 * In wrapped mode, returns mode:'wrapped' with all I/O fields populated.
 */
async function readStdinAndWrapOutput(wrapArgs: string[] | null): Promise<StdinAndWrapOutput> {
  if (wrapArgs === null) {
    return { mode: 'bare', stdinJson: await Bun.stdin.text() };
  }

  // Wrapped mode: runWrapped() reads stdin, tees child I/O, returns everything
  const wrapResult = await runWrapped(wrapArgs);
  return {
    mode: 'wrapped',
    wrapArgs,
    stdinJson: wrapResult.stdin,
    childStdout: wrapResult.stdout,
    childStderr: wrapResult.stderr,
    childExitCode: wrapResult.exitCode,
    // Signal-death warning (if any): "[warn] exit 137 (likely SIGKILL …)"
    hookwatchLogFromWrap: wrapResult.hookwatchLog ?? null,
  };
}

/**
 * Builds the EventPostPayload discriminated union for the given mode.
 *
 * In bare mode, stdout stores the preliminary hook output JSON (what Claude
 * Code would see). In wrapped mode, stdout/stderr/exitCode are the child's
 * captured values.
 *
 * The StdinAndWrapOutput discriminant guarantees childStdout/childStderr are
 * non-null strings in the wrapped branch — no runtime null assertions needed.
 */
function buildPostPayload(opts: {
  event: ReturnType<typeof parseHookEvent>;
  stdinAndWrap: StdinAndWrapOutput;
  elapsedMs: number;
  hookwatchLog: string | null;
  preliminaryHookOutputJson: string;
}): EventPostPayload {
  const { event, stdinAndWrap, elapsedMs, hookwatchLog, preliminaryHookOutputJson } = opts;

  if (stdinAndWrap.mode === 'bare') {
    return {
      mode: 'bare',
      stdout: preliminaryHookOutputJson,
      hookDurationMs: elapsedMs,
      event,
      hookwatchLog,
    };
  }

  return {
    mode: 'wrapped',
    wrappedCommand: stdinAndWrap.wrapArgs.join(' '),
    stdout: stdinAndWrap.childStdout,
    stderr: stdinAndWrap.childStderr,
    exitCode: stdinAndWrap.childExitCode,
    hookDurationMs: elapsedMs,
    event,
    hookwatchLog,
  };
}

/**
 * Processes the POST result: exits fatal on infrastructure failure, appends
 * non-fatal error and version mismatch entries to logEntries.
 */
function processPostResult(
  postResult: PostEventResult,
  logEntries: string[],
  wrapArgs: string[] | null,
): void {
  if (!postResult.ok) {
    const { failureReason, failureKind } = postResult;
    const detail = postResult.detail ? `: ${postResult.detail}` : '';

    if (failureKind === 'spawn' || failureKind === 'retry') {
      exitFatal(failureReason);
    }

    logEntries.push(`[error] ${failureReason}${detail}`);

    if (wrapArgs !== null) {
      console.error(
        `[hookwatch] Failed to POST wrapped event (${failureReason}) — continuing (best-effort)`,
      );
    }
    return;
  }

  if (postResult.versionMismatchLog !== undefined) {
    logEntries.push(postResult.versionMismatchLog);
  }
}

// ---------------------------------------------------------------------------
// Unified pipeline: handleHook()
// ---------------------------------------------------------------------------

/**
 * Unified hook handler. One algorithm skeleton with a conditional branch on
 * wrappedCommand being null (bare) or non-null (wrapped).
 *
 * Pipeline:
 *   1. Read stdin (bare: Bun.stdin; wrapped: runWrapped buffers it)
 *   2. [Wrapped only] Spawn child, tee I/O, capture exit code
 *   3. Parse and validate event from stdin JSON
 *   4. Resolve port
 *   5. POST event to server (with captured I/O if wrapped)
 *   6. Write hook output JSON to stdout (context injection)
 *   7. [Wrapped] Forward child exit code
 *
 * Error strategy:
 *   Fatal (stdin parse failure): exitFatal() → exit 0 + JSON with hookwatch_fatal.
 *   POST failure (server unreachable / HTTP error): non-fatal — failure reason
 *     appended to logEntries and surfaced in the systemMessage written to stdout.
 *   Error (hookwatch internal issue): accumulate in hookwatchLog for DB storage.
 *   Normal: logEntries empty, hookwatchLog null.
 */
async function handleHook(wrapArgs: string[] | null): Promise<void> {
  // Accumulated non-fatal hookwatch log entries; joined with "; " if multiple
  const logEntries: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1+2: Read stdin (and optionally spawn child in wrapped mode)
  // -------------------------------------------------------------------------

  const stdinAndWrap = await readStdinAndWrapOutput(wrapArgs);

  // Propagate signal-death warning from wrapped mode into logEntries
  if (stdinAndWrap.mode === 'wrapped' && stdinAndWrap.hookwatchLogFromWrap !== null) {
    logEntries.push(stdinAndWrap.hookwatchLogFromWrap);
  }

  // -------------------------------------------------------------------------
  // Step 3: Parse and validate the event
  // -------------------------------------------------------------------------

  // Bare mode timer starts after stdin read (before event parse)
  // Wrapped mode timer starts here (after child exits — measures hookwatch overhead only)
  const startMs = Date.now();

  // parseEventSafely handles both try-catch blocks (JSON.parse + Zod validation).
  // In wrapped mode (fallbackExitCode = childExitCode): forwards child exit code
  // on parse failure (best-effort). In bare mode (fallbackExitCode = null):
  // calls exitFatal() → exit 0 + JSON stdout (fatal, non-blocking).
  const fallbackExitCode = stdinAndWrap.mode === 'wrapped' ? stdinAndWrap.childExitCode : null;
  const event = parseEventSafely(stdinAndWrap.stdinJson, fallbackExitCode);

  // -------------------------------------------------------------------------
  // Step 4: Resolve port
  // -------------------------------------------------------------------------

  const { port, warning: portWarning } = readPort();
  if (portWarning !== null) {
    logEntries.push(portWarning);
  }

  // -------------------------------------------------------------------------
  // Build preliminary hook output JSON (for bare mode POST body storage)
  // -------------------------------------------------------------------------

  // Build with the event's base systemMessage. This is the value stored in the
  // DB as "stdout" (what Claude Code would see in the normal case). The final
  // hook output written to stdout may differ if the POST fails — see Step 6.
  let preliminaryHookOutput: ReturnType<typeof hookOutputSchema.parse>;
  try {
    preliminaryHookOutput = hookOutputSchema.parse({
      continue: true,
      systemMessage: buildSystemMessage(event),
    });
  } catch (err) {
    const msg = errorMsg(err);
    exitFatal(`Failed to build hook output JSON: ${msg}`);
  }
  const preliminaryHookOutputJson = JSON.stringify(preliminaryHookOutput);

  // -------------------------------------------------------------------------
  // Step 5: POST event to server
  // -------------------------------------------------------------------------

  const elapsedMs = Date.now() - startMs;
  // hookwatchLog snapshot is taken before POST. Version-mismatch warnings from
  // the POST response are not included in the DB record but do appear in the
  // stdout systemMessage that Claude Code sees.
  const hookwatchLog = logEntries.length > 0 ? logEntries.join('; ') : null;

  const postPayload = buildPostPayload({
    event,
    stdinAndWrap,
    elapsedMs,
    hookwatchLog,
    preliminaryHookOutputJson,
  });
  const postResult: PostEventResult = await postEvent(port, postPayload);
  processPostResult(postResult, logEntries, wrapArgs);

  // -------------------------------------------------------------------------
  // Step 6: Build final hook output JSON and write to stdout (context injection)
  // -------------------------------------------------------------------------

  // Rebuild with the final logEntries so any POST failure reason appears in
  // systemMessage. If no failures occurred, logEntries matches the preliminary
  // build and the result is identical.
  let hookOutput: ReturnType<typeof hookOutputSchema.parse>;
  try {
    const systemMessage = buildSystemMessage(event, logEntries);
    hookOutput = hookOutputSchema.parse({ continue: true, systemMessage });
  } catch (err) {
    const msg = errorMsg(err);
    exitFatal(`Failed to build final hook output JSON: ${msg}`);
  }
  const hookOutputJson = JSON.stringify(hookOutput);

  // In wrapped mode, child stdout was already written by teeStream.
  // The hook JSON is appended after it.
  process.stdout.write(hookOutputJson);

  // Log slow handler execution to stderr (never stdout)
  if (elapsedMs > SLOW_THRESHOLD_MS) {
    console.error(`[hookwatch] Handler took ${elapsedMs}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`);
  }

  // -------------------------------------------------------------------------
  // Step 7: Forward child exit code (wrapped mode only)
  // -------------------------------------------------------------------------

  if (stdinAndWrap.mode === 'wrapped') {
    process.exit(stdinAndWrap.childExitCode);
  }
}

// ---------------------------------------------------------------------------
// Public API + entry point
// ---------------------------------------------------------------------------

/**
 * Runs the hook handler.
 *
 * Pass wrappedCommand to enable wrapped mode (child process is spawned and
 * its I/O is captured). Omit or pass undefined for bare mode.
 *
 * Exported for use by cli/index.ts (static import) and tests.
 */
export async function runHandler(wrappedCommand?: string[]): Promise<void> {
  const wrapArgs = wrappedCommand && wrappedCommand.length > 0 ? wrappedCommand : null;
  await handleHook(wrapArgs).catch((err) => {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Unexpected error: ${msg}`);
    exitFatal(`Unexpected error: ${msg}`);
  });
}

// Auto-execute when run as the main module (e.g. via `bun src/handler/index.ts`).
// Extra args after the script path become argv.slice(2).
//   bun src/handler/index.ts          → bare mode (argv.slice(2) is empty)
//   bun src/handler/index.ts sh -c …  → wrapped mode (argv.slice(2) = ["sh",…])
if (import.meta.main) {
  const trailingArgs = process.argv.slice(2);
  const wrapArgs = trailingArgs.length > 0 ? trailingArgs : undefined;
  // No .catch() here: runHandler() already has an inner .catch() that calls
  // exitFatal() → process.exit(0), so the process terminates before any outer
  // catch could fire. A second catch would be dead code.
  await runHandler(wrapArgs);
}
