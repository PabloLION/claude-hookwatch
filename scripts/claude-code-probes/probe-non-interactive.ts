/**
 * probe-non-interactive.ts — SessionStart hook firing in non-interactive mode
 *
 * Tests whether the SessionStart hook fires when Claude Code runs in
 * non-interactive mode (--print flag). If not, hookwatch misses session starts
 * in automated/scripted contexts.
 *
 * Probe design:
 *   Register a SessionStart hook that writes a marker file with a timestamp.
 *   Run claude --print "hello" (non-interactive). Check if the marker file
 *   was created.
 *
 * Usage: bun scripts/claude-code-probes/probe-non-interactive.ts
 *
 * Prerequisites:
 *   - claude CLI available on PATH
 *   - ANTHROPIC_API_KEY set (for claude --print)
 *   - Can be run from inside a Claude Code session (unsets CLAUDECODE guard)
 *
 * Cross-platform: runs on macOS, Linux, and Windows.
 */

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IS_WINDOWS = process.platform === "win32";
const OUT_DIR = tmpdir();
const PREFIX = "hookwatch-probe-non-interactive";
const REPORT_FILE = join(OUT_DIR, `${PREFIX}-report.txt`);
const MARKER_FILE = join(OUT_DIR, `${PREFIX}-marker.txt`);

function log(msg: string): void {
  console.log(msg);
  appendFileSync(REPORT_FILE, `${msg}\n`);
}

function buildHookCommand(): string {
  // The hook writes a marker file with timestamp and event info.
  // Uses printf for reliable output. The hook also writes JSON to stdout
  // (continue: true) so Claude Code proceeds normally.
  const json = JSON.stringify({ continue: true, suppressOutput: true });

  if (IS_WINDOWS) {
    return `echo fired=%DATE% %TIME% > "${MARKER_FILE}" && echo ${json}`;
  }

  return `printf 'fired=%s\\n' "$(date +%Y%m%dT%H%M%S)" > "${MARKER_FILE}" && printf '%s' '${json}'`;
}

interface ProbeResult {
  claudeExitCode: number;
  hookFired: boolean;
  markerContent: string | null;
  probeCwd: string;
}

async function runProbe(): Promise<ProbeResult> {
  const hookCommand = buildHookCommand();

  log(`Hook command: ${hookCommand}`);

  const settings = JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: hookCommand }] }],
    },
  });

  const args = IS_WINDOWS
    ? ["claude", "--print", "--settings", settings, "--dangerously-skip-permissions", "say hello"]
    : [
        "env",
        "-u",
        "CLAUDECODE",
        "claude",
        "--print",
        "--settings",
        settings,
        "--dangerously-skip-permissions",
        "say hello",
      ];

  const env = IS_WINDOWS
    ? Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDECODE"))
    : undefined;

  // Run from a temp directory so the probe session doesn't appear in the
  // project's Claude Code resume list.
  const probeCwd = mkdtempSync(join(OUT_DIR, `${PREFIX}-cwd-`));
  log(`Probe cwd: ${probeCwd}`);
  log("Spawning claude --print (non-interactive mode)...");
  const proc = Bun.spawn(args, {
    cwd: probeCwd,
    stdout: "ignore",
    stderr: "ignore",
    ...(env ? { env } : {}),
  });

  const claudeExitCode = await proc.exited;
  const hookFired = await Bun.file(MARKER_FILE).exists();
  const markerContent = hookFired ? (await Bun.file(MARKER_FILE).text()).trim() : null;

  return { claudeExitCode, hookFired, markerContent, probeCwd };
}

function interpret(result: ProbeResult): void {
  log("\n=== Interpretation ===\n");

  log(`Claude exit code: ${result.claudeExitCode}`);
  log(`Hook fired (marker file exists): ${result.hookFired}`);
  log(`Marker content: ${result.markerContent ?? "(absent)"}`);

  if (result.hookFired) {
    log("\nFINDING: SessionStart hook FIRES in non-interactive mode (--print).");
    log("  Hookwatch will capture session starts from automated/scripted usage.");
  } else if (result.claudeExitCode === 0) {
    log("\nFINDING: SessionStart hook does NOT fire in non-interactive mode.");
    log("  Claude completed successfully but the hook never ran.");
    log("  Hookwatch will miss session starts from --print / piped / SDK usage.");
  } else {
    log("\nINCONCLUSIVE: Claude exited non-zero and hook did not fire.");
    log("  Possible causes: API key missing, network error, or startup failure.");
    log("  Cannot determine non-interactive hook behavior.");
  }
}

async function main(): Promise<void> {
  const reportFile = Bun.file(REPORT_FILE);
  const markerFile = Bun.file(MARKER_FILE);
  if (await reportFile.exists()) await reportFile.delete();
  if (await markerFile.exists()) await markerFile.delete();

  log("=== probe-non-interactive ===");
  log(`Platform: ${process.platform}`);
  log(`Temp dir: ${OUT_DIR}`);
  log("");
  log("Question: Does the SessionStart hook fire in non-interactive mode (--print)?");
  log("");

  const versionProc = Bun.spawn(["claude", "--version"], {
    stdout: "pipe",
    stderr: "ignore",
  });
  const versionText = await new Response(versionProc.stdout).text();
  await versionProc.exited;
  log(`Claude version: ${versionText.trim()}`);
  log("");

  let result: ProbeResult;
  try {
    result = await runProbe();
  } catch (err) {
    log(`ERROR running probe: ${err}`);
    log(`\nReport saved to: ${REPORT_FILE}`);
    return;
  }

  interpret(result);

  const markerFileCleanup = Bun.file(MARKER_FILE);
  if (await markerFileCleanup.exists()) await markerFileCleanup.delete();

  // Clean up the temp cwd (may contain .claude/ session artifacts)
  try {
    rmSync(result.probeCwd, { recursive: true });
  } catch {
    log(`Note: could not remove probe cwd: ${result.probeCwd}`);
  }

  log(`\nReport saved to: ${REPORT_FILE}`);
}

main().catch(console.error);
