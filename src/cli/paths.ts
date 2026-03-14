/**
 * Path constants for the hookwatch CLI.
 *
 * PACKAGE_ROOT resolves the absolute path to the package root directory
 * (where package.json lives) at import time, relative to this module's
 * location (src/cli/ → ../../).
 */

import { resolve } from 'node:path';

/** Absolute path to the package root (where package.json lives). */
export const PACKAGE_ROOT = resolve(import.meta.dir, '../..');
