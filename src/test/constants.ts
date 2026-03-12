/**
 * Test-only constants for hookwatch.
 *
 * These values are used across multiple test files. Centralizing them here
 * prevents magic numbers from spreading across the test suite.
 */

/** Expected number of hookwatch event types. */
export const EXPECTED_EVENT_TYPE_COUNT = 18;

/** Port numbers for negative tests (nothing should be listening). */
export const UNUSED_PORT_A = 19999;
export const UNUSED_PORT_B = 19998;
export const UNUSED_PORT_C = 19997;
