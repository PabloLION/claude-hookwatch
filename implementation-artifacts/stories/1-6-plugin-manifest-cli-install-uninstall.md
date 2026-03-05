# Story 1.6: Plugin Manifest & CLI Install/Uninstall

Status: ready-for-dev

## Story

As a Claude Code developer,
I want to install hookwatch with a single command,
so that all 18 hook event types are registered automatically.

## Acceptance Criteria

1. **Given** hookwatch is installed globally via npm, **when** `hookwatch install`
   is run, **then** `plugin.json` and `hooks.json` are generated from source,
   `claude plugin install` is called to register the plugin, and all 18 event
   types are registered in `hooks.json`.

2. **Given** hookwatch is already installed, **when** `hookwatch install` is run
   again, **then** it uninstalls first, then reinstalls (update behavior).

3. **Given** hookwatch is installed, **when** `hookwatch uninstall` is run,
   **then** `claude plugin uninstall` is called, and no leftover files or broken
   hooks remain.

4. **Given** hookwatch is run with `--help` or `--version`, **when** the flag is
   passed, **then** help text or version number is displayed.

## Tasks / Subtasks

- [ ] Create `src/cli/index.ts` — citty main entrypoint, register subcommands (install, uninstall, open, wrap), global flags (--help, --version) (AC: #4)
- [ ] Create `src/cli/generate.ts` — generate `plugin.json` and `hooks.json` from source (AC: #1)
- [ ] Create `src/cli/install.ts` — generate plugin files, call `claude plugin install`, handle reinstall by uninstalling first (AC: #1, #2)
- [ ] Create `src/cli/uninstall.ts` — call `claude plugin uninstall`, clean up generated files (AC: #3)
- [ ] Define `hooks.json` structure with all 18 event types registered using `".*"` matcher (AC: #1)
- [ ] Define `plugin.json` structure with name, version (from package.json), and author (AC: #1)
- [ ] Add `bin` field to `package.json` pointing to CLI entry point (AC: #1, #4)
- [ ] Read version from `package.json` for `--version` flag (AC: #4)
- [ ] Stub `open` and `wrap` subcommands (defined but not implemented — Epic 2 and Epic 3) (AC: #4)
- [ ] Create `src/cli/install.test.ts` — test plugin file generation (plugin.json validity, hooks.json contains all 18 event types with correct `bun <path>` command), install flow, reinstall idempotency, and uninstall cleanup (mock `claude` CLI calls). Scope: CLI and manifest only. Handler behavior and server startup are tested in Stories 1.4 and 1.5. (AC: #1, #2, #3)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2, #3, #4)

## Dev Notes

### CLI Framework

- citty (~10KB, modern, zero transitive dependencies)
- 4 subcommands: `install`, `uninstall`, `open`, `wrap`
- Global flags: `--help`/`-h`, `--version`/`-v` (available on all subcommands)
- `open` and `wrap` are defined in this story's CLI framework but implemented in Epic 2 and Epic 3 respectively

### hooks.json Structure

Register all 18 event types with `".*"` matcher to capture everything:

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "SessionEnd": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "UserPromptSubmit": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "PreToolUse": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "PostToolUse": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "PostToolUseFailure": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "PermissionRequest": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "Notification": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "SubagentStart": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "SubagentStop": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "Stop": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "PreCompact": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "TeammateIdle": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "TaskCompleted": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "ConfigChange": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "WorktreeCreate": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "WorktreeRemove": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }],
    "Setup": [{ "matcher": ".*", "type": "command", "command": "bun /absolute/path/to/src/handler/index.ts" }]
  }
}
```

- The `command` value is `bun <absolute-path>`, not `bun run <script-name>`. Bun runs `.ts` files directly — no build step, no package.json script lookup. The absolute path is resolved at install time from the npm global package root (e.g. `$(npm root -g)/hookwatch/src/handler/index.ts`) and written into `hooks.json` as a literal string.
- Note: wildcard `"*"` support is unverified (ch-0fn) — explicit registration of all 18 types is the safe approach

### plugin.json Structure

```json
{
  "name": "hookwatch",
  "version": "<from package.json>",
  "author": "pablo"
}
```

### Install Flow

```text
1. hookwatch install
2. Check if already installed -> if yes, uninstall first (see Already Installed Detection)
3. Generate plugin.json + hooks.json at package root
4. Run: claude plugin install <package-root-path>
5. Verify registration succeeded
```

### Already Installed Detection

Detection strategy: run `claude plugin list` and check whether a plugin named `hookwatch` appears in the output. If yes, treat as already installed.

Behavior on detection: print a warning (`Hookwatch already installed — reinstalling...`), run `claude plugin uninstall hookwatch`, then proceed with the normal install flow. Do not error out — reinstall is the intended update path.

Do not rely on the presence of `plugin.json` or `hooks.json` files at the package root as the detection signal — those files may exist from a previous partial install without the plugin being registered in Claude Code.

### Uninstall Flow

```text
1. hookwatch uninstall
2. Run: claude plugin uninstall hookwatch
3. Clean up generated plugin.json + hooks.json if they exist at package root
4. Verify uninstall succeeded
```

### Dependencies

- Story 1.4: Hook Handler (`src/handler/index.ts`) must exist — the handler path in `hooks.json` resolves to this file

### Distribution Model

- `npm install -g hookwatch` installs the package globally
- `hookwatch install` calls `claude plugin install` internally
- `claude plugin install` is an implementation detail, not user-facing
- Same model as beads-tracker

### Testing

Scope for `src/cli/install.test.ts`: CLI commands and manifest generation only. Do not test handler behavior (Story 1.4) or server startup (Story 1.5).

- Mock `claude plugin install`, `claude plugin uninstall`, and `claude plugin list` shell calls — do not actually invoke Claude Code in tests
- Test that generated `hooks.json` contains all 18 event types, each with a `command` value matching `bun <absolute-path-to-handler>`
- Test that generated `plugin.json` version matches `package.json` version
- Test already-installed detection: when `claude plugin list` output contains `hookwatch`, install should call `claude plugin uninstall` before calling `claude plugin install`
- Test reinstall warning message is printed when plugin is already installed
- Test uninstall cleanup: generated `plugin.json` and `hooks.json` are removed from the package root

### Project Structure Notes

```text
src/
  cli/
    index.ts         — citty main, subcommand registration
    install.ts       — hookwatch install (generate + register)
    uninstall.ts     — hookwatch uninstall
    generate.ts      — plugin.json + hooks.json generation
    install.test.ts  — co-located unit test

plugin.json          — generated, checked into repo for claude plugin install
hooks.json           — generated, registered event types
```

### References

- [Source: ./planning-artifacts/architecture.md#CLI & Distribution]
- [Source: ./planning-artifacts/architecture.md#Infrastructure & Code Organization]
- [Source: ./planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: ./planning-artifacts/epics.md#Story 1.6]
- [Source: ./planning-artifacts/prd.md#Plugin System]
- [Source: ./docs/hook-stdin-schema.md#Event Count] — authoritative list of 18 event types

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
