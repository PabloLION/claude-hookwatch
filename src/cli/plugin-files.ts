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
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: { readonly name: string };
}

/**
 * Builds the content object for .claude-plugin/plugin.json.
 * Version and metadata are provided by the caller (typically from package.json).
 */
export function buildPluginJson(pkg: PluginJsonInput): PluginManifest {
  return {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    author: { name: 'PabloLION' },
  };
}

interface HookEntry {
  readonly type: 'command';
  readonly command: string;
}

interface HookMatcher {
  readonly hooks: readonly HookEntry[];
}

type HooksJsonConfig = Record<string, readonly HookMatcher[]>;

/**
 * Builds the content object for hooks/hooks.json.
 * Each event type maps to a command `hookwatch <EventType>`.
 *
 * The `eventTypes` parameter defaults to the canonical EVENT_TYPES list.
 * Pass a custom list only in tests to inspect a specific subset of entries.
 */
export function buildHooksJson(eventTypes: readonly string[] = EVENT_TYPES): HooksJsonConfig {
  return Object.fromEntries(
    eventTypes.map((e) => [e, [{ hooks: [{ type: 'command', command: `hookwatch ${e}` }] }]]),
  );
}
