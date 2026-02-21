# AGENTS.md — claude-hookwatch

## Project Overview

Claude Code plugin that logs all 14 hook event types to local JSONL files.
Install with `claude plugin install`, uninstall cleanly with `claude plugin remove`.

## File Structure

```text
plugin.json              — Plugin manifest (entry point, metadata)
hooks/
  handler.py             — Single hook handler for all 14 event types
skills/
  hookwatch/
    SKILL.md             — Query skill (future)
```

## Code Conventions

- **Python 3.8+** — stdlib only (`sys`, `json`, `os`, `datetime`, `pathlib`)
- **No external dependencies** — no pip, no uv, no requirements.txt
- **Single handler** — one `handler.py` handles all event types; the event type
  is determined from the JSON payload on stdin
- **No server** — no HTTP, no ports, no WebSocket, no CORS concerns
- **Append-only** — logs are never modified, only appended

## Hook Events (all 14)

```text
PreToolUse          PostToolUse         PostToolUseFailure
UserPromptSubmit    Notification        PermissionRequest
Stop                SessionStart        SessionEnd
SubagentStart       SubagentStop        PreCompact
TeammateIdle        TaskCompleted
```

## JSONL Schema

Log directory: `~/.claude/hookwatch/YYYY-MM-DD.jsonl`

Each line:

```json
{
  "ts": "ISO 8601 timestamp",
  "event": "PreToolUse",
  "session_id": "string",
  "cwd": "/working/directory",
  "tool_name": "Bash",
  "data": {}
}
```

- `tool_name` is present only for tool-related events (PreToolUse, PostToolUse,
  PostToolUseFailure)
- `data` contains the full event payload as received on stdin
- `ts` is generated at write time, not extracted from the payload

## Testing Approach

- Unit tests: mock stdin with sample payloads, verify JSONL output
- Integration: install plugin in a scratch project, trigger events, verify logs
- All 14 event types must have at least one test case
- Test daily rotation (file naming by date)

## Commit Conventions

```text
<type>[scope]: <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Atomic commits — one logical change per commit.
