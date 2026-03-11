# claude-hookwatch

See what Claude did, debug your hooks, query your sessions — as a Claude Code
plugin that captures all 18 hook event types and stores them in a local SQLite
database with a web UI for browsing and querying.

## Features

- Installs as a Claude Code plugin — one command in, one command out
- Web UI for real-time event browsing and filtering
- SQLite storage via `bun:sqlite` — fast queries, WAL mode, zero external deps
- Covers all 18 hook events (PreToolUse, PostToolUse, SessionStart, etc.)
- Zod validation of all stdin payloads
- Localhost-only, zero external deps — no network calls, no accounts, no config

## Install

```sh
bun install
```

## Dev Commands

```sh
bun run dev      # start server with --watch (auto-reload on file changes)
bun test         # run test suite
bun run lint     # lint and format check (Biome)
```

## Installation

```sh
claude plugin install /path/to/claude-hookwatch
```

To uninstall:

```sh
claude plugin remove claude-hookwatch
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
ts,TEXT,ISO 8601 timestamp (generated at write time)
event,TEXT,Hook event type (e.g. PreToolUse)
session_id,TEXT,From hook stdin
cwd,TEXT,Working directory at time of event
tool_name,TEXT,"Tool name for tool events, NULL otherwise"
session_name,TEXT,Human-readable session name
payload,TEXT,Full event JSON from stdin
hook_duration_ms,INTEGER,hookwatch handler execution time in milliseconds (always NULL — not yet populated by ingest.ts; see ch-95ia)
```

The full stdin schema for all 18 event types is documented in
`./docs/hook-stdin-schema.md`.

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
  "SELECT ts, event, tool_name FROM events WHERE session_id = 'abc123'"

# Count events by type
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT event, COUNT(*) FROM events GROUP BY event ORDER BY COUNT(*) DESC"

# Tool usage in the last hour
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT tool_name, COUNT(*) FROM events
   WHERE event = 'PreToolUse'
     AND ts > datetime('now', '-1 hour')
   GROUP BY tool_name"

# hookwatch handler time per event type (our processing time, not Claude Code tool duration)
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT event, AVG(hook_duration_ms), MAX(hook_duration_ms)
   FROM events GROUP BY event ORDER BY AVG(hook_duration_ms) DESC"
```

The web UI provides the same capabilities with a graphical interface.

## Web UI

hookwatch serves a local web UI on localhost for browsing events:

- Real-time event timeline
- Filter by session, event type, tool name, time range
- Hook execution stats and performance profiling
- Session naming and run tracking

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
