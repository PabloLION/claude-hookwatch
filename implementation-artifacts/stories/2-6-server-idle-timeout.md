# Story 2.6: Server Idle Timeout

Status: ready-for-dev

## Story

As a Claude Code developer,
I want the Bun server to self-terminate after inactivity,
so that it doesn't consume resources when I'm not using it.

## Acceptance Criteria

1. **Given** the Bun server is running, **when** no events are ingested and no
   HTTP requests are received for the configured timeout period, **then** the
   server shuts down gracefully.

2. **Given** the server is idle and approaching timeout, **when** a new event is
   ingested or an HTTP request arrives, **then** the idle timer resets.

3. **Given** the server has shut down due to idle timeout, **when** a hook event
   fires, **then** the handler auto-starts the server (Story 1.5).

## Tasks / Subtasks

- [ ] Implement idle timer in `src/server/index.ts` — create a `setTimeout` that calls the graceful shutdown function after the configured timeout period (AC: #1)
- [ ] Read timeout configuration — load idle timeout value from `~/.config/hookwatch/config.toml` via smol-toml, with a default of 30 minutes if config is missing or unset (AC: #1)
- [ ] Implement idle timer reset — create a `resetIdleTimer()` function that clears and re-creates the timeout, call it on every incoming request (any endpoint: events, query, static, health, SSE) (AC: #2)
- [ ] Wire idle timer reset into the request handler — add `resetIdleTimer()` call at the top of the Bun.serve fetch handler so every HTTP request resets the timer (AC: #2)
- [ ] Implement graceful shutdown function — close all SSE connections (from `src/server/stream.ts` client set), close the SQLite database connection, log shutdown reason, then call `process.exit(0)` (AC: #1)
- [ ] Verify auto-start recovery — confirm that Story 1.5's handler auto-start logic (`src/handler/spawn.ts`) works correctly after an idle shutdown (AC: #3)
- [ ] Write unit test for idle timer — verify timer fires after configured duration with no activity, and resets when activity occurs (AC: #1, #2)
- [ ] Write integration test — start server, wait for idle timeout (use short timeout in test), verify process exits (AC: #1)
- [ ] Write integration test — start server, send request before timeout, verify timer resets and server stays alive (AC: #2)

## Dev Notes

### Idle Timer Implementation

- Use `setTimeout` / `clearTimeout` in `src/server/index.ts`
- Default timeout: 30 minutes (1,800,000 ms)
- Reset on ANY request to ANY endpoint — not just event ingestion
- The timer runs server-side; no client involvement

### Configuration

- Config file: `~/.config/hookwatch/config.toml` (XDG config directory)
- Parse with smol-toml
- Example config:

```toml
[server]
idle_timeout_minutes = 30
```

- If config file does not exist or `idle_timeout_minutes` is not set, use the default (30 minutes)
- Config is read once at server startup — changes require server restart

### Graceful Shutdown Sequence

1. Log shutdown reason: `[INFO] Server shutting down: idle timeout (30m)`
2. Close all SSE client connections (iterate `src/server/stream.ts` client set, close each writer)
3. Close SQLite database connection (`db.close()`)
4. Call `process.exit(0)`

### SQLite Recovery

- No special cleanup needed — SQLite WAL mode handles crash recovery
- `db.close()` is a best-effort cleanup, not a hard requirement
- If the process is killed before `db.close()`, the WAL file persists and SQLite recovers on next open

### Auto-Start Recovery (AC #3)

- This AC depends on Story 1.5 (Server Auto-Start from Handler)
- When the server shuts down from idle timeout, the next hook event triggers the handler
- The handler detects connection refused, spawns a new server instance
- No additional implementation needed in this story — verify the existing flow works

### Testing Strategy

- For idle timeout tests, use a very short timeout (e.g., 500ms) to avoid slow tests
- Use environment variable or test-specific config to override the default timeout
- Verify `process.exit` is called (mock or check process exit code)

### Naming Conventions

- snake_case for config keys (`idle_timeout_minutes`)
- camelCase for TypeScript code (`resetIdleTimer`, `idleTimeoutMs`, `gracefulShutdown`)
- kebab-case for file names

### Project Structure Notes

```text
src/
  server/
    index.ts     — add idle timer, resetIdleTimer() in fetch handler, graceful shutdown
    stream.ts    — export function to close all SSE connections
  db/
    connection.ts — export function to close database connection
~/.config/hookwatch/
  config.toml    — optional, idle_timeout_minutes setting
```

### References

- [Source: ./planning-artifacts/architecture.md#Server Configuration]
- [Source: ./planning-artifacts/architecture.md#CLI & Distribution]
- [Source: ./planning-artifacts/architecture.md#Process Patterns]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/epics.md#Story 2.6]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
