/**
 * Shared error utility helpers for hookwatch.
 *
 * TypeScript catch clauses type the caught value as `unknown`. The errorMsg()
 * helper centralises the `err instanceof Error ? err.message : String(err)`
 * pattern used throughout the codebase.
 */

/**
 * Extracts a human-readable message from an unknown thrown value.
 */
export function errorMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
