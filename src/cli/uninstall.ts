/**
 * hookwatch uninstall command.
 *
 * Reverses install: removes generated plugin files and runs `bun unlink`
 * to deregister the binary.
 *
 * Options:
 *   --dry-run / -n  — preview without removing files or running bun unlink
 */

import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineCommand } from "citty";

/** Absolute path to the package root (where package.json lives). */
const PACKAGE_ROOT = resolve(import.meta.dir, "../..");

/**
 * Runs `bun unlink` in the package root directory.
 * Returns true on success.
 */
async function runBunUnlink(dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log("[dry-run] Would run: bun unlink");
    return true;
  }

  const proc = Bun.spawn(["bun", "unlink"], {
    cwd: PACKAGE_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

/**
 * Removes a file if it exists. Prints what was done.
 */
function removeFile(filePath: string, dryRun: boolean): void {
  if (!existsSync(filePath)) {
    console.log(`  (skip) ${filePath} — not found`);
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] Would remove ${filePath}`);
  } else {
    rmSync(filePath, { force: true });
    console.log(`Removed ${filePath}`);
  }
}

export const uninstallCommand = defineCommand({
  meta: {
    name: "uninstall",
    description: "Uninstall the hookwatch Claude Code plugin",
  },
  args: {
    "dry-run": {
      type: "boolean",
      alias: "n",
      description: "Preview what would be done without making changes",
      default: false,
    },
  },
  async run({ args }) {
    const dryRun = args["dry-run"];

    // 1. Remove .claude-plugin/plugin.json
    const pluginJsonPath = join(PACKAGE_ROOT, ".claude-plugin", "plugin.json");
    removeFile(pluginJsonPath, dryRun);

    // 2. Remove hooks/hooks.json
    const hooksJsonPath = join(PACKAGE_ROOT, "hooks", "hooks.json");
    removeFile(hooksJsonPath, dryRun);

    // 3. Run bun unlink
    const unlinkOk = await runBunUnlink(dryRun);
    if (!unlinkOk) {
      // bun unlink failure is non-fatal — the binary may not have been linked
      process.stderr.write(
        "[hookwatch] bun unlink returned non-zero (may not have been linked — continuing)\n",
      );
    }

    if (!dryRun) {
      console.log("");
      console.log("hookwatch uninstalled.");
      console.log("Note: Claude Code settings.json hooks are not modified automatically.");
      console.log("Remove the plugin entry from your Claude Code settings if needed.");
    } else {
      console.log("[dry-run] Uninstall preview complete — no changes made.");
    }
  },
});
