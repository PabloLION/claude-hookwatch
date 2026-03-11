/**
 * Thin entry point for hookwatch hook handler.
 *
 * Used when running hookwatch in dev mode with `claude --plugin-dir`:
 *   bun hooks/handler.ts
 *
 * This file just re-runs the handler logic from src/handler/index.ts.
 * The actual handler reads stdin, validates the event, and POSTs to the server.
 */

import '../src/handler/index.ts';
