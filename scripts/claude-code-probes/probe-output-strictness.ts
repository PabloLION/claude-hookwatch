/**
 * probe-output-strictness.ts — Hook stdout extra-field strictness probe
 *
 * Tests whether Claude Code rejects hook stdout that contains extra JSON fields
 * beyond the documented schema. This confirms whether our .passthrough() approach
 * in src/schemas/output.ts is safe.
 *
 * Theory:
 *   If Claude Code validates output strictly (like Zod without .passthrough()), it
 *   would reject or error when hooks return extra fields. If it ignores extras, our
 *   .passthrough() usage is empirically confirmed safe.
 *
 * Probe design:
 *   Register a SessionStart hook that unconditionally writes a JSON blob to stdout
 *   with BOTH standard fields AND extra fields (hookwatch_version, debug). If
 *   Claude Code runs the session successfully, the extra fields were accepted. We
 *   capture Claude's exit code and any session errors via a side-channel result
 *   file.
 *
 * Usage: bun scripts/claude-code-probes/probe-output-strictness.ts
 *
 * Prerequisites:
 *   - claude CLI available on PATH
 *   - ANTHROPIC_API_KEY set (for claude --print)
 *   - Must NOT be run from inside a Claude Code session (unsets CLAUDECODE guard)
 *
 * Cross-platform: runs on macOS, Linux, and Windows.
 *
 * Interpretation:
 *   - Claude exits 0 AND result file contains "success=true": extra fields accepted
 *   - Claude exits non-zero OR result file contains errors: extra fields may be rejected
 *   - Result file absent: hook never ran (Claude startup issue)
 */

import { appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IS_WINDOWS = process.platform === "win32";
const OUT_DIR = tmpdir();
const PREFIX = "hookwatch-probe-output-strictness";
const REPORT_FILE = join(OUT_DIR, `${PREFIX}-report.txt`);
const RESULT_FILE = join(OUT_DIR, `${PREFIX}-result.txt`);

function log(msg: string): void {
  console.log(msg);
  appendFileSync(REPORT_FILE, `${msg}\n`);
}

/** Build the hook command that emits JSON with extra fields to stdout. */
function buildHookCommand(): string {
  // The hook writes a JSON object with:
  //   - continue: true       (standard field — proceed normally)
  //   - suppressOutput: true (standard field — avoid cluttering output)
  //   - hookwatch_version: "0.1.0"  (extra field — NOT in Claude Code schema)
  //   - debug: true                  (extra field — NOT in Claude Code schema)
  //
  // It also writes a side-channel result file so we can confirm the hook ran.
  //
  // Uses printf for reliable JSON output (avoids echo -e portability issues).
  // Single-line JSON avoids shell quoting issues with newlines.

  const json = JSON.stringify({
    continue: true,
    suppressOutput: true,
    hookwatch_version: "0.1.0",
    debug: true,
  });

  if (IS_WINDOWS) {
    // On Windows, cmd.exe uses > and echo differently.
    // PowerShell: Write-Output and Out-File.
    // We use a simple echo with cmd.exe syntax.
    return `echo ${json} && echo success=true > "${RESULT_FILE}"`;
  }

  // Unix: printf avoids trailing newline issues and handles special chars.
  // Single quotes around JSON prevent shell expansion of { } characters.
  return `printf '%s' '${json}' && echo success=true > "${RESULT_FILE}"`;
}

interface ProbeResult {
  claudeExitCode: number;
  hookRan: boolean;
  resultContent: string | null;
  error?: string;
}

async function runProbe(): Promise<ProbeResult> {
  const hookCommand = buildHookCommand();

  log(`Hook command: ${hookCommand}`);
  log(
    `Expected JSON output: ${JSON.stringify(
      {
        continue: true,
        suppressOutput: true,
        hookwatch_version: "0.1.0",
        debug: true,
      },
      null,
      2,
    )}`,
  );

  const settings = JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: hookCommand }] }],
    },
  });

  // Bun.spawn passes args directly — no shell expansion issues.
  // stdout: "ignore" — we don't need claude's conversation output;
  // unread pipes can deadlock if buffer fills.
  const args = IS_WINDOWS
    ? ["claude", "--print", "--settings", settings, "--dangerously-skip-permissions", "say hi"]
    : [
        "env",
        "-u",
        "CLAUDECODE",
        "claude",
        "--print",
        "--settings",
        settings,
        "--dangerously-skip-permissions",
        "say hi",
      ];

  const env = IS_WINDOWS
    ? Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "CLAUDECODE"))
    : undefined;

  log("Spawning claude...");
  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "ignore",
    ...(env ? { env } : {}),
  });

  const claudeExitCode = await proc.exited;
  const hookRan = existsSync(RESULT_FILE);
  const resultContent = hookRan ? readFileSync(RESULT_FILE, "utf-8").trim() : null;

  return { claudeExitCode, hookRan, resultContent };
}

function interpret(result: ProbeResult): void {
  log("\n=== Interpretation ===\n");

  if (!result.hookRan) {
    log("INCONCLUSIVE: Hook did not run (result file absent).");
    log("  Possible causes: Claude startup failed, API key missing,");
    log("  or hook command itself errored before writing result.");
    log(`  Claude exit code: ${result.claudeExitCode}`);
    return;
  }

  log(`Claude exit code: ${result.claudeExitCode}`);
  log("Hook ran: yes");
  log(`Result file content: ${result.resultContent}`);

  if (result.claudeExitCode === 0 && result.resultContent?.includes("success=true")) {
    log("\nFINDING: Extra fields ACCEPTED by Claude Code.");
    log("  The session completed successfully with extra fields in hook stdout.");
    log("  .passthrough() in our output schemas is empirically confirmed safe.");
    log("  Claude Code ignores unknown fields in hook stdout.");
  } else if (result.claudeExitCode !== 0) {
    log("\nFINDING: Claude exited non-zero — extra fields may be REJECTED.");
    log("  Review stderr or Claude output for error details.");
    log("  Consider switching output schemas from .passthrough() to default");
    log("  z.object() (which strips extra fields before output).");
  } else {
    log("\nFINDING: Ambiguous — hook ran but Claude exit code is unexpected.");
    log(`  Exit code: ${result.claudeExitCode}`);
    log("  Manual review required.");
  }
}

async function main(): Promise<void> {
  if (existsSync(REPORT_FILE)) unlinkSync(REPORT_FILE);
  if (existsSync(RESULT_FILE)) unlinkSync(RESULT_FILE);

  log("=== probe-output-strictness ===");
  log(`Platform: ${process.platform}`);
  log(`Temp dir: ${OUT_DIR}`);
  log("Claude Code version: (will be determined by running claude --version)");
  log("");
  log("Question: Does Claude Code reject hook stdout with extra JSON fields?");
  log("Extra fields tested: hookwatch_version, debug");
  log("Standard fields included: continue (true), suppressOutput (true)");
  log("");

  // Capture claude version separately for the report
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
    log("Cannot determine strictness — manual testing required.");
    log(`\nReport saved to: ${REPORT_FILE}`);
    return;
  }

  log(`\nclaude exit code: ${result.claudeExitCode}`);
  log(`hook ran (result file exists): ${result.hookRan}`);
  log(`result file content: ${result.resultContent ?? "(absent)"}`);

  interpret(result);

  // Cleanup side-channel file
  if (existsSync(RESULT_FILE)) unlinkSync(RESULT_FILE);

  log(`\nReport saved to: ${REPORT_FILE}`);
}

main().catch(console.error);
