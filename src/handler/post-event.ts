/**
 * Server communication for the hookwatch handler.
 *
 * Exports postEvent() — POSTs a hook event to the local server, auto-starting
 * it if not reachable.
 */

import { isErrnoException } from '@/guards.ts';
import type { parseHookEvent } from '@/schemas/events.ts';
import type { SpawnResult } from '@/server-spawn.ts';
import { spawnServer } from '@/server-spawn.ts';
import { VERSION } from '@/version.ts';
import { errorMsg } from './errors.ts';

const FETCH_TIMEOUT_MS = 5000;

/** Common fields shared by both bare and wrapped event payloads. */
interface BaseEventPayload {
  event: ReturnType<typeof parseHookEvent>;
  /** Hookwatch processing overhead in ms (excludes child process wall time). */
  hookDurationMs: number | null;
  /** Accumulated non-fatal hookwatch log entries; null = no entries. */
  hookwatchLog: string | null;
}

/**
 * Payload for bare mode: no child process was spawned.
 * stdout stores the hook output JSON (what Claude Code sees).
 * exit_code is always 0 (bare mode never exits non-zero).
 */
export interface BareEventPayload extends BaseEventPayload {
  mode: 'bare';
  /** Hook output JSON written to stdout — what Claude Code sees. */
  stdout: string;
}

/**
 * Payload for wrapped mode: a child process was spawned and its I/O captured.
 * exit_code reflects the child's actual exit code.
 */
export interface WrappedEventPayload extends BaseEventPayload {
  mode: 'wrapped';
  /** Command string to store in wrapped_command column. */
  wrappedCommand: string;
  /** Captured child stdout. */
  stdout: string;
  /** Captured child stderr. */
  stderr: string;
  /** Child exit code (pass-through from wrapped command). */
  exitCode: number;
}

/** Discriminated union for postEvent() payload — bare vs wrapped mode. */
export type EventPostPayload = BareEventPayload | WrappedEventPayload;

const CONNECTION_ERROR_PATTERNS = [
  'connection refused',
  'econnrefused',
  'unable to connect',
  'failed to fetch',
  'fetch failed',
] as const;

/**
 * Returns true if the error message (lowercased) matches a known connection
 * refusal pattern.
 */
function matchesConnectionMessage(msg: string): boolean {
  return CONNECTION_ERROR_PATTERNS.some((pattern) => msg.includes(pattern));
}

/**
 * Returns true if the error indicates the server is not reachable (connection
 * refused, network error, etc.) — these are the cases where we should attempt
 * to auto-start the server and retry.
 *
 * Exported for unit testing. Not part of the public module API.
 */
export function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Bun surfaces connection refusals with code "ConnectionRefused" and a
  // message like "Unable to connect. Is the computer able to access the url?"
  // Node.js uses code "ECONNREFUSED". Both are handled here.
  const code = isErrnoException(err) ? err.code : undefined;
  if (code === 'ConnectionRefused' || code === 'ECONNREFUSED') return true;
  return matchesConnectionMessage(err.message.toLowerCase());
}

/** Result returned by postEvent(). */
export interface PostEventResult {
  ok: boolean;
  /**
   * Distinguishes failure paths for programmatic dispatch in the caller.
   * Only present when ok: false.
   *
   * 'spawn'     — Bun.spawn() failed to start the server process.
   * 'retry'     — Server was spawned but health probe timed out.
   * 'http'      — Server returned a non-2xx HTTP response.
   * 'exception' — Non-connection exception (e.g. fetch timeout, abort).
   *
   * 'spawn' and 'retry' indicate infrastructure broken → fatal.
   * 'http' and 'exception' are transient → non-fatal.
   */
  failureKind?: 'spawn' | 'retry' | 'http' | 'exception';
  failureReason?: string;
  detail?: string;
  /**
   * Version mismatch log entry if the server's X-Hookwatch-Version header
   * differs from this handler's VERSION. Present even when ok: true.
   * Caller should push this into logEntries so it appears in systemMessage.
   */
  versionMismatchLog?: string;
}

/**
 * Checks the X-Hookwatch-Version response header against the handler's own
 * VERSION. Returns an [error]-prefixed log entry string if they differ, or
 * undefined if versions match or the header is absent.
 *
 * A missing header is silently ignored — older servers or test servers may
 * not send it, and we don't want spurious errors in those cases.
 */
function checkVersionHeader(res: Response): string | undefined {
  const serverVersion = res.headers.get('X-Hookwatch-Version');
  if (serverVersion === null || serverVersion === VERSION) return undefined;
  return `[error] Version mismatch: handler v${VERSION}, server v${serverVersion} — update hookwatch`;
}

/**
 * Typed mapping from WrappedEventPayload-specific camelCase fields to their
 * snake_case wire names.
 *
 * Keys are constrained to exactly the fields that WrappedEventPayload adds
 * over BaseEventPayload (plus 'mode' which is structural, not a wire field).
 * The TypeScript compiler errors here if a new field is added to
 * WrappedEventPayload without a corresponding snake_case mapping.
 *
 * Fields already snake_case (stdout, stderr) map to themselves.
 */
const WRAPPED_FIELD_MAP: Record<
  Exclude<keyof WrappedEventPayload, keyof BaseEventPayload | 'mode'>,
  string
> = {
  wrappedCommand: 'wrapped_command',
  stdout: 'stdout',
  stderr: 'stderr',
  exitCode: 'exit_code',
};

/**
 * Builds the JSON body for the /api/events POST request from the typed payload.
 * Port is transport-level — not included in the body.
 */
function buildRequestBody(opts: EventPostPayload): string {
  const body: Record<string, unknown> = { ...opts.event };
  if (opts.mode === 'wrapped') {
    for (const [camel, snake] of Object.entries(WRAPPED_FIELD_MAP) as [
      keyof typeof WRAPPED_FIELD_MAP,
      string,
    ][]) {
      body[snake] = opts[camel];
    }
  } else {
    // Bare mode: stdout is the hook output JSON; exit_code is always 0
    body.stdout = opts.stdout;
    body.exit_code = 0;
  }
  if (opts.hookDurationMs !== null) {
    body.hook_duration_ms = opts.hookDurationMs;
  }
  if (opts.hookwatchLog !== null) {
    body.hookwatch_log = opts.hookwatchLog;
  }
  return JSON.stringify(body);
}

/**
 * POSTs the event to the server at the given port.
 *
 * Port is passed separately from the payload — it belongs to transport, not
 * to the event data.
 *
 * If the server is not reachable, attempts to spawn it automatically, then
 * retries the POST with the discovered port.
 *
 * Returns { ok: true } on success or { ok: false, failureKind, failureReason,
 * detail } on any unrecoverable error. Never throws.
 *
 * failureKind distinguishes fatal vs non-fatal failures:
 *   'spawn' | 'retry' — infrastructure broken → caller should exitFatal()
 *   'http' | 'exception' — transient → caller appends to logEntries
 *
 * When ok: true, versionMismatchLog may also be set if the server's version
 * differs from the handler's — caller should push it into logEntries.
 */
export async function postEvent(port: number, opts: EventPostPayload): Promise<PostEventResult> {
  const payload = buildRequestBody(opts);

  // First attempt
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(unreadable)');
      const failureReason = `Server returned HTTP ${res.status}`;
      console.error(`[hookwatch] ${failureReason}: ${text}`);
      return { ok: false, failureKind: 'http', detail: text, failureReason };
    }

    const versionMismatchLog = checkVersionHeader(res);
    if (versionMismatchLog !== undefined) {
      console.error(`[hookwatch] ${versionMismatchLog}`);
    }
    return { ok: true, ...(versionMismatchLog !== undefined && { versionMismatchLog }) };
  } catch (err) {
    if (!isConnectionError(err)) {
      // Non-connection error (e.g. timeout, abort) — don't attempt spawn
      const detail = errorMsg(err);
      const failureReason = 'Failed to POST event to server';
      console.error(`[hookwatch] ${failureReason}: ${detail}`);
      return { ok: false, failureKind: 'exception', failureReason, detail };
    }
  }

  // Server not reachable — attempt to spawn it
  console.error('[hookwatch] Server not reachable, attempting to start it...');
  const spawnResult: SpawnResult = await spawnServer();

  if (!spawnResult.ok) {
    const { failureKind } = spawnResult;
    const failureReason =
      failureKind === 'spawn'
        ? 'Spawn failed — server process could not be started'
        : 'Spawn failed — server did not become healthy in time';
    console.error(`[hookwatch] ${failureReason}`);
    return { ok: false, failureKind, failureReason };
  }

  // Retry POST with the port returned by the health check
  const { port: spawnedPort } = spawnResult;
  try {
    const res = await fetch(`http://127.0.0.1:${spawnedPort}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '(unreadable)');
      const failureReason = `Retry exhausted — server returned HTTP ${res.status}`;
      console.error(`[hookwatch] ${failureReason}: ${text}`);
      return { ok: false, failureKind: 'http', detail: text, failureReason };
    }

    const versionMismatchLog = checkVersionHeader(res);
    if (versionMismatchLog !== undefined) {
      console.error(`[hookwatch] ${versionMismatchLog}`);
    }
    return { ok: true, ...(versionMismatchLog !== undefined && { versionMismatchLog }) };
  } catch (err) {
    const detail = errorMsg(err);
    const failureReason = 'Retry exhausted — failed to POST event to server after spawn';
    console.error(`[hookwatch] ${failureReason}: ${detail}`);
    return { ok: false, failureKind: 'exception', failureReason, detail };
  }
}
