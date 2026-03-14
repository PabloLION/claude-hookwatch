/**
 * Error utility helpers for the hookwatch handler.
 *
 * Re-exports errorMsg() from the shared @/errors module so handler code can
 * import from a local path without changing all handler import sites.
 */
export { errorMsg } from '@/errors.ts';
