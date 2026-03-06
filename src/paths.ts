/**
 * Central path resolution for hookwatch.
 *
 * All file paths that hookwatch reads or writes go through this module.
 * Respects $XDG_DATA_HOME and $XDG_CONFIG_HOME; falls back to XDG defaults.
 */

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
