# claude-hookwatch

See what Claude did, debug your hooks, query your sessions — local
observability for Claude Code with SQLite storage and a live web UI.

## Quick Start

Get from zero to seeing events in under 2 minutes:

```sh
# 1. Clone and install
git clone https://github.com/PabloLION/claude-hookwatch.git
cd claude-hookwatch
bun install

# 2. Start Claude Code with hookwatch
claude --plugin-dir "$PWD"

# 3. Use Claude normally — every hook event is captured

# 4. Open the web UI to browse events
hookwatch ui
```

The web UI opens at `http://localhost:6004` with a live-updating event timeline.

## Demo

> Demo coming soon — a short walkthrough showing hookwatch capturing events
> in real time.

## Features

- **Plugin install** — `hookwatch install` registers the plugin, `hookwatch uninstall` removes it cleanly
- **18 hook events** — PreToolUse, PostToolUse, SessionStart, Stop, and 14 more — every event Claude Code emits
- **Web UI** — real-time event timeline with session filter, event detail, and wrap viewer
- **SQLite storage** — `bun:sqlite` with WAL mode, fast queries, zero external deps
- **Zod validation** — all 18 stdin payloads validated at runtime
- **Wrap mode** — wrap any command to capture its stdin/stdout/stderr alongside the hook event
- **SSE live updates** — events appear in the UI as they happen, no polling
- **Offline-first** — localhost only, no network calls, no accounts, no config files required

## Web UI

hookwatch serves a local web UI at `http://localhost:6004`:

- Real-time event timeline with SSE live updates
- Filter by session, event type, tool name, time range
- Event detail viewer with full stdin payload
- Wrap viewer for wrapped command I/O (solid badge = wrapped, outline = bare)

## Install

```sh
hookwatch install
```

For local dev:

```sh
bun install && bun link
```

To uninstall:

```sh
hookwatch uninstall
```

## Dev Commands

```sh
bun run dev      # start server with --watch (auto-reload on file changes)
bun run test     # run test suite (targets src/ and integration test files)
bun run lint     # lint and format check (Biome)
```

## Storage

Events are stored in a SQLite database:

```text
~/.local/share/hookwatch/hookwatch.db
```

The path respects `$XDG_DATA_HOME` if set:
`$XDG_DATA_HOME/hookwatch/hookwatch.db`

```csv
Column,Type,Description
id,INTEGER PRIMARY KEY,Auto-incrementing event ID
timestamp,INTEGER NOT NULL,Epoch milliseconds (generated at write time)
event,TEXT NOT NULL,Hook event type (e.g. PreToolUse)
session_id,TEXT NOT NULL,From hook stdin
cwd,TEXT NOT NULL,Working directory at time of event
tool_name,TEXT,"Tool name for tool events, NULL otherwise"
session_name,TEXT,Human-readable session name
hook_duration_ms,INTEGER,hookwatch handler execution time in milliseconds
stdin,TEXT NOT NULL,Full event JSON from hook stdin
wrapped_command,TEXT,"Command being wrapped, NULL for bare handler events"
stdout,TEXT,"Hook output JSON (bare) or captured child stdout (wrapped); NULL if no output"
stderr,TEXT,"Captured child stderr for wrapped events; NULL for bare events"
exit_code,INTEGER NOT NULL DEFAULT 0,Exit code of the hook or wrapped child process
hookwatch_log,TEXT,"Internal diagnostics with severity prefix: [error] or [warn]; NULL if no issues"
```

The full stdin schema for all 18 event types is documented in
`./docs/reference/hook-stdin-schema.md`.

## Hook Events

All 18 Claude Code hook event types are captured:

```csv
Event,Description
PreToolUse,Before a tool executes
PostToolUse,After a tool executes successfully
PostToolUseFailure,After a tool execution fails
UserPromptSubmit,When the user submits a prompt
Notification,System notifications
PermissionRequest,When a permission is requested
Stop,When the agent stops
SessionStart,Session begins
SessionEnd,Session ends
SubagentStart,Sub-agent spawned
SubagentStop,Sub-agent finished
PreCompact,Before context compaction
TeammateIdle,Teammate becomes idle
TaskCompleted,Task marked complete
ConfigChange,Configuration changed
WorktreeCreate,Git worktree created
WorktreeRemove,Git worktree removed
InstructionsLoaded,Instructions loaded (SDK-only — not in hooks reference docs)
```

17 events are documented in the [hooks reference](https://code.claude.com/docs/en/hooks).
InstructionsLoaded is the 18th — present in the
[Agent SDK types](https://platform.claude.com/docs/en/agent-sdk/typescript)
(`@anthropic-ai/claude-agent-sdk`) but not yet in the hooks reference.

## Known Limitations

hookwatch is v0 software under active development. These are upstream behaviors,
not hookwatch bugs.

**Plugin system:** The Claude Code plugin system has known issues
([#28540](https://github.com/anthropics/claude-code/issues/28540)) that may
affect installation or operation. If `claude plugin install` fails, use the
`--plugin-dir` flag instead:

```sh
claude --plugin-dir /path/to/claude-hookwatch
```

**Non-interactive mode:** SessionStart does not fire when Claude Code runs in
non-interactive mode (`--print` flag, piped input, or SDK usage). hookwatch will
miss session-start events from these invocations. This is upstream Claude Code
behavior, confirmed with Claude Code 2.1.72.

**Early development:** hookwatch is v0. Feedback and contributions are welcome
— open an issue or PR.

## Querying

SQL queries against the SQLite database:

```sh
# All events from a session
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT timestamp, event, tool_name FROM events WHERE session_id = 'abc123'"

# Count events by type
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT event, COUNT(*) FROM events GROUP BY event ORDER BY COUNT(*) DESC"

# Tool usage in the last hour (timestamp is epoch ms)
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT tool_name, COUNT(*) FROM events
   WHERE event = 'PreToolUse'
     AND timestamp > (strftime('%s', 'now') - 3600) * 1000
   GROUP BY tool_name"

# hookwatch handler time per event type (our processing time, not Claude Code tool duration)
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT event, AVG(hook_duration_ms), MAX(hook_duration_ms)
   FROM events GROUP BY event ORDER BY AVG(hook_duration_ms) DESC"
```

The web UI provides the same capabilities with a graphical interface.

## Versioning

```csv
Version,Scope,Description
v0,Core,"Logging + SQLite + basic web UI + plugin system + Zod validation"
v1,Human UX,"UI polish + desktop notifications + waterfall chart + swim lanes"
v2,HITL,"Human-in-the-loop — detect risky actions, ask the human"
v3,Guardrails,"Automated HITL — machine decides based on rules"
```

See `./docs/design.md` for the full design document and feature decisions.

## Prior Art

- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) — real-time dashboard with 12 events and SQLite, no plugin system
- [connerohnesorge/conclaude](https://github.com/connerohnesorge/conclaude) — 18 events, Rust, no plugin system
- [DazzleML/claude-session-logger](https://github.com/DazzleML/claude-session-logger) — only plugin-compliant tool found, covers 2 of 18 events
- [karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks) — 12 events, JSONL logger, no plugin system

hookwatch is the only tool that combines full event coverage, plugin compliance,
and a local web UI — install and browse, no setup beyond `bun install`.

## License

[MIT](./LICENSE)
