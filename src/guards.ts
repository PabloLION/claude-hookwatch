/**
 * Shared type guards used across multiple hookwatch modules.
 */

/** Narrows an unknown caught value to NodeJS.ErrnoException. */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}

/** Narrows unknown to a string-keyed record (excludes arrays and null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
