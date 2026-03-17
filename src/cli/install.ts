/**
 * hookwatch install command.
 *
 * Generates plugin files (.claude-plugin/plugin.json, hooks/hooks.json) and
 * runs `bun link` to register the `hookwatch` binary globally.
 *
 * If already installed (binary accessible), warns and reinstalls rather than
 * erroring.
 *
 * Options:
 *   --dry-run / -n  — preview without writing files or running bun link
 */

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineCommand } from 'citty';
import { errorMsg } from '@/errors.ts';
import { description, name, version } from '../../package.json';
import { PACKAGE_ROOT } from './paths.ts';
import { buildHooksJson, buildPluginJson } from './plugin-files.ts';

/**
 * Checks whether `hookwatch` is already installed (reachable on PATH).
 * Returns true if already installed.
 */
async function isAlreadyInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', 'hookwatch'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch (err) {
    console.warn(`[hookwatch] Could not check existing install: ${errorMsg(err)}`);
    return false;
  }
}

/**
 * Runs `bun link` in the package root directory.
 * Returns true on success.
 */
async function runBunLink(dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log('[dry-run] Would run: bun link');
    return true;
  }

  const proc = Bun.spawn(['bun', 'link'], {
    cwd: PACKAGE_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

/**
 * Writes content to a file, creating parent directories as needed.
 * In dry-run mode, logs what would be written and returns without touching the filesystem.
 * On write failure, prints to stderr and exits with code 1.
 */
async function writeFileOrExit(filePath: string, content: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] Would write ${filePath}:`);
    console.log(content);
    return;
  }
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    await Bun.write(filePath, content);
    console.log(`Wrote ${filePath}`);
  } catch (err) {
    process.stderr.write(`[hookwatch] Failed to write ${filePath}: ${errorMsg(err)}\n`);
    process.exit(1);
  }
}

export const installCommand = defineCommand({
  meta: {
    name: 'install',
    description: 'Install or upgrade the hookwatch Claude Code plugin',
  },
  args: {
    'dry-run': {
      type: 'boolean',
      alias: 'n',
      description: 'Preview what would be done without making changes',
      default: false,
    },
  },
  async run({ args }) {
    const dryRun = args['dry-run'];

    // Check if already installed — warn but proceed (reinstall)
    const alreadyInstalled = await isAlreadyInstalled();
    if (alreadyInstalled) {
      console.warn(
        '[hookwatch] Already installed — reinstalling to upgrade to the current version.',
      );
    }

    // 1. Generate .claude-plugin/plugin.json
    const pluginJsonPath = join(PACKAGE_ROOT, '.claude-plugin', 'plugin.json');
    const pluginJsonContent = `${JSON.stringify(buildPluginJson({ name, version, description }), null, 2)}\n`;
    await writeFileOrExit(pluginJsonPath, pluginJsonContent, dryRun);

    // 2. Generate hooks/hooks.json
    const hooksJsonPath = join(PACKAGE_ROOT, 'hooks', 'hooks.json');
    const hooksJsonContent = `${JSON.stringify({ hooks: buildHooksJson() }, null, 2)}\n`;
    await writeFileOrExit(hooksJsonPath, hooksJsonContent, dryRun);

    // 3. Run bun link
    const linkOk = await runBunLink(dryRun);
    if (!linkOk) {
      process.stderr.write('[hookwatch] bun link failed\n');
      process.exit(1);
    }

    if (dryRun) {
      console.log('[dry-run] Install preview complete — no changes made.');
    } else {
      console.log('');
      console.log('hookwatch installed successfully!');
      console.log('');
      console.log('Next steps:');
      console.log(`  Add to Claude Code with:\n    claude --plugin-dir ${PACKAGE_ROOT}`);
      console.log('  Or open the web UI:\n    hookwatch ui');
    }
  },
});
