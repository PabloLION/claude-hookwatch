# Story 1.5: Server Auto-Start from Handler

Status: ready-for-dev

## Story

As a Claude Code developer,
I want the handler to start the Bun server automatically,
so that event capture works without manual setup.

## Acceptance Criteria

1. **Given** the handler POSTs to `/api/events` and gets connection refused,
   **when** auto-start is triggered, **then** the handler spawns the Bun server
   as a detached background process.

2. **Given** the server was just spawned, **when** the handler polls `GET /health`
   at 50ms intervals, **then** it retries for up to 2 seconds.

3. **Given** health check succeeds within the timeout, **when** the handler retries
   the POST, **then** the event is delivered successfully and the handler exits 0.

4. **Given** health check does not succeed within 2 seconds, **when** the timeout
   is reached, **then** the handler exits 1 (non-blocking error).

## Tasks / Subtasks

- [ ] Create `src/handler/spawn.ts` — spawn logic + health probe (AC: #1, #2)
- [ ] Implement `Bun.spawn()` with `detached: true` to run server as background process (AC: #1)
- [ ] Redirect spawned server stdout/stderr to a log file (e.g., `~/.local/share/hookwatch/server.log`) (AC: #1)
- [ ] Implement health probe: `GET /health` at 50ms intervals, max 2s (40 attempts) (AC: #2)
- [ ] On health success, retry the original `POST /api/events` with the event payload (AC: #3)
- [ ] On health timeout (2s), exit 1 — non-blocking error, no retry loop (AC: #4)
- [ ] Integrate spawn logic into `src/handler/index.ts` — trigger on `fetch()` connection refused (AC: #1, #3)
- [ ] Handle port discovery after auto-increment: handler needs to know which port the server landed on (AC: #1, #3)
- [ ] Create `tests/handler-server.test.ts` — integration test for full handler -> spawn -> health probe -> POST -> delivery cycle (AC: #1, #2, #3, #4)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2, #3, #4)

## Dev Notes

### Spawn Mechanics

- Use `Bun.spawn()` with `detached: true` — the server process must outlive the handler
- Redirect stdout/stderr to `~/.local/share/hookwatch/server.log` (append mode)
- The spawned command: `bun run src/server/index.ts`
- The handler must `unref()` the child process so it does not block handler exit

### Health Probe Protocol

```text
1. Handler catches connection refused on initial POST
2. Spawn Bun server (detached)
3. Loop: GET http://127.0.0.1:6004/health
   - 200 OK -> break, proceed to retry POST
   - Connection refused / error -> wait 50ms, retry
   - Max 40 attempts (50ms * 40 = 2000ms)
4. If loop exhausts -> exit 1
5. If health OK -> POST /api/events with original payload
6. If POST succeeds -> exit 0
7. If POST fails -> exit 1
```

### Port Discovery

The server may auto-increment its port if 6004 is in use (Story 1.3). The handler needs to discover the actual port. Options for v0:

- Try port 6004 first; on connection refused after spawn, try 6005, 6006, etc.
- Or: server writes its port to a known file (e.g., `~/.local/share/hookwatch/port`)
- Decision: implement during development based on complexity. The port file approach is simpler and more reliable

### Race Condition Risk

Two handlers may fire simultaneously, both get connection refused, both try to spawn. This is a known risk (ch-b5o, P2). v0 workaround:

- Both spawn attempts are harmless — second `Bun.spawn()` either starts a second server (which exits on port conflict) or the OS rejects the port bind
- The health probe will connect to whichever server claimed the port
- No locking mechanism in v0

### Error Handling

- Auto-start failure must never propagate to Claude Code
- Exit 1 on timeout is the only signal — Claude Code continues uninterrupted
- Log errors to stderr for verbose mode visibility

### Dependencies

- Story 1.3: Bun server (`src/server/index.ts`) must exist to be spawned
- Story 1.4: Handler (`src/handler/index.ts`) integrates the spawn trigger

### Project Structure Notes

```text
src/
  handler/
    index.ts         — integrates spawn on connection refused
    spawn.ts         — spawn + health probe logic
tests/
  handler-server.test.ts  — integration test (handler -> server round-trip)
```

### References

- [Source: ./planning-artifacts/architecture.md#Handler-Server Coordination]
- [Source: ./planning-artifacts/architecture.md#Security Hardening (Red Team Analysis)] — spawn race condition (ch-b5o)
- [Source: ./planning-artifacts/architecture.md#Server Configuration]
- [Source: ./planning-artifacts/epics.md#Story 1.5]
- [Source: ./planning-artifacts/prd.md#Bun Server]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
