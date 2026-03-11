/**
 * Server communication for the hookwatch handler.
 *
 * Exports postEvent() — POSTs a hook event to the local server, auto-starting
 * it if not reachable.
 */

import type { parseHookEvent } from "@/schemas/events.ts";
import { errorMsg } from "./errors.ts";
import { spawnServer } from "./spawn.ts";

const FETCH_TIMEOUT_MS = 5000;

/** Payload for postEvent — extends the base event with optional wrap metadata. */
export interface EventPostPayload {
  port: number;
  event: ReturnType<typeof parseHookEvent>;
  /** Command string to store in wrapped_command column; null for bare mode. */
  wrappedCommand: string | null;
  /** Captured child stdout; null for bare mode. */
  stdout: string | null;
  /** Captured child stderr; null for bare mode. */
  stderr: string | null;
  /** Child exit code; 0 for bare mode. */
  exitCode: number;
  /** Hookwatch processing overhead in ms (excludes child process wall time). */
  hookDurationMs: number | null;
  /** Accumulated non-fatal hookwatch log entries; null = no entries. */
  hookwatchLog: string | null;
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
  const code = (err as NodeJS.ErrnoException).code ?? "";
  const msg = err.message.toLowerCase();
  return (
    code === "ConnectionRefused" ||
    code === "ECONNREFUSED" ||
    msg.includes("connection refused") ||
    msg.includes("econnrefused") ||
    msg.includes("unable to connect") ||
    msg.includes("failed to fetch") ||
    msg.includes("fetch failed")
  );
}

/** Result returned by postEvent(). */
export interface PostEventResult {
  ok: boolean;
  failureReason?: string;
  detail?: string;
}

/**
 * POSTs the event to the server at the given port.
 *
 * If the server is not reachable, attempts to spawn it automatically, then
 * retries the POST with the discovered port.
 *
 * Returns { ok: true } on success or { ok: false, failureReason, detail } on
 * any unrecoverable error. Never throws. Failures are non-fatal — the caller
 * stores failureReason in hookwatch_log and systemMessage and continues.
 */
export async function postEvent(opts: EventPostPayload): Promise<PostEventResult> {
  const body: Record<string, unknown> = { ...opts.event };
  if (opts.wrappedCommand !== null) {
    body.wrapped_command = opts.wrappedCommand;
  }
  if (opts.stdout !== null) {
    body.stdout = opts.stdout;
  }
  if (opts.stderr !== null) {
    body.stderr = opts.stderr;
  }
  body.exit_code = opts.exitCode;
  if (opts.hookDurationMs !== null) {
    body.hook_duration_ms = opts.hookDurationMs;
  }
  if (opts.hookwatchLog !== null) {
    body.hookwatch_log = opts.hookwatchLog;
  }
  const payload = JSON.stringify(body);

  // First attempt
  try {
    const res = await fetch(`http://127.0.0.1:${opts.port}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      const failureReason = `Server returned HTTP ${res.status}`;
      console.error(`[hookwatch] ${failureReason}: ${text}`);
      return { ok: false, failureReason, detail: text };
    }

    return { ok: true };
  } catch (err) {
    if (!isConnectionError(err)) {
      // Non-connection error (e.g. timeout, abort) — don't attempt spawn
      const detail = errorMsg(err);
      const failureReason = "Failed to POST event to server";
      console.error(`[hookwatch] ${failureReason}: ${detail}`);
      return { ok: false, failureReason, detail };
    }
  }

  // Server not reachable — attempt to spawn it
  console.error("[hookwatch] Server not reachable, attempting to start it...");
  const spawnedPort = await spawnServer();

  if (spawnedPort === null) {
    const failureReason = "Spawn failed — server did not start";
    console.error(`[hookwatch] ${failureReason}`);
    return { ok: false, failureReason };
  }

  // Retry POST with the port returned by the health check
  try {
    const res = await fetch(`http://127.0.0.1:${spawnedPort}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(unreadable)");
      const failureReason = `Retry exhausted — server returned HTTP ${res.status}`;
      console.error(`[hookwatch] ${failureReason}: ${text}`);
      return { ok: false, failureReason, detail: text };
    }

    return { ok: true };
  } catch (err) {
    const detail = errorMsg(err);
    const failureReason = "Retry exhausted — failed to POST event to server after spawn";
    console.error(`[hookwatch] ${failureReason}: ${detail}`);
    return { ok: false, failureReason, detail };
  }
}
