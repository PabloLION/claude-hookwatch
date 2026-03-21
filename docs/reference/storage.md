# Storage

Events are stored in a local SQLite database using `bun:sqlite` with WAL mode.

## Database Location

```text
~/.local/share/hookwatch/hookwatch.db
```

The path respects `$XDG_DATA_HOME` if set:
`$XDG_DATA_HOME/hookwatch/hookwatch.db`

## Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-incrementing event ID |
| `timestamp` | INTEGER NOT NULL | Epoch milliseconds (generated at write time) |
| `event` | TEXT NOT NULL | Hook event type (e.g. PreToolUse) |
| `session_id` | TEXT NOT NULL | From hook stdin |
| `cwd` | TEXT NOT NULL | Working directory at time of event |
| `tool_name` | TEXT | Tool name for tool events, NULL otherwise |
| `session_name` | TEXT | Human-readable session name |
| `hook_duration_ms` | INTEGER | hookwatch handler execution time in milliseconds |
| `stdin` | TEXT NOT NULL | Full event JSON from hook stdin |
| `wrapped_command` | TEXT | Command being wrapped, NULL for bare handler events |
| `stdout` | TEXT | Hook output JSON (bare) or captured child stdout (wrapped); NULL if no output |
| `stderr` | TEXT | Captured child stderr for wrapped events; NULL for bare events |
| `exit_code` | INTEGER NOT NULL DEFAULT 0 | Exit code of the hook or wrapped child process |
| `hookwatch_log` | TEXT | Internal diagnostics with severity prefix; NULL if no issues |

## Schema Version

Current schema version: **3**. On version mismatch, hookwatch renames the old
database to `hookwatch.db.v<old_version>` and creates a fresh database.
