# Story 2.5: hookwatch open Command

Status: ready-for-dev

## Story

As a Claude Code developer,
I want to run `hookwatch open` to start the server and open the browser,
so that I can view events even when the server timed out.

## Acceptance Criteria

1. **Given** the Bun server is not running, **when** `hookwatch open` is run,
   **then** the server is started on the default port (or auto-incremented), and
   the web UI is opened in the default browser.

2. **Given** the Bun server is already running, **when** `hookwatch open` is
   run, **then** it opens the browser to the existing server's URL without
   starting a second instance.

3. **Given** `hookwatch open --port 7000` is run, **when** port 7000 is
   available, **then** the server starts on port 7000.

4. **Given** `hookwatch open --port 7000` is run, **when** port 7000 is
   occupied, **then** an error is displayed: "port 7000 in use" (no
   auto-increment on explicit port).

## Tasks / Subtasks

- [ ] Create `src/cli/open.ts` — citty subcommand definition for `hookwatch open` with `--port` flag (number type, optional) (AC: #1, #3)
- [ ] Implement server detection — read port from `~/.claude/hookwatch/hookwatch.port`; if file exists, attempt `GET /health` on that port; if file absent or health check fails, server is not running (AC: #2)
- [ ] Implement server start logic — if server not running, spawn Bun server as a detached background process using the `spawnServer` function from `src/handler/spawn.ts`, then poll `GET /health` until ready (AC: #1)
- [ ] Implement port auto-increment — when no explicit `--port` flag, try default port 6004, then 6005, 6006, etc. until a free port is found (AC: #1)
- [ ] Implement explicit port error — when `--port` is specified and the port is occupied (either by hookwatch or another process), display error "port {N} in use" and exit 1 (AC: #4)
- [ ] Implement browser open — after server is confirmed running, open the web UI URL in the default browser using `Bun.spawn(["open", url])` on macOS and `xdg-open` on Linux (AC: #1, #2)
- [ ] Detect platform for browser open command — use `process.platform` to choose between `open` (darwin) and `xdg-open` (linux) (AC: #1, #2)
- [ ] Register `open` subcommand in `src/cli/index.ts` — add to citty main command (AC: #1)
- [ ] Write unit test for port detection logic — verify health check correctly identifies running/not-running server (AC: #2)
- [ ] Write integration test — verify `hookwatch open` starts server when not running, opens browser, and handles already-running case (AC: #1, #2)
- [ ] Write unit test for explicit port error — verify error message and exit code when port is occupied (AC: #4)

## Dev Notes

### Server Detection

- Before starting the server, read `~/.claude/hookwatch/hookwatch.port` to
  discover the port of an already-running server
- If the file exists, read the port from it and attempt `GET http://localhost:{port}/health`
  with a short timeout (e.g., 500ms)
  - If 200 OK: server is running on that port, skip to browser open
  - If connection refused or timeout: server is not running (stale port file),
    proceed to start
- If the file does not exist: server is not running, proceed to start

### Port Logic

- Port discovery for a running server: read `~/.claude/hookwatch/hookwatch.port`
- Default port: 6004 (from architecture), used when starting a new server instance
- **No explicit `--port`**: auto-increment if 6004 is occupied (try 6005, 6006...)
- **Explicit `--port N`**: if port N is occupied, error "port N in use" — no auto-increment
- This matches the server's own port behavior (Story 1.3) but adds the explicit-port guard

### Browser Open

- macOS: `Bun.spawn(["open", url])`
- Linux: `Bun.spawn(["xdg-open", url])`
- Windows: not supported in v0 (Bun runtime dependency)
- URL format: `http://localhost:{port}`

### CLI Framework

- citty subcommand registered in `src/cli/index.ts`
- Flag: `--port` with number type, optional
- citty handles `--help` and `--version` automatically

### Reuse Patterns

- Server spawn logic: call `spawnServer` from `src/handler/spawn.ts` (Story 1.5) directly — do not duplicate the spawn + health-poll logic in `open.ts`
- Health check endpoint: `GET /health` returns 200 OK (Story 1.3)

### Dependencies

- Story 1.3: Bun server — provides `GET /health` endpoint used for server detection, and `src/server/index.ts` to be spawned
- Story 1.5: server auto-start spawn logic (`src/handler/spawn.ts`) — `spawnServer` is called directly from `open.ts` for starting the server
- Story 1.6: CLI framework (`src/cli/index.ts`) — the `open` subcommand stub registered there is implemented in this story

### Naming Conventions

- camelCase for TypeScript code (`openCommand`, `serverPort`, `isServerRunning`)
- kebab-case for file names (`open.ts`)

### Project Structure Notes

```text
src/
  cli/
    index.ts    — register open subcommand
    open.ts     — hookwatch open implementation (new)
  handler/
    spawn.ts    — server spawn + health-poll logic (called from open.ts)
```

### References

- [Source: ./planning-artifacts/architecture.md#CLI & Distribution]
- [Source: ./planning-artifacts/architecture.md#Server Configuration]
- [Source: ./planning-artifacts/architecture.md#Handler-Server Coordination]
- [Source: ./planning-artifacts/epics.md#Story 2.5]
- [Source: ./planning-artifacts/prd.md#CLI — hookwatch open]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
