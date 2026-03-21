# Querying

You can query the hookwatch SQLite database directly with `sqlite3` or any
SQLite client.

## Examples

### All events from a session

```sh
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT timestamp, event, tool_name FROM events WHERE session_id = 'abc123'"
```

### Count events by type

```sh
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT event, COUNT(*) FROM events GROUP BY event ORDER BY COUNT(*) DESC"
```

### Tool usage in the last hour

```sh
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT tool_name, COUNT(*) FROM events
   WHERE event = 'PreToolUse'
     AND timestamp > (strftime('%s', 'now') - 3600) * 1000
   GROUP BY tool_name"
```

### hookwatch handler time per event type

```sh
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT event, AVG(hook_duration_ms), MAX(hook_duration_ms)
   FROM events GROUP BY event ORDER BY AVG(hook_duration_ms) DESC"
```

### Permission request frequency

```sh
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT tool_name, COUNT(*) FROM events
   WHERE event = 'PermissionRequest'
   GROUP BY tool_name
   ORDER BY COUNT(*) DESC"
```

### Wrapped vs bare events

```sh
sqlite3 ~/.local/share/hookwatch/hookwatch.db \
  "SELECT
     CASE WHEN wrapped_command IS NOT NULL THEN 'wrapped' ELSE 'bare' END AS mode,
     COUNT(*)
   FROM events
   GROUP BY mode"
```

## Web UI

The web UI at `http://localhost:6004` provides the same querying capabilities
with a graphical interface. Run `hookwatch ui` to open it.
