/**
 * probe-launcher.ts — Inline hook command interpreter probe
 *
 * Determines which shell interpreter Claude Code uses when executing inline
 * hook commands (the "command" field in hooks.json).
 *
 * When hooks.json has: "command": "hookwatch SessionStart"
 * Claude Code must execute that string somehow — via sh -c, bash -c, zsh -c,
 * cmd.exe /c, or powershell -c. This launcher registers discriminating
 * commands as hooks and inspects which ones succeed to determine the
 * interpreter.
 *
 * Usage: bun scripts/claude-code-probes/probe-launcher.ts
 *
 * Prerequisites:
 *   - claude CLI available on PATH
 *   - ANTHROPIC_API_KEY set (for claude --print)
 *   - Must NOT be run from inside a Claude Code session (the launcher unsets
 *     CLAUDECODE to bypass the nested-session guard, but it's cleaner to run
 *     from a plain terminal)
 *
 * Cross-platform: runs on macOS, Linux, and Windows.
 * On Windows, env -u is replaced with direct env manipulation via Bun.spawn.
 *
 * Bug fix history:
 *   - stdout: "pipe" caused deadlock — changed to "ignore" (we don't need
 *     claude's conversation output, and unread pipes block the child process)
 *   - \\${...} in template literals caused ReferenceError — use \${...}
 *     (single backslash) or single-quoted strings for shell variable literals
 */

import {
  appendFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IS_WINDOWS = process.platform === "win32";
const OUT_DIR = tmpdir();
const PREFIX = "hookwatch-probe-inline";
const REPORT_FILE = join(OUT_DIR, `${PREFIX}-report.txt`);

// log() writes to both console and a report file. console.log is suppressed
// when running inside a Claude Code session (spawning claude from the Bash tool
// silences the parent's stdout). The report file ensures results are always
// readable via: cat <tmpdir>/hookwatch-probe-inline-report.txt
function log(msg: string): void {
  console.log(msg);
  appendFileSync(REPORT_FILE, msg + "\n");
}

interface Probe {
  name: string;
  command: string;
  explanation: string;
  /** Platform restriction. If omitted, runs on all platforms. */
  platform?: "unix" | "windows";
}

function outFile(name: string): string {
  return join(OUT_DIR, `${PREFIX}-${name}.txt`);
}

// --- Unix probes (macOS, Linux) ---
// These use POSIX sh syntax. Shell variables use single-quoted JS strings
// so ${...} is literal (not expanded by JavaScript).

const unixProbes: Probe[] = [
  {
    name: "baseline",
    platform: "unix",
    // $0: In sh -c context, set to the interpreter path ("/bin/sh").
    // ps -p $$ -o comm=:
    //   ps         — list processes
    //   -p $$      — filter to PID $$ (current shell process)
    //   -o comm=   — show "comm" column (process executable name, e.g. "sh").
    //                Trailing "=" suppresses the column header line.
    // BASH_VERSION: Set inside bash AND /bin/sh on macOS (which IS bash 3.2
    //   in POSIX mode). Seeing this does NOT prove full bash — could be sh.
    // ZSH_VERSION: Set only inside zsh.
    command: [
      'echo "0=$0"',
      'echo "comm=$(ps -p $$ -o comm=)"',
      'echo "BASH_VERSION=${BASH_VERSION:-unset}"',
      'echo "ZSH_VERSION=${ZSH_VERSION:-unset}"',
    ]
      .map((cmd, i) =>
        i === 0
          ? cmd + ` > ${outFile("baseline")}`
          : cmd + ` >> ${outFile("baseline")}`,
      )
      .join(" && "),
    explanation:
      "Captures interpreter identity via $0, process name, and shell-specific env vars.",
  },
  {
    name: "bash-only",
    platform: "unix",
    // PIPESTATUS: Bash-only array holding exit codes of each pipeline stage.
    //   ${PIPESTATUS[0]} = exit code of first command.
    //   - full bash: expands to "0" → file contains "0"
    //   - sh (POSIX mode): PIPESTATUS disabled → file empty or not created
    //   - zsh: uses lowercase $pipestatus → uppercase unset → file empty
    // Discriminates full bash from sh (bash in POSIX mode).
    // \${...} in template literal = literal ${...} (escaped from JS expansion).
    command: `echo "\${PIPESTATUS[0]}" > ${outFile("bash")} 2>&1`,
    explanation:
      "PIPESTATUS is bash-only (disabled in POSIX mode). '0' = full bash, empty = sh or zsh.",
  },
  {
    name: "zsh-only",
    platform: "unix",
    // print -l: zsh built-in. -l prints each argument on its own line.
    //   bash has no "print" built-in.
    // *(.): zsh "glob qualifier" — (.) means "regular files only".
    //   bash/sh don't support glob qualifiers.
    // If file has content (lists files), interpreter is zsh.
    // If file missing, interpreter is not zsh.
    command: `print -l ${outFile("*")}(.) > ${outFile("zsh")} 2>&1`,
    explanation:
      "print -l with glob qualifier *(.) is zsh-only. File with content = zsh, missing = not zsh.",
  },
];

// --- Windows probes ---
// On Windows, Claude Code might use cmd.exe /c, powershell -c, or pwsh -c.

const windowsProbes: Probe[] = [
  {
    name: "baseline-win",
    platform: "windows",
    // %COMSPEC%: Points to the command processor (usually C:\WINDOWS\system32\cmd.exe).
    //   If this expands, the interpreter is cmd.exe.
    //   In PowerShell, %...% syntax is not expanded (literal string).
    // %0: In cmd.exe, shows the batch file name or interpreter. In -c context,
    //   behavior varies.
    command: `echo COMSPEC=%COMSPEC% > ${outFile("baseline-win")} && echo SHELL_TYPE=cmd >> ${outFile("baseline-win")}`,
    explanation:
      "If %COMSPEC% expands, interpreter is cmd.exe. PowerShell doesn't expand %...% syntax.",
  },
  {
    name: "powershell-only",
    platform: "windows",
    // $PSVersionTable: Automatic variable that exists only in PowerShell.
    //   Contains version info like PSVersion, PSEdition, etc.
    //   In cmd.exe, $PSVersionTable is literal text (no expansion).
    // $env:COMSPEC: PowerShell syntax for environment variables.
    //   In cmd.exe, this is literal text.
    command:
      `powershell -NoProfile -Command "` +
      `@('PSVersion=' + $PSVersionTable.PSVersion, 'PSEdition=' + $PSVersionTable.PSEdition, 'COMSPEC=' + $env:COMSPEC) | ` +
      `Out-File -FilePath '${outFile("powershell")}' -Encoding utf8"`,
    explanation:
      "$PSVersionTable only exists in PowerShell. If file has version info, interpreter supports PS.",
  },
  {
    name: "cmd-only",
    platform: "windows",
    // ERRORLEVEL: cmd.exe built-in. After any command, %ERRORLEVEL% holds
    //   the exit code. In PowerShell, %ERRORLEVEL% is literal (not expanded).
    // ver: cmd.exe built-in that prints Windows version. Not available in
    //   PowerShell (it's a cmdlet namespace there).
    command: `ver > ${outFile("cmd")} 2>&1 && echo ERRORLEVEL=%ERRORLEVEL% >> ${outFile("cmd")}`,
    explanation:
      "'ver' is a cmd.exe built-in. If file has Windows version string, interpreter is cmd.exe.",
  },
];

const probes: Probe[] = [
  ...unixProbes.filter((p) => !IS_WINDOWS),
  ...windowsProbes.filter((p) => IS_WINDOWS),
];

function cleanup(): void {
  const allNames = [...unixProbes, ...windowsProbes].map((p) => p.name);
  for (const name of allNames) {
    const file = outFile(name);
    if (existsSync(file)) unlinkSync(file);
  }
}

async function runProbe(probe: Probe): Promise<number> {
  const settings = JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: probe.command }] },
      ],
    },
  });

  // Bun.spawn passes args directly to exec (no shell expansion) — avoids
  // escaping issues with $, {, }, %, etc. in the command strings.
  //
  // On Unix: use env -u CLAUDECODE to unset the nested-session guard.
  // On Windows: pass env object with CLAUDECODE removed.
  //
  // --print: non-interactive/headless mode (no TUI)
  // --dangerously-skip-permissions: skip interactive permission prompts
  //
  // stdout/stderr "ignore": we don't need claude's conversation output.
  // IMPORTANT: Do NOT use "pipe" unless you read from proc.stdout — unread
  // pipes cause the child process to block when its output buffer fills,
  // creating a deadlock with await proc.exited.

  const args = IS_WINDOWS
    ? ["claude", "--print", "--settings", settings, "--dangerously-skip-permissions", "say hi"]
    : ["env", "-u", "CLAUDECODE", "claude", "--print", "--settings", settings, "--dangerously-skip-permissions", "say hi"];

  // On Windows, remove CLAUDECODE from the environment directly
  const env = IS_WINDOWS
    ? Object.fromEntries(
        Object.entries(process.env).filter(([k]) => k !== "CLAUDECODE"),
      )
    : undefined; // inherit on Unix (env -u handles it)

  const proc = Bun.spawn(args, {
    stdout: "ignore",
    stderr: "ignore",
    ...(env ? { env } : {}),
  });
  const exitCode = await proc.exited;
  return exitCode;
}

function interpretResults(): void {
  log("\n=== Probe Results ===\n");

  const results: Record<string, string | null> = {};
  for (const probe of probes) {
    const file = outFile(probe.name);
    log(`--- ${probe.name} ---`);
    log(`    ${probe.explanation}`);
    if (existsSync(file)) {
      const content = readFileSync(file, "utf-8").trim();
      results[probe.name] = content;
      log(content || "(empty file)");
    } else {
      results[probe.name] = null;
      log("(file not created — command syntax failed in this interpreter)");
    }
    log("");
  }

  log("=== Interpretation ===\n");
  log(`Platform: ${process.platform} (${IS_WINDOWS ? "Windows" : "Unix"})`);

  if (IS_WINDOWS) {
    interpretWindows(results);
  } else {
    interpretUnix(results);
  }
}

function interpretUnix(results: Record<string, string | null>): void {
  const baseline = results.baseline ?? "";
  const bashResult = results["bash-only"];
  const zshResult = results["zsh-only"];

  if (baseline.includes("ZSH_VERSION=5")) {
    log("Interpreter: zsh");
  } else if (bashResult && bashResult.trim() === "0") {
    log("Interpreter: bash (full mode, not POSIX)");
  } else if (baseline.includes("0=/bin/sh") || baseline.includes("comm=sh")) {
    log("Interpreter: sh (on macOS: bash 3.2 in POSIX compatibility mode)");
    log("  - POSIX sh syntax works");
    log("  - bash extensions (PIPESTATUS, declare -A, [[ ]]) are NOT available");
    log("  - zsh extensions (glob qualifiers, print -l) are NOT available");
  } else if (baseline.includes("BASH_VERSION=")) {
    log("Interpreter: likely bash (BASH_VERSION set, PIPESTATUS inconclusive)");
  } else {
    log("Interpreter: unknown — review raw output above");
  }

  if (zshResult === null) {
    log("  ✓ zsh ruled out (glob qualifier syntax failed)");
  }
  if (bashResult !== null && bashResult.trim() === "") {
    log("  ✓ full bash ruled out (PIPESTATUS empty — POSIX mode)");
  }

  log(
    "\nFor hookwatch: inline commands in hooks.json are executed via " +
      "sh -c '<command>'. Since hookwatch is a binary on PATH, sh just " +
      "needs to find and exec it — no shell-specific features required.",
  );
}

function interpretWindows(results: Record<string, string | null>): void {
  const baselineWin = results["baseline-win"];
  const psResult = results["powershell-only"];
  const cmdResult = results["cmd-only"];

  if (psResult && psResult.includes("PSVersion=")) {
    log("Interpreter: PowerShell");
    log(psResult);
  } else if (cmdResult && cmdResult.includes("Microsoft Windows")) {
    log("Interpreter: cmd.exe");
    log("  'ver' command succeeded — this is cmd.exe");
  } else if (baselineWin && baselineWin.includes("COMSPEC=")) {
    log("Interpreter: likely cmd.exe (COMSPEC expanded)");
  } else {
    log("Interpreter: unknown — review raw output above");
  }

  log(
    "\nFor hookwatch on Windows: hook commands are executed via the detected " +
      "interpreter. Hookwatch binary must be on PATH.",
  );
}

async function main(): Promise<void> {
  if (existsSync(REPORT_FILE)) unlinkSync(REPORT_FILE);

  log("Cleaning up previous probe output...");
  cleanup();

  log(`Platform: ${process.platform}`);
  log(`Temp dir: ${OUT_DIR}`);
  log(`Running ${probes.length} probes...\n`);

  for (const probe of probes) {
    log(`  [${probe.name}] ${probe.explanation}`);
    try {
      const exitCode = await runProbe(probe);
      log(`    claude exited with code ${exitCode}\n`);
    } catch (err) {
      log(`    ERROR: ${err}\n`);
    }
  }

  interpretResults();

  log("\nCleaning up probe output...");
  cleanup();
  log("Done.");
  log(`\nReport saved to: ${REPORT_FILE}`);
}

main().catch(console.error);
