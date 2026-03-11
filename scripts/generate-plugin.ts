/**
 * generate-plugin.ts — generates plugin manifest files for hookwatch.
 *
 * Outputs:
 *   .claude-plugin/plugin.json  — plugin manifest with version from package.json
 *   hooks/hooks.json            — hook registration for all 18 event types
 *
 * Usage:
 *   bun scripts/generate-plugin.ts
 *
 * Called automatically by the `generate` npm script.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { EVENT_NAMES } from '../src/types.ts';

// Resolve package root (one level up from scripts/)
const PACKAGE_ROOT = resolve(import.meta.dir, '..');
const pkgJson = (await Bun.file(join(PACKAGE_ROOT, 'package.json')).json()) as {
  name: string;
  version: string;
  description: string;
};

/** All PascalCase event types registered in hooks.json. Single source of truth: src/types.ts. */
const EVENT_TYPES = EVENT_NAMES;

/**
 * Writes a file, creating parent directories as needed.
 */
function writeFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, content, 'utf8');
  console.log(`Generated: ${filePath}`);
}

// ---------------------------------------------------------------------------
// .claude-plugin/plugin.json
// ---------------------------------------------------------------------------

const pluginJson = {
  name: pkgJson.name,
  version: pkgJson.version,
  description: pkgJson.description,
  author: { name: 'PabloLION' },
};

writeFile(
  join(PACKAGE_ROOT, '.claude-plugin', 'plugin.json'),
  `${JSON.stringify(pluginJson, null, 2)}\n`,
);

// ---------------------------------------------------------------------------
// hooks/hooks.json
// ---------------------------------------------------------------------------

const hooksRecord: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> = {};

for (const eventType of EVENT_TYPES) {
  hooksRecord[eventType] = [
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

const hooksJson = { hooks: hooksRecord };

writeFile(join(PACKAGE_ROOT, 'hooks', 'hooks.json'), `${JSON.stringify(hooksJson, null, 2)}\n`);

console.log('Plugin files generated successfully.');
