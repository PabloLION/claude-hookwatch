/**
 * Shared DB error helpers.
 *
 * Centralises detection of SQLite runtime errors so callers do not need to
 * duplicate string-matching logic.
 */

/**
 * Returns true when the error is a SQLite SQLITE_BUSY or SQLITE_LOCKED
 * condition. bun:sqlite surfaces these as Error objects whose message contains
 * the SQLite error string.
 */
export function isSqliteBusy(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toUpperCase();
  return msg.includes("SQLITE_BUSY") || msg.includes("SQLITE_LOCKED");
}
