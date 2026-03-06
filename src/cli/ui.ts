/**
 * hookwatch ui command.
 *
 * Checks if the server is running (reads port file). If not running, spawns
 * it using spawnServer() from src/handler/spawn.ts. Then opens the web UI
 * in the system browser.
 *
 * Platform detection:
 *   darwin  — open
 *   linux   — xdg-open
 *   win32   — start (not officially supported but handled gracefully)
 */

import { existsSync, readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { spawnServer } from "@/handler/spawn.ts";
import { portFilePath } from "@/paths.ts";

const HEALTH_FETCH_TIMEOUT_MS = 1000;

/**
 * Reads the port from the port file, or returns null if absent/invalid.
 */
function readPortFile(): number | null {
  const path = portFilePath();
  if (!existsSync(path)) return null;

  try {
    const content = readFileSync(path, "utf8").trim();
    const port = Number.parseInt(content, 10);
    if (Number.isNaN(port) || port <= 0 || port > 65535) return null;
    return port;
  } catch {
    return null;
  }
}

/**
 * Checks if the server at the given port responds to GET /health.
 */
async function isServerRunning(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(HEALTH_FETCH_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Opens a URL in the system default browser.
 * Handles darwin, linux, and win32.
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;

  let command: string;
  if (platform === "darwin") {
    command = "open";
  } else if (platform === "linux") {
    command = "xdg-open";
  } else if (platform === "win32") {
    command = "start";
  } else {
    console.warn(`[hookwatch] Unknown platform "${platform}" — cannot open browser automatically.`);
    console.log(`  Open manually: ${url}`);
    return;
  }

  const proc = Bun.spawn([command, url], {
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;
}

export const uiCommand = defineCommand({
  meta: {
    name: "ui",
    description: "Start the hookwatch server (if needed) and open the web UI",
  },
  async run() {
    // Check if server is already running
    let port = readPortFile();

    if (port !== null && (await isServerRunning(port))) {
      console.log(`Server already running on port ${port}.`);
    } else {
      // Start the server
      console.log("Starting hookwatch server...");
      port = await spawnServer();

      if (port === null) {
        process.stderr.write("[hookwatch] Failed to start server — cannot open UI.\n");
        process.exit(1);
      }

      console.log(`Server started on port ${port}.`);
    }

    const url = `http://localhost:${port}`;
    console.log(`Opening ${url} ...`);
    await openBrowser(url);
  },
});
