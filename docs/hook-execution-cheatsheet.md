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
Priority,Condition,Exit code,Output
P1 Fatal,"Server unreachable, port occupied, POST fails",2,JSON to stdout
P2 Non-fatal,"Server OK, hookwatch had an issue","Wrapped: pass-through; Bare: 0",hookwatch_error in DB
P3 Normal,No hookwatch error,"Wrapped: pass-through; Bare: 0",hookwatch_error NULL
```

### Never exit 1

Claude Code shows a generic `"hookname:subtype hook error"` message for exit 1.
stderr is not surfaced to the user or to the coding agent. There is no way to
convey useful information through exit 1.

Exit 2 + JSON in stdout carries the actual error context and is displayed by
Claude Code. Exit 2 is strictly better than exit 1 in every scenario.

### Authenticity: pass through wrapped command output

Wrapped command's stdout, stderr, and exit code are passed through unchanged.
hookwatch is a transparent proxy.

**Why**: A hook developer wrapping their broken hook with `hookwatch wrap` must
see the real failure. If hookwatch rewrites exit 1 to exit 2 (agent-friendly
JSON), the developer sees a clean exit and thinks their hook works — a false
positive during debugging. hookwatch observes; it does not heal.

### hookwatch_error column

Non-fatal errors (P2) are stored in the `hookwatch_error TEXT` column in the
events table. Multiple errors during a single handler run are accumulated via a
string builder and written as one value. NULL means no error.

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
