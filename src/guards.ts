/**
 * Shared type guards used across multiple hookwatch modules.
 */

/** Narrows an unknown caught value to NodeJS.ErrnoException. */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error && 'code' in err && typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}

/**
 * Extract the error code from an unknown thrown value.
 * Bun wraps connection errors: the code may be on err itself or on err.cause.
 * Returns undefined when neither layer carries an errno code.
 */
export function extractErrorCode(err: unknown): string | undefined {
  const outerCode = isErrnoException(err) ? err.code : undefined;
  const cause = err instanceof Error ? err.cause : undefined;
  const innerCode = isErrnoException(cause) ? cause.code : undefined;
  return outerCode ?? innerCode;
}

/** Narrows unknown to a string-keyed record (excludes arrays and null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
