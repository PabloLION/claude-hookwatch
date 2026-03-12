/**
 * Configurable defaults for hookwatch.
 *
 * These constants will be overridable via config.toml when ch-1ex5.1 lands.
 * Until then they serve as the single source of truth for all default values.
 */

/** Default server port. */
export const DEFAULT_PORT = 6004;

/** Server idle timeout before self-termination (ms). */
export const IDLE_TIMEOUT_MS = 3_600_000; // 1 hour

/** Default event query limit for the UI. */
export const DEFAULT_QUERY_LIMIT = 100;
