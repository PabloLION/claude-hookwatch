/**
 * Shared builders for hookwatch plugin manifest files.
 *
 * Used by:
 *   src/cli/install.ts   — CLI install command (writes files at install time)
 *   scripts/generate-plugin.ts — pre-commit generation script
 *
 * Both callers produce identical output. Keeping the logic here avoids drift
 * between the two generation paths.
 */

import { EVENT_TYPES } from './events.ts';

export interface PluginJsonInput {
  name: string;
  version: string;
  description: string;
}

/**
 * Builds the content object for .claude-plugin/plugin.json.
 * Version is read from the caller (package.json at import time).
 */
export function buildPluginJson(pkg: PluginJsonInput): object {
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: { name: 'PabloLION' },
  };
}

/**
 * Builds the content object for hooks/hooks.json.
 * Each event type maps to a command `hookwatch <EventType>`.
 *
 * The `eventTypes` parameter defaults to the canonical EVENT_TYPES list.
 * Pass a custom list only in tests to inspect a specific subset of entries.
 */
export function buildHooksJson(
  eventTypes: readonly string[] = EVENT_TYPES,
): Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> {
  const hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> = {};

  for (const eventType of eventTypes) {
    hooks[eventType] = [
      {
        hooks: [
          {
            type: 'command',
            command: `hookwatch ${eventType}`,
          },
        ],
      },
    ];
  }

  return hooks;
}
