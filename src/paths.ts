/**
 * Central path resolution for hookwatch.
 *
 * All file paths that hookwatch reads or writes go through this module.
 * Respects $XDG_DATA_HOME and $XDG_CONFIG_HOME; falls back to XDG defaults.
 */

import { readFileSync } from "node:fs";

/** The fixed default port for the hookwatch server.
 * The server binds exclusively to this port and errors if it is occupied.
 * TODO: configurable via config.toml (ch-1ex5.1)
 */
export const DEFAULT_PORT = 6004;

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`;
}

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME ?? `${process.env.HOME}/.config`;
}

/** SQLite database: ~/.local/share/hookwatch/hookwatch.db */
export function dbPath(): string {
  return `${xdgDataHome()}/hookwatch/hookwatch.db`;
}

/** Port file written by server, read by handler: ~/.local/share/hookwatch/hookwatch.port */
export function portFilePath(): string {
  return `${xdgDataHome()}/hookwatch/hookwatch.port`;
}

/** Server log file: ~/.local/share/hookwatch/server.log */
export function serverLogPath(): string {
  return `${xdgDataHome()}/hookwatch/server.log`;
}

/** TOML config file: ~/.config/hookwatch/config.toml */
export function configPath(): string {
  return `${xdgConfigHome()}/hookwatch/config.toml`;
}

// ---------------------------------------------------------------------------
// Port file reading
// ---------------------------------------------------------------------------

export interface ReadPortResult {
  port: number;
  /** Non-null when the port file was unreadable due to a non-ENOENT OS error. */
  warning: string | null;
}

/**
 * Reads the server port from the port file written by the server on startup.
 *
 * Falls back to DEFAULT_PORT silently on ENOENT (file not yet written).
 * Invalid/corrupt content → falls back to DEFAULT_PORT + logs warning.
 * Other OS errors (EACCES, EIO, etc.) → falls back to DEFAULT_PORT and
 * returns a warning string for the caller to record.
 */
export function readPort(): ReadPortResult {
  try {
    const content = readFileSync(portFilePath(), "utf8").trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) {
      console.error(
        `[hookwatch] Port file contained invalid value "${content}", using fallback ${DEFAULT_PORT}`,
      );
      return { port: DEFAULT_PORT, warning: null };
    }
    return { port, warning: null };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // File absent — server not started yet or running on default port
      return { port: DEFAULT_PORT, warning: null };
    }
    // Unexpected OS error (EACCES, EIO, etc.) — log and fall back
    const msg = `Port file unreadable (${code ?? "unknown"}), using DEFAULT_PORT`;
    console.error(`[hookwatch] ${msg}`);
    return { port: DEFAULT_PORT, warning: msg };
  }
}
