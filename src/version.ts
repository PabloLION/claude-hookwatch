/**
 * Application version — single source of truth read from package.json.
 *
 * Bun supports JSON imports natively. Importing package.json directly keeps the
 * version in sync with what is published via npm/bun publish, without any
 * build step or file-read at runtime.
 */

import pkg from '../package.json' with { type: 'json' };

/** Semantic version string from package.json (e.g. "0.1.0"). */
export const VERSION: string = pkg.version;
