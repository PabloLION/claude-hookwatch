/**
 * Shared type guards used across multiple hookwatch domains.
 *
 * Type placement rule: 2+ domains → move to shared. These guards are used
 * in handler, server, CLI, UI, and schema modules.
 */

/**
 * Type guard: narrows an unknown caught value to NodeJS.ErrnoException.
 * Checks that it's an Error instance with a `code` property — the two
 * distinguishing traits of ErrnoException over plain Error.
 */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Type guard: narrows unknown to a string-keyed record.
 * Moved from src/schemas/events.ts (was private) to shared location — used
 * in schemas, server, handler, and UI modules.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
