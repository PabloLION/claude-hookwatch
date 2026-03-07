/**
 * Error utility helpers for the hookwatch handler.
 */

/**
 * Extracts a human-readable message from an unknown thrown value.
 *
 * TypeScript catch clauses type the caught value as `unknown`. This helper
 * centralises the `err instanceof Error ? err.message : String(err)` pattern
 * used throughout the handler.
 */
export function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
