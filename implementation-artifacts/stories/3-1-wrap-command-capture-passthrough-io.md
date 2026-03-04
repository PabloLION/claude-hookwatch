# Story 3.1: Wrap Command — Capture & Passthrough I/O

Status: ready-for-dev

## Story

As a hook author,
I want to wrap any command to capture its stdin, stdout, and stderr,
so that I can see exactly what data flows through my hook.

## Acceptance Criteria

1. **Given** `hookwatch wrap -- my-hook-script.sh` runs, **when** the wrapped
   command executes, **then** stdin is forwarded to the wrapped command, stdout
   and stderr are captured and forwarded to the Bun server via
   `POST /api/events`, and the wrapped command's stdout/stderr are passed through
   to the terminal (tee behavior).

2. **Given** the wrapped command exits, **when** the wrap process completes,
   **then** the exit code, stdout, stderr, and the original command are stored as
   a wrap event with `event: "Wrap"` type in the events table.

3. **Given** the Bun server is not running, **when** `hookwatch wrap` is run,
   **then** the server is auto-started using the same spawn logic as Story 1.5.

## Tasks / Subtasks

- [ ] Create `src/cli/wrap.ts` — citty subcommand definition for `hookwatch wrap` with `--` separator for wrapped command arguments (AC: #1, #2, #3)
- [ ] Register `wrap` subcommand in `src/cli/index.ts` (AC: #1)
- [ ] Implement child process spawning with piped stdio — use `Bun.spawn()` with `stdin: "pipe"`, `stdout: "pipe"`, `stderr: "pipe"` (AC: #1)
- [ ] Implement stdin forwarding — pipe `process.stdin` to child process stdin (AC: #1)
- [ ] Implement tee behavior for stdout — read from child stdout stream, write to both `process.stdout` and accumulate in a buffer (AC: #1)
- [ ] Implement tee behavior for stderr — read from child stderr stream, write to both `process.stderr` and accumulate in a buffer (AC: #1)
- [ ] Wait for child process exit — capture exit code from child process (AC: #2)
- [ ] Build wrap event payload — JSON object with `stdout`, `stderr`, `exit_code`, and original command array in the `payload` column (AC: #2)
- [ ] POST wrap event to `/api/events` with `event: "Wrap"` type after child process completes (AC: #1, #2)
- [ ] Integrate auto-start logic — reuse spawn + health probe from `src/handler/spawn.ts` when server is unreachable (AC: #3)
- [ ] Implement best-effort capture — if server is unreachable after auto-start attempt, still pass through I/O to terminal (do not fail the wrapped command) (AC: #1, #3)
- [ ] Forward child process exit code as the `hookwatch wrap` exit code (AC: #2)
- [ ] Create `src/cli/wrap.test.ts` — unit tests with mock child process covering tee behavior, exit code capture, event POST, and auto-start fallback (AC: #1, #2, #3)

## Dev Notes

### CLI Integration

- citty subcommand in `src/cli/wrap.ts`
- Command syntax: `hookwatch wrap -- <command> [args...]`
- Everything after `--` is the wrapped command and its arguments
- The `wrap` exit code must match the wrapped command's exit code so callers observe the same behavior as running the command directly

### Tee Implementation

- Spawn the wrapped command with all three stdio streams piped
- For stdout and stderr: read chunks from the child process stream, write each chunk to both the corresponding `process.stdout`/`process.stderr` AND append to an in-memory `Buffer`/`Uint8Array`
- stdin forwarding: pipe `process.stdin` directly to the child's stdin — do not buffer or transform
- stdin is NOT captured or buffered — it is piped through without accumulation, so no `stdin` field appears in the wrap event payload
- Use `Bun.spawn()` — Bun's native process API, not Node.js `child_process`

### Wrap Event Schema

The wrap event reuses the single `events` table (no separate wrap table per ch-2db deferral). Wrap-specific data is stored in the `payload` JSON column:

```json
{
  "command": ["my-hook-script.sh", "arg1", "arg2"],
  "stdout": "captured stdout text",
  "stderr": "captured stderr text",
  "exit_code": 0
}
```

Common columns populated:

```csv
Column,Value
event,"Wrap"
ts,Date.now() at wrap completion
session_id,generated or empty string (wrap is not a Claude Code session event)
cwd,process.cwd() of the hookwatch wrap invocation
tool_name,null
session_name,null
hook_duration_ms,elapsed time of wrapped command execution
payload,JSON with command/stdout/stderr/exit_code
```

### Auto-Start

- Reuse `src/handler/spawn.ts` — same spawn logic as Story 1.5
- Flow: attempt POST to `/api/events` -> connection refused -> spawn server -> poll `/health` at 50ms intervals (max 2s) -> retry POST
- If server still unreachable after auto-start: log warning to stderr, still pass through I/O (capture is best-effort, passthrough is mandatory)

### Error Handling

- If POST to server fails (after auto-start attempt), the wrapped command's I/O must still pass through to the terminal — capture is best-effort
- The exit code of `hookwatch wrap` is always the child process exit code, regardless of whether the event was successfully POSTed
- Never swallow errors from the wrapped command — the user must see exactly the same stdout/stderr/exit code as running the command directly

### Security

- Parameterized SQL only when server ingests wrap events (ch-lar)
- No innerHTML in any related UI (ch-u88) — though UI is Story 3.2
- Wrap payloads may contain sensitive data (same plaintext storage model as hook events)

### Project Structure Notes

```text
src/
  cli/
    index.ts        — register wrap subcommand here
    wrap.ts         — citty subcommand: spawn, tee, POST
    wrap.test.ts    — unit tests (mock child process)
  handler/
    spawn.ts        — reused for auto-start logic
```

- Path alias: `@/` maps to `./src/`
- File naming: kebab-case
- Code style: camelCase TypeScript

### Dependencies

- Story 1.3: Bun server — provides `POST /api/events` ingest endpoint that this story POSTs wrap events to
- Story 1.5: server auto-start spawn logic (`src/handler/spawn.ts`) — reused for auto-starting the server when unreachable
- Story 1.6: CLI framework (`src/cli/index.ts`) — the `wrap` subcommand stub registered there is implemented in this story

### References

- [Source: ./planning-artifacts/architecture.md#CLI & Distribution]
- [Source: ./planning-artifacts/architecture.md#API & Communication]
- [Source: ./planning-artifacts/architecture.md#Data Architecture]
- [Source: ./planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: ./planning-artifacts/architecture.md#Process Patterns]
- [Source: ./planning-artifacts/epics.md#Story 3.1]
- [Source: ./planning-artifacts/prd.md#CLI — hookwatch wrap]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
