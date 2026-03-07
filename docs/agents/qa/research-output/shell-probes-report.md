# Shell Environment Research Report: Hook Execution

Status: Complete
Date: 20260307
Claude Code version tested: 2.1.71

## Methodology

### Goal

Determine empirically which shell interpreter Claude Code uses when executing
hook commands, and which environment variables are available to hooks.

### Approach

Three probe scripts were written, each using shell-specific syntax as a litmus
test for which interpreter executed them:

- `probe-posix.sh` — POSIX sh only, captures env vars
- `probe-bash.sh` — bash-specific syntax (`declare -A`, `$PIPESTATUS`, process substitution)
- `probe-zsh.sh` — zsh-specific syntax (glob qualifiers, `print -l`, `$ZSH_VERSION`)

Two registration methods were tested:

1. `--settings` flag with inline JSON (per-probe invocation)
2. `--plugin-dir` pointing to a temporary plugin with all three probes

Both registered the probes as `SessionStart` hooks.

### Invocation

Claude Code was run in headless mode (`--print` flag) with
`--dangerously-skip-permissions`. The `CLAUDECODE` environment variable was
unset to bypass the nested-session guard:

```sh
env -u CLAUDECODE claude --print --plugin-dir /tmp/hookwatch-probe-plugin \
  --dangerously-skip-permissions "say hi"
```

### Nested session guard

Claude Code sets `CLAUDECODE` in the environment and refuses to launch if that
variable is already set (exits 1 with error message). Hooks must unset it
before spawning any child `claude` process. In hookwatch's wrap command,
`sh -c '...'` inherits the full environment so this guard would block nested
invocations — relevant for future HITL features (ch-9wpp).

## Results

All three probe scripts were executed successfully. Output files were created
at `/tmp/hookwatch-probe-*.txt`.

### POSIX probe output

```text
SHELL=/bin/zsh
BASH_VERSION=3.2.57(1)-release
ZSH_VERSION=unset
0=/path/to/probe-posix.sh
CLAUDE_PLUGIN_ROOT=/tmp/hookwatch-probe-plugin
CLAUDE_PROJECT_DIR=/private/tmp
PATH=<full user PATH>
HOME=/Users/pablo
USER=pablo
PWD=/tmp
CLAUDE_CODE_ENTRYPOINT=cli
CLAUDE_CODE_TMPDIR=./.claude/tmp
CLAUDE_ENV_FILE=/Users/pablo/.claude/session-env/<uuid>/sessionstart-hook-N.sh
probe-posix:done
```

### Bash probe output

```text
BASH_PROBE=success
BASH_VERSION=3.2.57(1)-release
assoc_array[shell]=bash
process_sub=works
probe-bash:done
PIPESTATUS_after_echo=0
```

Bash-specific syntax (`declare -A`, process substitution `<(...)`,
`$PIPESTATUS`) all worked. The `#!/bin/bash` shebang was respected.

### Zsh probe output

```text
ZSH_PROBE=success
ZSH_VERSION=5.9
/tmp/hookwatch-probe-bash.txt
/tmp/hookwatch-probe-posix.txt
/tmp/hookwatch-probe-zsh.txt
probe-zsh:done
```

Zsh-specific syntax (`print -l`, glob qualifier `*(.)`) worked.
`ZSH_VERSION=5.9` confirms zsh 5.9 is available.

### Environment variables available to hooks

```csv
Variable,Value observed,Notes
SHELL,/bin/zsh,User login shell — NOT the hook interpreter
BASH_VERSION,3.2.57(1)-release,Inherited even when hook runs under sh/bash
ZSH_VERSION,(unset in POSIX probe),Only set when #!/bin/zsh shebang is used
CLAUDE_PLUGIN_ROOT,/tmp/hookwatch-probe-plugin,Set only when plugin registered via --plugin-dir
CLAUDE_PROJECT_DIR,/private/tmp,Absolute path to session's working directory
CLAUDE_CODE_ENTRYPOINT,cli,How Claude Code was launched
CLAUDE_CODE_TMPDIR,./.claude/tmp,Relative path to Claude Code temp directory
CLAUDE_ENV_FILE,/Users/pablo/.claude/session-env/<uuid>/sessionstart-hook-N.sh,Session env file (from session-env plugin)
PATH,<full user PATH>,Full user PATH including all local tools
HOME,/Users/pablo,User home directory
USER,pablo,Username
PWD,/tmp,Working directory when hook fired
```

Note: `CLAUDE_ENV_FILE` appears because the session-env plugin is active on
this machine. It will not be present in standard hookwatch installations.

## Conclusions

### Shell interpreter: shebang-driven

Claude Code does NOT force a specific shell interpreter. It executes hook
command scripts using the shebang line. The OS then invokes the interpreter
specified by the shebang:

- `#!/bin/sh` → `/bin/sh` (on macOS: bash 3.2 in POSIX compatibility mode)
- `#!/bin/bash` → `/bin/bash` (bash 3.2 on stock macOS; 5.x if Homebrew bash installed)
- `#!/bin/zsh` → `/bin/zsh` (zsh 5.9 on macOS 15+)

When the hook command in `hooks.json` is a script path, the OS shebang
determines the interpreter. When the hook command is an inline shell command
string (e.g., `"command": "hookwatch SessionStart"`), Claude Code likely
invokes `sh -c '<command>'` or equivalent.

### SHELL env var is user login shell, not hook interpreter

`$SHELL` shows `/bin/zsh` (the user's login shell) but this does NOT mean
hooks run in zsh. The `$SHELL` variable is inherited from the parent process
environment. Each probe ran under the interpreter specified by its own shebang.

### Inherited environment

Hooks inherit the full user environment:

- Complete `PATH` (including local tools like `bun`, `hookwatch`)
- `HOME`, `USER`, `PWD`
- All `CLAUDE_*` env vars

This means `hookwatch` (installed via `bun link`) is available to hooks without
any absolute path — the user's PATH includes `~/.local/bin` where `bun link`
symlinks the binary.

### CLAUDE_PLUGIN_ROOT is set for plugin hooks

When hooks are registered via `--plugin-dir` or `claude plugin install`,
`CLAUDE_PLUGIN_ROOT` is set to the plugin directory. This allows hook commands
to reference plugin-relative paths using `${CLAUDE_PLUGIN_ROOT}/...`.

When hooks are registered via `--settings` (inline JSON), `CLAUDE_PLUGIN_ROOT`
is NOT set.

### CLAUDE_PROJECT_DIR is always set

`CLAUDE_PROJECT_DIR` is set to the project working directory (`cwd`). This
matches the `cwd` field in the stdin JSON payload. Both sources are consistent.

## Implications for hookwatch

### Wrap command shell compatibility

The `hookwatch wrap` feature uses `sh -c '...'` to execute user commands
containing shell metacharacters. Since hooks run under the shebang interpreter
(not the user's login shell), using `sh -c` is the correct cross-shell
approach. POSIX sh is universally available, even when the user's login shell
is zsh.

### PATH availability

`hookwatch` is reliably accessible to hooks via PATH. The `bun link` install
step adds a symlink in a directory already on PATH. No absolute path needed in
`hooks.json`.

### CLAUDE_PLUGIN_ROOT usage

The current `hooks/hooks.json` uses plain `hookwatch <EventType>` commands.
This works because `hookwatch` is on PATH. If the command needed a
plugin-relative path, `${CLAUDE_PLUGIN_ROOT}/...` would be the correct
approach — but PATH lookup is simpler and more portable.

### Nested claude invocation guard

Future HITL features (ch-9wpp) that spawn a child `claude` process from a hook
must unset `CLAUDECODE` first. Claude Code refuses to launch when `CLAUDECODE`
is already set.

## How to rerun the probes

```sh
# Prerequisites: claude binary must be available
# Remove any stale output
rm -f /tmp/hookwatch-probe-posix.txt /tmp/hookwatch-probe-bash.txt /tmp/hookwatch-probe-zsh.txt

# Option A: inline settings (one probe at a time)
PROBE=/path/to/probe-posix.sh
env -u CLAUDECODE claude --print \
  --settings "{\"hooks\":{\"SessionStart\":[{\"hooks\":[{\"type\":\"command\",\"command\":\"$PROBE\"}]}]}}" \
  --dangerously-skip-permissions \
  "say hi"

# Option B: plugin-dir (all three probes at once)
# Requires /tmp/hookwatch-probe-plugin/ with .claude-plugin/plugin.json
# and hooks/hooks.json referencing all three probes
env -u CLAUDECODE claude --print \
  --plugin-dir /tmp/hookwatch-probe-plugin \
  --dangerously-skip-permissions \
  "say hi"

# Read results
cat /tmp/hookwatch-probe-posix.txt
cat /tmp/hookwatch-probe-bash.txt
cat /tmp/hookwatch-probe-zsh.txt
```
