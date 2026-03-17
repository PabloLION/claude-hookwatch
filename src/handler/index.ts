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

import { errorMsg } from '@/errors.ts';
import { readPort } from '@/paths.ts';
import { type HookEvent, parseHookEvent } from '@/schemas/events.ts';
import { type HookOutput, hookOutputSchema } from '@/schemas/output.ts';
import { buildSystemMessage } from './context.ts';
import { type EventPostPayload, type PostEventResult, postEvent } from './post-event.ts';
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
 *
 * DO NOT call exitFatal() in wrapped mode after the child has already exited.
 * The child exit code must be forwarded unchanged — Step 7 handles this via
 * process.exit(childExitCode). Calling exitFatal() there would exit 0 and lose
 * the child's exit code, breaking the pass-through contract.
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
 * Discriminates the error-handling strategy for parseEventSafely().
 *
 * 'bare'    — calls exitFatal() → exit 0 + JSON stdout (hookwatch_fatal).
 * 'wrapped' — calls process.exit(fallbackExitCode) to forward the child's
 *             exit code even when event parsing fails (best-effort passthrough).
 */
type ErrorMode = { mode: 'bare' } | { mode: 'wrapped'; fallbackExitCode: number };

/**
 * Parses jsonStr as JSON and validates it against the HookEvent discriminated
 * union schema. On any error, logs to stderr and terminates the process.
 *
 * The errorMode discriminant controls the termination strategy:
 *   - { mode: 'bare' }: calls exitFatal() → exit 0 + JSON stdout (fatal)
 *   - { mode: 'wrapped', fallbackExitCode }: calls process.exit(fallbackExitCode)
 *     to forward the child's exit code (best-effort passthrough)
 *
 * This helper eliminates duplicate try-catch blocks across the two error paths.
 *
 * @param jsonStr - Raw stdin JSON string from Claude Code
 * @param errorMode - Termination strategy for parse failures
 * @returns Parsed and validated hook event. Never returns on failure.
 */
function parseEventSafely(jsonStr: string, errorMode: ErrorMode): HookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Failed to parse stdin as JSON: ${msg}`);
    if (errorMode.mode === 'wrapped') {
      process.exit(errorMode.fallbackExitCode);
    }
    exitFatal(`Failed to parse stdin as JSON: ${msg}`);
  }

  try {
    return parseHookEvent(parsed);
  } catch (err) {
    const msg = errorMsg(err);
    console.error(`[hookwatch] Zod validation failed: ${msg}`);
    if (errorMode.mode === 'wrapped') {
      process.exit(errorMode.fallbackExitCode);
    }
    exitFatal(`Zod validation failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Unified pipeline helpers
// ---------------------------------------------------------------------------

/**
 * Validates { continue, systemMessage } against hookOutputSchema and returns
 * the parsed output. Calls exitFatal() on any schema violation — this would
 * only happen if hookOutputSchema itself changed incompatibly with the literal
 * object we build here, so it is treated as an internal error.
 */
function buildHookOutput(systemMessage: string): HookOutput {
  try {
    return hookOutputSchema.parse({ continue: true, systemMessage });
  } catch (err) {
    exitFatal(`hookwatch: internal error building hook output: ${errorMsg(err)}`);
  }
}

/**
 * Shape returned by readStdinAndWrapOutput() — discriminated on mode.
 *
 * 'bare'    — stdin was read directly; no child was spawned.
 * 'wrapped' — a child was spawned; all I/O fields are populated.
 *
 * The discriminant eliminates runtime null assertions in buildPostPayload():
 * childStdout/childStderr are typed as string|null in the wrapped variant —
 * null means the child produced no output (empty capture normalized to null).
 *
 * Design note: WrapResult fields are spread individually rather than
 * embedded as `wrapResult: WrapResult` because:
 *   - Both modes expose `stdinJson` at the top level for uniform access
 *   - Embedding WrapResult would create two names for the same data:
 *     `stdinJson` (bare) vs `wrapResult.stdin` (wrapped), forcing callers
 *     to know which variant they are in just to read stdin
 *   - Child-prefixed names (childStdout, childStderr, childExitCode) make
 *     the origin explicit at every call site — no ambiguity with hookwatch's
 *     own stdout/exitCode concepts that appear nearby in the pipeline
 */
type StdinAndWrapOutput =
  | { readonly mode: 'bare'; readonly stdinJson: string }
  | {
      readonly mode: 'wrapped';
      readonly stdinJson: string;
      /** The original wrapArgs array — stored here to avoid a separate wrapArgs parameter. */
      readonly wrapArgs: readonly string[];
      readonly childStdout: string | null;
      readonly childStderr: string | null;
      readonly childExitCode: number;
      /** Signal-death warning from wrapped mode, if any. */
      readonly hookwatchLogFromWrap: string | null;
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
    let stdinJson: string;
    try {
      stdinJson = await Bun.stdin.text();
    } catch (err) {
      const msg = errorMsg(err);
      exitFatal(`hookwatch: failed to read stdin: ${msg}`);
    }
    return { mode: 'bare', stdinJson };
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
    hookwatchLogFromWrap: wrapResult.hookwatchLog,
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
 * present (possibly null) in the wrapped branch — no runtime null assertions needed.
 */
function buildPostPayload(opts: {
  event: HookEvent;
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
    wrappedCommand: JSON.stringify(stdinAndWrap.wrapArgs),
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
 *
 * A switch on failureKind gives TypeScript structural certainty for each
 * variant. In bare mode, the 'spawn' and 'retry' cases call exitFatal()
 * (typed never) so the compiler knows they never fall through. In wrapped
 * mode, they push to logEntries and break (child exit code must be
 * forwarded). The 'http' and 'exception' cases have a required detail
 * field — accessed here without assertion.
 */
function processPostResult(
  postResult: PostEventResult,
  logEntries: string[],
  wrapArgs: string[] | null,
): void {
  if (!postResult.ok) {
    switch (postResult.failureKind) {
      case 'spawn':
      case 'retry':
        if (wrapArgs !== null) {
          // In wrapped mode: do NOT call exitFatal() — the child has already
          // exited and its exit code must be forwarded. Push the failure to
          // logEntries and return; Step 7 will call process.exit(childExitCode).
          logEntries.push(`[error] ${postResult.failureReason}`);
          console.error(
            `[hookwatch] Server unreachable (${postResult.failureReason}) — forwarding child exit code`,
          );
        } else {
          // In bare mode: fatal — infrastructure broken, server cannot be reached.
          exitFatal(postResult.failureReason);
        }
        break;

      case 'http':
      case 'exception': {
        // Non-fatal: transient failure — log and continue.
        const detail = postResult.detail ? `: ${postResult.detail}` : '';
        logEntries.push(`[error] ${postResult.failureReason}${detail}`);
        if (wrapArgs !== null) {
          console.error(
            `[hookwatch] Failed to POST wrapped event (${postResult.failureReason}) — continuing (best-effort)`,
          );
        }
        break;
      }

      default: {
        const _exhaustive: never = postResult.failureKind;
        logEntries.push(`[error] Unknown failure kind: ${_exhaustive}`);
        break;
      }
    }
    return;
  }

  if (postResult.versionMismatchLog !== undefined) {
    logEntries.push(postResult.versionMismatchLog);
  }

  if (postResult.spawnWarning !== undefined) {
    logEntries.push(postResult.spawnWarning);
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
  const startMs = performance.now();

  // parseEventSafely handles both try-catch blocks (JSON.parse + Zod validation).
  // In wrapped mode: forward child exit code on parse failure (best-effort).
  // In bare mode: call exitFatal() → exit 0 + JSON stdout (fatal, non-blocking).
  const errorMode: ErrorMode =
    stdinAndWrap.mode === 'wrapped'
      ? { mode: 'wrapped', fallbackExitCode: stdinAndWrap.childExitCode }
      : { mode: 'bare' };
  const event = parseEventSafely(stdinAndWrap.stdinJson, errorMode);

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
  const preliminaryHookOutput = buildHookOutput(buildSystemMessage(event));
  const preliminaryHookOutputJson = JSON.stringify(preliminaryHookOutput);

  // -------------------------------------------------------------------------
  // Step 5: POST event to server
  // -------------------------------------------------------------------------

  const elapsedMs = Math.round(performance.now() - startMs);
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
  const postResult = await postEvent(port, postPayload);
  processPostResult(postResult, logEntries, wrapArgs);

  // -------------------------------------------------------------------------
  // Step 6: Build final hook output JSON and write to stdout (context injection)
  // -------------------------------------------------------------------------

  // Rebuild with the final logEntries so any POST failure reason appears in
  // systemMessage. If no failures occurred, logEntries matches the preliminary
  // build and the result is identical.
  const hookOutput = buildHookOutput(buildSystemMessage(event, logEntries));
  const hookOutputJson = JSON.stringify(hookOutput);

  // In wrapped mode, child stdout was already written by teeStream.
  // The hook JSON is appended after it.
  // Known limitation: in wrapped mode, child stdout + hookwatch JSON are concatenated.
  // Claude Code parses the last JSON object from stdout. If the child also outputs JSON,
  // parsing may be ambiguous. Requires protocol change to fix — tracked in v2 scope.
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
    const stack = err instanceof Error ? err.stack : String(err);
    console.error(`[hookwatch] Unexpected error:\n${stack}`);
    if (wrapArgs !== null) {
      // In wrapped mode: do NOT call exitFatal() — exit 0 would suppress the
      // child's exit code. Exit 1 signals hookwatch itself crashed (not the child).
      process.exit(1);
    }
    exitFatal(`Unexpected error: ${errorMsg(err)}`);
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
