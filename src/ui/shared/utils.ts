/**
 * Shared UI utility functions used across multiple components.
 *
 * ch-u88: no innerHTML — this module does not render HTML.
 */

/**
 * Check if a nullable string field has non-empty content.
 * Type guard: narrows null | undefined | string to string.
 */
export function hasContent(value: string | null | undefined): value is string {
  return value != null && value.length > 0;
}
