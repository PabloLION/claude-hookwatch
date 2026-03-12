/**
 * Signal-to-exit-code utilities for the hookwatch handler.
 *
 * When a child process is killed by a signal, Bun returns null for the exit
 * code. The POSIX convention is to report 128+N as the exit code for signal N.
 * This module translates signal names to their conventional exit codes and
 * provides human-readable labels for diagnostics.
 *
 * Signal numbers are read from os.constants.signals at runtime so the correct
 * platform values are used (macOS and Linux differ for several signals).
 *
 * The "likely" qualifier is intentional — the 128+N convention is ambiguous:
 * a program CAN deliberately exit with a value above 128 without being killed
 * by a signal.
 */

import { constants as osConstants } from 'node:os';

/**
 * Lookup table: signal name → number, populated once at module load.
 * os.constants.signals is typed as { [key in NodeJS.Signals]: number } —
 * assignable to Record<string, number> without a cast since signal names
 * are string literal subtypes.
 */
const SIGNAL_NUMBERS: Readonly<Record<string, number>> = osConstants.signals;

/**
 * Converts a signal name to its conventional 128+N exit code.
 *
 * Returns 128+N when the signal number is known.
 * Returns 1 as a last-resort fallback when the signal is unrecognised — this
 * is the only place in hookwatch where exit code 1 is acceptable output,
 * because the alternative (null/0) would be misleading about what happened.
 *
 * @param signal - Signal name string from proc.signalCode (e.g. "SIGKILL"),
 *   or null if the signal is unknown.
 */
export function signalExitCode(signal: string | null): number {
  if (signal === null) return 1;
  const num = SIGNAL_NUMBERS[signal];
  if (typeof num === 'number') return 128 + num;
  // Unknown signal name — fall back to 1 (unavoidable last resort)
  return 1;
}

/**
 * Returns a human-readable description for a signal-derived exit code, or
 * null if the code does not correspond to a known signal death.
 *
 * The description uses "likely" because programs can deliberately exit with
 * values above 128 without being signal-killed.
 *
 * @param code - Exit code to describe (e.g. 137 → "likely SIGKILL — forced
 *   termination", 143 → "likely SIGTERM — graceful shutdown request").
 */
export function describeExitCode(code: number): string | null {
  if (code <= 128) return null;
  const signalNum = code - 128;
  // Build reverse map on demand (called infrequently — no need to precompute)
  for (const [name, num] of Object.entries(SIGNAL_NUMBERS)) {
    if (num === signalNum) {
      const label = SIGNAL_LABELS[name] ?? 'signal termination';
      return `likely ${name} — ${label}`;
    }
  }
  return `likely signal ${signalNum} — signal termination`;
}

/**
 * Human-readable labels for common signals relevant to the hookwatch context.
 * Unlisted signals fall back to "signal termination".
 */
const SIGNAL_LABELS: Readonly<Record<string, string>> = {
  SIGKILL: 'forced termination',
  SIGTERM: 'graceful shutdown request',
  SIGINT: 'interrupt (Ctrl+C)',
  SIGABRT: 'assertion failure',
  SIGSEGV: 'segmentation fault (native crash)',
  SIGPIPE: 'broken pipe',
  SIGHUP: 'hangup (terminal closed)',
  SIGBUS: 'bus error',
  SIGFPE: 'floating point exception',
  SIGILL: 'illegal instruction',
};
