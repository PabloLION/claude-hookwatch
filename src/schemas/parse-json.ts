/**
 * Shared JSON parsing helper for schema validation boundaries.
 *
 * Both output.ts (handler subprocess stdout) and rows.ts (SSE event data) need
 * to parse a JSON string, producing a descriptive SyntaxError with a 200-char
 * preview on failure.
 */

/** Maximum characters shown in the SyntaxError preview before truncation. */
const PREVIEW_MAX_CHARS = 200;

/**
 * Parses a JSON string, throwing a SyntaxError with a truncated preview on
 * failure.
 *
 * @param input   - The raw JSON string to parse.
 * @param context - Human-readable description of the input source, used in the
 *                  error message (e.g. "handler stdout", "SSE data").
 * @returns The parsed value.
 * @throws SyntaxError if `input` is not valid JSON.
 */
export function parseJsonWithPreview(input: string, context: string): unknown {
  try {
    return JSON.parse(input);
  } catch (err) {
    const preview =
      input.length > PREVIEW_MAX_CHARS ? `${input.slice(0, PREVIEW_MAX_CHARS)}\u2026` : input;
    throw new SyntaxError(`${context} is not valid JSON: ${preview}`, { cause: err });
  }
}
