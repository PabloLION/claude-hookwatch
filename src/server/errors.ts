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

export type ErrorCode = "DB_LOCKED" | "NOT_FOUND" | "INVALID_QUERY" | "INTERNAL";

export function errorResponse(code: ErrorCode, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}
