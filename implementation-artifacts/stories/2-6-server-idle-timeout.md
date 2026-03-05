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
- [ ] Add integration test case to `tests/handler-server.test.ts` — start server with short idle timeout, wait for shutdown, fire a mock hook event via `src/handler/index.ts`, verify server auto-restarts and event is delivered successfully (AC: #3)
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

### SQLite Recovery

- No special cleanup needed — SQLite WAL mode handles crash recovery
- `db.close()` is a best-effort cleanup, not a hard requirement
- If the process is killed before `db.close()`, the WAL file persists and SQLite recovers on next open

### Auto-Start Recovery (AC #3)

- This AC depends on Story 1.5 (Server Auto-Start from Handler)
- When the server shuts down from idle timeout, the next hook event triggers the handler
- The handler detects connection refused, spawns a new server instance
- Verify via integration test: start server → wait for idle shutdown → send hook event → confirm delivery

### Testing Strategy

- For idle timeout tests, use a very short timeout (e.g., 100ms) to avoid slow tests
- Override the idle timeout via the `HOOKWATCH_IDLE_TIMEOUT_MS` environment variable —
  the server reads this at startup and uses it instead of the config file value when
  present. Production code checks `process.env.HOOKWATCH_IDLE_TIMEOUT_MS` before
  falling back to the TOML config and then the 30-minute default. Tests set this env
  var to `"100"` so the timer fires quickly without modifying production logic
- Verify `process.exit` is called (mock or check process exit code)

### Export Contracts

This story depends on two exports from earlier stories. Both must be available
before graceful shutdown can be wired up correctly.

**`db.close()` — Story 1.1 contract**

`src/db/connection.ts` must export a `close()` function that closes the
`bun:sqlite` database handle cleanly:

```ts
// src/db/connection.ts
export function close(): void {
  db.close();
}
```

The server calls `close()` as the second step of graceful shutdown. This is a
cross-story contract: Story 1.1 owns the implementation, Story 2.6 is the
consumer. If Story 1.1 did not export `close()`, add it now.

**`closeAll()` — Story 2.4 contract**

`src/server/stream.ts` must export a `closeAll()` function that iterates the
active SSE client set and closes every writer:

```ts
// src/server/stream.ts
export function closeAll(): void {
  for (const writer of clients) {
    try { writer.close(); } catch { /* already closed */ }
  }
  clients.clear();
}
```

The server calls `closeAll()` as the first step of graceful shutdown (before
closing the database). This is a cross-story contract: Story 2.4 owns the
implementation, Story 2.6 is the consumer. If Story 2.4 did not export
`closeAll()`, add it now.

### Graceful Shutdown Order

The shutdown sequence must follow this order to avoid writing to a closed DB
while SSE clients are still connected:

1. Log shutdown reason: `[INFO] Server shutting down: idle timeout (30m)`
2. Call `closeAll()` from `@/server/stream.ts` — close all active SSE connections
3. Call `close()` from `@/db/connection.ts` — close the SQLite handle
4. Call `process.exit(0)`

### Dependencies

- Story 1.1: SQLite database layer (`src/db/connection.ts`) — must export `close()`
- Story 1.3: Bun server (`src/server/index.ts`) — idle timer and graceful shutdown added here
- Story 1.5: server auto-start from handler (`src/handler/spawn.ts`) — required for AC #3 recovery path
- Story 2.4: SSE live updates (`src/server/stream.ts`) — must export `closeAll()`

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
- [Source: ./planning-artifacts/prd.md#Bun Server]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
