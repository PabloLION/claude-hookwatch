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

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { defineCommand } from "citty";
import { description, name, version } from "../../package.json";
import { EVENT_TYPES } from "./events.ts";

/** Absolute path to the package root (where package.json lives). */
const PACKAGE_ROOT = resolve(import.meta.dir, "../..");

/**
 * Generates the content for .claude-plugin/plugin.json.
 */
function buildPluginJson(): string {
  return JSON.stringify(
    {
      name,
      version,
      description,
      author: { name: "PabloLION" },
    },
    null,
    2,
  );
}

/**
 * Generates the content for hooks/hooks.json.
 * Each event type maps to a command `hookwatch <EventType>`.
 */
function buildHooksJson(): string {
  const hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>> = {};

  for (const eventType of EVENT_TYPES) {
    hooks[eventType] = [
      {
        hooks: [
          {
            type: "command",
            command: `hookwatch ${eventType}`,
          },
        ],
      },
    ];
  }

  return JSON.stringify({ hooks }, null, 2);
}

/**
 * Checks whether `hookwatch` is already installed (reachable on PATH).
 * Returns true if already installed.
 */
async function isAlreadyInstalled(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "hookwatch"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Runs `bun link` in the package root directory.
 * Returns true on success.
 */
async function runBunLink(dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log("[dry-run] Would run: bun link");
    return true;
  }

  const proc = Bun.spawn(["bun", "link"], {
    cwd: PACKAGE_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;
  return exitCode === 0;
}

export const installCommand = defineCommand({
  meta: {
    name: "install",
    description: "Install or upgrade the hookwatch Claude Code plugin",
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

    // Check if already installed — warn but proceed (reinstall)
    const alreadyInstalled = await isAlreadyInstalled();
    if (alreadyInstalled) {
      console.warn(
        "[hookwatch] Already installed — reinstalling to upgrade to the current version.",
      );
    }

    // 1. Generate .claude-plugin/plugin.json
    const pluginDir = join(PACKAGE_ROOT, ".claude-plugin");
    const pluginJsonPath = join(pluginDir, "plugin.json");
    const pluginJsonContent = buildPluginJson();

    if (dryRun) {
      console.log(`[dry-run] Would write ${pluginJsonPath}:`);
      console.log(pluginJsonContent);
    } else {
      if (!existsSync(pluginDir)) {
        mkdirSync(pluginDir, { recursive: true });
      }
      writeFileSync(pluginJsonPath, `${pluginJsonContent}\n`, "utf8");
      console.log(`Wrote ${pluginJsonPath}`);
    }

    // 2. Generate hooks/hooks.json
    const hooksDir = join(PACKAGE_ROOT, "hooks");
    const hooksJsonPath = join(hooksDir, "hooks.json");
    const hooksJsonContent = buildHooksJson();

    if (dryRun) {
      console.log(`[dry-run] Would write ${hooksJsonPath}:`);
      console.log(hooksJsonContent);
    } else {
      if (!existsSync(hooksDir)) {
        mkdirSync(hooksDir, { recursive: true });
      }
      writeFileSync(hooksJsonPath, `${hooksJsonContent}\n`, "utf8");
      console.log(`Wrote ${hooksJsonPath}`);
    }

    // 3. Run bun link
    const linkOk = await runBunLink(dryRun);
    if (!linkOk) {
      process.stderr.write("[hookwatch] bun link failed\n");
      process.exit(1);
    }

    if (!dryRun) {
      console.log("");
      console.log("hookwatch installed successfully!");
      console.log("");
      console.log("Next steps:");
      console.log(`  Add to Claude Code with:\n    claude --plugin-dir ${PACKAGE_ROOT}`);
      console.log("  Or open the web UI:\n    hookwatch ui");
    } else {
      console.log("[dry-run] Install preview complete — no changes made.");
    }
  },
});
