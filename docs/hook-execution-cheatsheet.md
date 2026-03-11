# Hook Execution Cheat Sheet

Quick reference for how Claude Code executes hook commands and how hookwatch
interacts with the hook system. Based on empirical probes — Claude Code source
is not available.

## Shell Interpreter

### Inline commands (hooks.json)

Claude Code uses `sh -c '<command>'` for inline hook commands defined in
hooks.json.

```csv
Platform,Interpreter,Details,Status
macOS,/bin/sh,"bash 3.2 in POSIX compatibility mode",Tested (Claude Code 2.1.71)
Linux,/bin/sh,"likely dash (Debian/Ubuntu) or bash",Untested
Windows,Unknown,"cmd.exe, PowerShell, or WSL sh",Untested
```

### Script files (shebang)

When the hook command points to an executable script file, the OS uses the
shebang line. Claude Code does not override it.

- `#!/bin/sh` — POSIX sh (on macOS: bash 3.2 in POSIX mode)
- `#!/bin/bash` — bash (3.2 on stock macOS; 5.x if Homebrew)
- `#!/bin/zsh` — zsh (5.9 on macOS 15+)

### Safe syntax for inline hook commands

Only POSIX sh syntax is guaranteed to work in inline commands:

```csv
Status,Syntax,Example
Safe,Variable expansion,"$VAR, ${VAR:-default}"
Safe,Conditionals and tests,"test, [, &&, ||"
Safe,Pipes and sequences,"|, ;, &&"
Safe,Redirection,"> file, 2>&1, >> file"
Safe,Command substitution,$(command)
Unsafe,Bash arrays,"declare -A, ${PIPESTATUS[@]}"
Unsafe,Bash conditionals,[[ ]]
Unsafe,Bash process substitution,<(command)
Unsafe,Zsh glob qualifiers,"*(.), *(@)"
Unsafe,Zsh builtins,print -l
```

### Common traps

**BASH_VERSION is set but bash features are disabled.** On macOS, `/bin/sh` IS
bash 3.2 running in POSIX compatibility mode. `$BASH_VERSION` reads
`3.2.57(1)-release`, but POSIX mode disables bash-specific features like
`PIPESTATUS`, associative arrays, and `[[ ]]`.

**$SHELL is the login shell, not the hook interpreter.** `$SHELL` shows
`/bin/zsh` (user's login shell) but hooks run under `sh -c`. The `$SHELL`
variable is inherited from the parent environment and does not reflect the
actual interpreter executing the hook command.

## Exit Codes

### Priority chain

```csv
Severity,Condition,Exit code,Output
fatal,"Server unreachable, schema parse failure",0,"JSON stdout: systemMessage + hookwatch_fatal (no DB record)"
error,"Server OK, hookwatch had an issue","Wrapped: pass-through; Bare: 0","hookwatch_log with [error] prefix"
warn,"Non-critical issue (e.g. slow handler)","Wrapped: pass-through; Bare: 0","hookwatch_log with [warn] prefix"
normal,No hookwatch issues,"Wrapped: pass-through; Bare: 0",hookwatch_log NULL
```

### Never exit 1 or 2

- **Exit 1**: Claude Code shows a generic `"hookname:subtype hook error"`.
  stderr is not surfaced. Strictly useless.
- **Exit 2**: JSON is ignored at exit 2 per Claude Code docs. May block
  certain events (PreToolUse, PermissionRequest). Hookwatch must never block
  Claude Code.

### Authenticity: pass through wrapped command output

Wrapped command's stdout, stderr, and exit code are passed through unchanged.
hookwatch is a transparent proxy. Signal-killed children use 128+signal
convention (e.g. SIGKILL → 137).

### hookwatch_log column

Non-fatal errors and warnings are stored in the `hookwatch_log TEXT` column in
the events table. Entries use severity prefixes (`[error]`, `[warn]`). Multiple
entries during a single handler run are joined with `'; '`. NULL means no
issues.

## Hook Stdout Output Schema Strictness

**Question:** Does Claude Code reject hook stdout JSON that contains extra fields
beyond the documented schema?

**Answer:** No. Claude Code ignores unknown fields in hook stdout. Extra fields
pass through silently.

**Empirical finding** (Claude Code 2.1.71, macOS, tested 20260307):

A SessionStart hook returned this JSON with two extra fields:

```json
{
  "continue": true,
  "suppressOutput": true,
  "hookwatch_version": "0.1.0",
  "debug": true
}
```

Claude Code exited 0 and ran the session normally. The extra fields
(`hookwatch_version`, `debug`) were silently ignored — no error, no warning.

**Implication for hookwatch:** `.passthrough()` on all output Zod schemas is
empirically confirmed safe. If Claude Code adds new output fields in future
versions, hooks returning those fields will not break existing hookwatch
versions. The leniency is symmetric: Claude Code is lenient both on what it
reads from hook stdin and what it accepts from hook stdout.

**Probe:** `./scripts/claude-code-probes/probe-output-strictness.ts`

## Environment Variables

Variables available to hooks, inherited from the Claude Code session:

```csv
Variable,Example,Notes
CLAUDE_PROJECT_DIR,/path/to/project,Project working directory (matches cwd in stdin)
CLAUDE_PLUGIN_ROOT,/path/to/plugin,Only when registered via --plugin-dir or claude plugin install
CLAUDE_CODE_ENTRYPOINT,cli,How Claude Code was launched
CLAUDE_CODE_TMPDIR,./.claude/tmp,Relative to project directory
PATH,(full user PATH),Includes ~/.local/bin and other user-added directories
HOME,/Users/pablo,User home directory
USER,pablo,Username
PWD,/path/to/cwd,Working directory when hook fired
SHELL,/bin/zsh,User login shell — NOT the hook interpreter (see Common Traps)
CLAUDECODE,(set),Nested-session guard — must unset before spawning child claude processes
```

## Event Types

hookwatch handles all 18 Claude Code hook event types. Full schema with common
fields and event-specific fields: `./hook-stdin-schema.md`. Hook output format:
`./hook-stdout-schema.md`.

Registration in hooks.json follows the pattern
`"command": "hookwatch <EventType>"` for each of the 18 PascalCase event family
subcommands (e.g., `hookwatch SessionStart`, `hookwatch PreToolUse`).

## Probes

Empirical probes investigate Claude Code's external behavior. They are not
software tests (tests verify our own code; probes investigate systems we don't
control).

### Available probes

```csv
Probe type,Location,What it tests
Shebang probes (3 scripts),./docs/agents/qa/research-output/shell-probes/,Which interpreter runs script-file hooks
Inline command probe launcher,./scripts/claude-code-probes/probe-launcher.ts,Which interpreter runs inline hook commands
Output schema strictness,./scripts/claude-code-probes/probe-output-strictness.ts,Whether Claude Code rejects hook stdout with extra JSON fields
```

### Running probes

Inline probes (cross-platform — macOS, Linux, Windows):

```sh
bun scripts/claude-code-probes/probe-launcher.ts
```

The launcher spawns `claude --print --settings` with discriminating shell
commands as SessionStart hooks. Results are written to both console and a report
file at `$TMPDIR/hookwatch-probe-inline-report.txt`.

Prerequisites: `claude` CLI on PATH, `ANTHROPIC_API_KEY` set, run from a plain
terminal (not inside a Claude Code session).

### Probe report

Full findings with raw output: `./docs/agents/qa/research-output/shell-probes-report.md`
