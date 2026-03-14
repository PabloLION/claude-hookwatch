/**
 * Central path resolution for hookwatch.
 *
 * All file paths that hookwatch reads or writes go through this module.
 * Respects $XDG_DATA_HOME and $XDG_CONFIG_HOME; falls back to XDG defaults.
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_PORT } from '@/config.ts';
import { isErrnoException } from '@/guards.ts';

/** Maximum valid TCP port number. */
export const MAX_PORT = 65535;

function xdgDataHome(): string {
  if (process.env.XDG_DATA_HOME !== undefined) return process.env.XDG_DATA_HOME;
  if (process.env.HOME === undefined) {
    throw new Error(
      'Neither XDG_DATA_HOME nor HOME environment variable is set — cannot resolve data directory',
    );
  }
  return `${process.env.HOME}/.local/share`;
}

function xdgConfigHome(): string {
  if (process.env.XDG_CONFIG_HOME !== undefined) return process.env.XDG_CONFIG_HOME;
  if (process.env.HOME === undefined) {
    throw new Error(
      'Neither XDG_CONFIG_HOME nor HOME environment variable is set — cannot resolve config directory',
    );
  }
  return `${process.env.HOME}/.config`;
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
  readonly port: number;
  /** Non-null when the port file was unreadable due to a non-ENOENT OS error. */
  readonly warning: string | null;
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
    const content = readFileSync(portFilePath(), 'utf8').trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > MAX_PORT) {
      return {
        port: DEFAULT_PORT,
        warning: `Port file contained invalid value "${content}", using DEFAULT_PORT`,
      };
    }
    return { port, warning: null };
  } catch (err) {
    const code = isErrnoException(err) ? err.code : undefined;
    if (code === 'ENOENT') {
      // File absent — server not started yet or running on default port
      return { port: DEFAULT_PORT, warning: null };
    }
    // Unexpected OS error (EACCES, EIO, etc.) — log and fall back
    const msg = `Port file unreadable (${code ?? 'unknown'}), using DEFAULT_PORT`;
    console.error(`[hookwatch] ${msg}`);
    return { port: DEFAULT_PORT, warning: msg };
  }
}
