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
- [ ] Create `src/cli/install.test.ts` — test plugin file generation, install flow, reinstall idempotency, uninstall cleanup (mock `claude` CLI calls) (AC: #1, #2, #3)
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
    "SessionStart": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "SessionEnd": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "UserPromptSubmit": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "PreToolUse": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "PostToolUse": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "PostToolUseFailure": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "PermissionRequest": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "Notification": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "SubagentStart": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "SubagentStop": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "Stop": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "PreCompact": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "TeammateIdle": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "TaskCompleted": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "ConfigChange": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "WorktreeCreate": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "WorktreeRemove": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }],
    "Setup": [{ "matcher": ".*", "type": "command", "command": "bun run <handler-path>" }]
  }
}
```

- `<handler-path>` resolves to the absolute path of `src/handler/index.ts` within the installed package
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
2. Check if already installed -> if yes, uninstall first
3. Generate plugin.json + hooks.json at package root
4. Run: claude plugin install <package-root-path>
5. Verify registration succeeded
```

### Uninstall Flow

```text
1. hookwatch uninstall
2. Run: claude plugin uninstall hookwatch
3. Clean up generated plugin.json + hooks.json if they exist at package root
4. Verify uninstall succeeded
```

### Distribution Model

- `npm install -g hookwatch` installs the package globally
- `hookwatch install` calls `claude plugin install` internally
- `claude plugin install` is an implementation detail, not user-facing
- Same model as beads-tracker

### Testing

- Mock `claude plugin install` and `claude plugin uninstall` shell calls — do not actually invoke Claude Code in tests
- Test that generated `hooks.json` contains all 18 event types
- Test that `plugin.json` version matches `package.json` version
- Test reinstall behavior: install -> install again should uninstall first

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
