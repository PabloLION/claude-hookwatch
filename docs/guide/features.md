# Features

## Full Event Coverage

hookwatch captures all 18 Claude Code hook event types. Every tool call,
permission request, session start/stop, and more — nothing is missed.

> Demo coming soon — a short walkthrough showing hookwatch capturing events
> in real time.

## Web UI

hookwatch serves a local web UI at `http://localhost:6004`:

- **Event timeline** — real-time list with SSE live updates, no polling
- **Session filter** — filter events by Claude Code session
- **Event detail** — inspect the full stdin JSON payload for any event
- **Wrap viewer** — see stdout/stderr/exit code for wrapped commands
  (solid badge = wrapped, outline badge = bare handler)

> Demo coming soon — the web UI in action.

## Wrap Mode

Wrap any command to capture its I/O alongside the hook event:

```sh
hookwatch PreToolUse -- my-command --flag
```

hookwatch runs `my-command --flag` as a child process, captures its stdout,
stderr, and exit code, then stores everything in the database alongside the
hook event data. The wrapped command's output is passed through unchanged —
hookwatch is a transparent proxy.

> Demo coming soon — wrapping a command and viewing the captured I/O.

## SQLite Storage

Events are stored in a local SQLite database using `bun:sqlite` with WAL mode
for fast concurrent reads and writes:

```text
~/.local/share/hookwatch/hookwatch.db
```

The path respects `$XDG_DATA_HOME` if set. See [Storage](/reference/storage) for
the full schema.

## Zod Validation

All 18 event stdin payloads are validated at runtime using Zod schemas. Invalid
payloads are logged to the `hookwatch_log` column with an `[error]` prefix —
they are never silently dropped.

## SSE Live Updates

The web UI uses Server-Sent Events for real-time updates. New events appear
instantly without page refresh or polling.

## Offline-First

hookwatch runs entirely on localhost:

- No network calls
- No accounts or API keys
- No cloud storage
- No config files required (sensible defaults)

Install, run, browse.
