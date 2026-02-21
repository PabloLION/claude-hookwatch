# claude-hookwatch

Claude Code plugin that logs all 14 hook event types to local JSONL files.

## Features

- Covers all 14 hook events (PreToolUse, PostToolUse, Stop, SessionStart, etc.)
- Installs as a Claude Code plugin — one command in, one command out
- Logs to daily-rotated JSONL files — greppable, portable, no database
- Zero external dependencies (Python stdlib only)
- Fully offline — no network calls, no server, no ports

## Installation

```sh
claude plugin install /path/to/claude-hookwatch
```

To uninstall:

```sh
claude plugin remove claude-hookwatch
```

## Log Location

Logs are written to `~/.claude/hookwatch/YYYY-MM-DD.jsonl`, one file per day.

## JSONL Schema

Each line is a JSON object:

```json
{
  "ts": "2026-02-18T15:30:00.000Z",
  "event": "PreToolUse",
  "session_id": "abc123",
  "cwd": "/path/to/project",
  "tool_name": "Bash",
  "data": {}
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ts` | string | ISO 8601 timestamp |
| `event` | string | Hook event type |
| `session_id` | string | Claude Code session identifier |
| `cwd` | string | Working directory at time of event |
| `tool_name` | string | Tool name (tool events only) |
| `data` | object | Full event payload from stdin |

## Hook Events

All 14 Claude Code hook event types are captured:

| Event | Description |
|-------|-------------|
| PreToolUse | Before a tool executes |
| PostToolUse | After a tool executes successfully |
| PostToolUseFailure | After a tool execution fails |
| UserPromptSubmit | When the user submits a prompt |
| Notification | System notifications |
| PermissionRequest | When a permission is requested |
| Stop | When the agent stops |
| SessionStart | Session begins |
| SessionEnd | Session ends |
| SubagentStart | Sub-agent spawned |
| SubagentStop | Sub-agent finished |
| PreCompact | Before context compaction |
| TeammateIdle | Teammate becomes idle |
| TaskCompleted | Task marked complete |

## Querying Logs

Basic filtering with standard tools:

```sh
# All events from today
cat ~/.claude/hookwatch/2026-02-20.jsonl

# Filter by event type
grep '"event":"PreToolUse"' ~/.claude/hookwatch/2026-02-20.jsonl

# Filter by tool name
grep '"tool_name":"Bash"' ~/.claude/hookwatch/2026-02-20.jsonl | jq .

# Count events by type
jq -r '.event' ~/.claude/hookwatch/2026-02-20.jsonl | sort | uniq -c | sort -rn
```

A dedicated query skill is planned for future versions.

## Prior Art

- [disler/claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability) — real-time dashboard with 12 events and SQLite, but no plugin system
- [karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks) — single-file JSONL logger, closest approach to ours, no plugin system
- [DazzleML/claude-session-logger](https://github.com/DazzleML/claude-session-logger) — only plugin-compliant tool found, but covers only 2 of 14 event types

## License

[MIT](./LICENSE)
