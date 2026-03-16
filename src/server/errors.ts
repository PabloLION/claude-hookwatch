/**
 * Shared error response helpers.
 *
 * All HTTP error responses in hookwatch follow a single envelope:
 *   { "error": { "code": "<ErrorCode>", "message": "<string>" } }
 *
 * Error codes:
 *   DB_LOCKED     — SQLite SQLITE_BUSY/SQLITE_LOCKED; use HTTP 503
 *   NOT_FOUND     — Resource does not exist; use HTTP 404
 *   INVALID_QUERY — Bad request body or query params; use HTTP 400
 *   INTERNAL      — Unexpected server error; use HTTP 500
 */

import { ZodError } from 'zod';
import { isSqliteBusy } from '@/db/errors.ts';
import { errorMsg } from '@/errors.ts';
import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_ERROR,
  HTTP_NOT_FOUND,
  HTTP_SERVICE_UNAVAILABLE,
} from '@/server/http-status.ts';

export type ErrorCode = 'DB_LOCKED' | 'NOT_FOUND' | 'INVALID_QUERY' | 'INTERNAL';

/**
 * Compile-time mapping from ErrorCode to HTTP status.
 * satisfies Record<ErrorCode, number> ensures every ErrorCode has a status.
 * Adding a new ErrorCode without updating this map is a compile error.
 */
const ERROR_STATUS = {
  DB_LOCKED: HTTP_SERVICE_UNAVAILABLE,
  NOT_FOUND: HTTP_NOT_FOUND,
  INVALID_QUERY: HTTP_BAD_REQUEST,
  INTERNAL: HTTP_INTERNAL_ERROR,
} as const satisfies Record<ErrorCode, number>;

export function errorResponse(code: ErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: ERROR_STATUS[code] });
}

/**
 * Formats a Zod validation error (or unknown error) into an INVALID_QUERY 400 response.
 *
 * Used by ingest and query handlers after a failed Zod parse. If `err` is a
 * ZodError, its issue messages are joined into a human-readable string.
 * Any other thrown value produces a generic "Payload validation failed" message.
 */
export function zodErrorResponse(err: unknown): Response {
  if (err instanceof ZodError) {
    return errorResponse(
      'INVALID_QUERY',
      `Validation failed: ${err.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return errorResponse('INVALID_QUERY', 'Payload validation failed');
}

/**
 * Maps a database error into the appropriate HTTP error response.
 *
 * SQLite BUSY/LOCKED → 503 DB_LOCKED.
 * Any other error    → 500 INTERNAL with the error message.
 */
export function dbErrorResponse(err: unknown): Response {
  if (isSqliteBusy(err)) {
    return errorResponse('DB_LOCKED', 'Database is busy, retry shortly');
  }
  return errorResponse('INTERNAL', errorMsg(err));
}

/**
 * Return type of parseRequestJson.
 * Discriminated union on `ok` so callers narrow with a simple `if (!parsed.ok)` guard.
 */
export type ParseJsonResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly response: Response };

/**
 * Parses a request body as JSON.
 *
 * Returns `{ ok: true, data }` on success, or `{ ok: false, response }` with a
 * 400 INVALID_QUERY response when the body is not valid JSON.
 */
export async function parseRequestJson(req: Request): Promise<ParseJsonResult> {
  try {
    const data = await req.json();
    return { ok: true, data };
  } catch (err) {
    process.stderr.write(`[hookwatch] Failed to parse request JSON: ${errorMsg(err)}\n`);
    return {
      ok: false,
      response: errorResponse('INVALID_QUERY', 'Request body is not valid JSON'),
    };
  }
}
