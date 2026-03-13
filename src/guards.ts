/**
 * Shared type guards used across multiple hookwatch modules.
 */

/** Narrows an unknown caught value to NodeJS.ErrnoException. */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
