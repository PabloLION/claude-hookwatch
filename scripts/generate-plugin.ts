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

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildHooksJson, buildPluginJson } from '../src/cli/plugin-files.ts';

// Resolve package root (one level up from scripts/)
const PACKAGE_ROOT = resolve(import.meta.dir, '..');
const pkgJson = (await Bun.file(join(PACKAGE_ROOT, 'package.json')).json()) as {
  name: string;
  version: string;
  description: string;
};

/**
 * Writes a file, creating parent directories as needed.
 */
async function writeFile(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  await Bun.write(filePath, content);
  console.log(`Generated: ${filePath}`);
}

// ---------------------------------------------------------------------------
// .claude-plugin/plugin.json
// ---------------------------------------------------------------------------

await writeFile(
  join(PACKAGE_ROOT, '.claude-plugin', 'plugin.json'),
  `${JSON.stringify(buildPluginJson(pkgJson), null, 2)}\n`,
);

// ---------------------------------------------------------------------------
// hooks/hooks.json
// ---------------------------------------------------------------------------

await writeFile(
  join(PACKAGE_ROOT, 'hooks', 'hooks.json'),
  `${JSON.stringify({ hooks: buildHooksJson() }, null, 2)}\n`,
);

console.log('Plugin files generated successfully.');
