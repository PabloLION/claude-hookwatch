/**
 * Configurable defaults for hookwatch.
 *
 * These constants are the single source of truth for all default values.
 * A future config.toml override mechanism is planned (ch-1ex5.1) but not yet implemented.
 */

/** Default server port. */
export const DEFAULT_PORT = 6004;

/** Server idle timeout before self-termination (ms). */
export const IDLE_TIMEOUT_MS = 3_600_000; // 1 hour

/** Default event query limit for the UI. */
export const DEFAULT_QUERY_LIMIT = 100;

/** Prefix for the systemMessage injected into Claude Code's context. */
export const SYSTEM_MESSAGE_PREFIX = 'hookwatch captured';

/**
 * Health fetch timeout for server-spawn.ts health probe (ms).
 * Kept short — the handler waits on this before forwarding to Claude Code.
 */
export const SPAWN_HEALTH_TIMEOUT_MS = 500;

/**
 * Health fetch timeout for the CLI `ui` command (ms).
 * CLI context is interactive and less latency-sensitive than the handler path.
 */
export const CLI_HEALTH_TIMEOUT_MS = 1000;
