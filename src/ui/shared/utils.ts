/**
 * Shared UI utility functions used across multiple components.
 *
 * No innerHTML — this module does not render HTML.
 */

/**
 * Check if a nullable string field has non-empty content.
 * Type guard: narrows null | undefined | string to string.
 */
export function hasContent(value: string | null | undefined): value is string {
  return value != null && value.length > 0;
}

/** Try to parse and pretty-print JSON. Falls back to the raw string on failure. */
export function formatJsonForDisplay(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
}
