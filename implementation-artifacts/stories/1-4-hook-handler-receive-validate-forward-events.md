# Story 1.4: Hook Handler: Receive, Validate & Forward Events

Status: ready-for-dev

## Story

As a Claude Code developer,
I want the hook handler to capture every event and forward it to the server,
so that my agent activity is recorded without interrupting my workflow.

## Acceptance Criteria

1. **Given** Claude Code fires a hook event, **when** the handler reads stdin,
   **then** it parses JSON, validates with Zod, and POSTs to
   `localhost:6004/api/events`, and exits 0 on success.

2. **Given** the server is running and reachable, **when** a valid event is
   processed, **then** the handler completes in <100ms.

3. **Given** the handler encounters any error (parse failure, network error,
   etc.), **when** the error occurs, **then** the handler catches it, never
   propagates to Claude Code, and exits 1. No exception is thrown to the parent
   process.

4. **Given** a hook event with an unknown event type, **when** the handler
   processes it, **then** it is forwarded to the server without error
   (forward-compatible).

## Tasks / Subtasks

- [ ] Create `src/handler/index.ts` — single entry point for all hook events (AC: #1, #3, #4)
- [ ] Read ALL of stdin (Bun stdin API), parse as JSON (AC: #1)
- [ ] Validate parsed JSON with Zod schema from `@/schemas/events` — use discriminated parse by `hook_event_name` (AC: #1, #4)
- [ ] Read server port from `~/.claude/hookwatch/hookwatch.port` (written by Story 1.3); fall back to 6004 if file is absent (AC: #1)
- [ ] POST validated event to `http://127.0.0.1:<port>/api/events` using `fetch()` with a 5-second timeout (AC: #1)
- [ ] Wrap entire handler in top-level try/catch — exit 0 on success, exit 1 on ANY error (AC: #3)
- [ ] Ensure unknown event types pass through fallback schema and are forwarded to server (AC: #4)
- [ ] Add timing measurement — log if handler exceeds 100ms threshold (AC: #2)
- [ ] Create `src/handler/handler.test.ts` — test stdin parsing, Zod validation, successful POST, error handling (exits 1 not throw), unknown event forwarding (AC: #1, #2, #3, #4)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2, #3, #4)

## Dev Notes

### Handler Lifecycle

The handler is a short-lived process invoked by Claude Code for each hook event:

1. Claude Code spawns handler process
2. Handler reads stdin (full buffer, not streaming)
3. Parses JSON from stdin
4. Validates with Zod (strict known fields, passthrough unknown)
5. POSTs to `http://127.0.0.1:6004/api/events`
6. Exits 0 on success

### Error Handling Contract

This is the most critical aspect of the handler:

- **Never throw** — all exceptions caught in top-level try/catch
- **Never block** — if server unreachable, exit 1 immediately (no retry loop in this story; auto-start retry is Story 1.5)
- **Exit 0** = success (Claude Code parses stdout as JSON)
- **Exit 1** = non-blocking error (Claude Code continues, stderr shown in verbose mode only)
- **Exit 2** = blocking error (reserved for critical failures — not used in v0)
- The handler must NEVER propagate an error to Claude Code. A crash in the handler could disrupt the agent

**stdout suppression — critical:** Claude Code reads the handler's stdout and
interprets it as hook output JSON. The handler must exit 0 AND write nothing to
stdout on the normal capture path (this story does not do context injection —
that is Story 4.2). Any accidental `console.log()` written to stdout will be
parsed by Claude Code as a hook response and may cause unexpected behavior. Use
`console.error()` or `process.stderr.write()` for all debug logging.

### stdin Reading

- Use Bun's stdin API to read the complete stdin buffer
- Claude Code sends the full JSON payload as a single write, then closes stdin
- Do not stream — read the entire buffer before parsing

Bun stdin pattern:

```ts
const text = await Bun.stdin.text();      // preferred: reads full buffer
// or, if streaming is needed:
const reader = Bun.stdin.stream().getReader();
```

Use `Bun.stdin.text()` — it awaits EOF and returns the complete string, which
is what Claude Code sends before closing stdin.

### Port Discovery

The server may not be on port 6004 if that port was occupied at startup and the
server auto-incremented (Story 1.3). The handler must not hardcode 6004. The
server writes its actual bound port to `~/.claude/hookwatch/hookwatch.port`
immediately after binding. The handler reads this file to discover the port:

```ts
const portFile = path.join(os.homedir(), ".claude", "hookwatch", "hookwatch.port");
const port = Number(await Bun.file(portFile).text().catch(() => "6004"));
```

If the file is absent (server not yet started), fall back to 6004 — Story 1.5
handles the auto-start retry after a connection refused error.

### fetch Timeout

The `fetch()` call to the local server must have a hard timeout. Without one,
a hung server can cause the handler to block indefinitely, stalling Claude Code.
Use `AbortSignal.timeout()`:

```ts
const response = await fetch(url, {
  method: "POST",
  body: JSON.stringify(payload),
  headers: { "Content-Type": "application/json" },
  signal: AbortSignal.timeout(5000), // 5 seconds
});
```

If the fetch throws (timeout, connection refused, etc.), the top-level
try/catch catches it and the handler exits 1 (non-blocking error).

### Performance Target

- <100ms amortized with warm server (NFR1)
- No transpilation in handler path — Bun runs `.ts` directly (NFR4)
- Single `fetch()` call to localhost is the primary latency source
- Measure `Date.now()` at start and end, log delta to stderr if exceeds threshold

### Forward Compatibility

- Unknown event types must be forwarded without error (FR3, NFR12)
- The fallback schema from Story 1.2 handles this
- The handler must not fail on new fields added by future Claude Code versions

### Dependencies

- Story 1.2: Zod schemas (`@/schemas/events`) for validation
- Story 1.3: Bun server (`POST /api/events`) as the target endpoint

### Project Structure Notes

```text
src/
  handler/
    index.ts         — hook entry point (stdin -> validate -> POST)
    handler.test.ts  — co-located unit test
```

- This is the file referenced in `hooks.json` as the handler command
- Entry: `bun run src/handler/index.ts`

### References

- [Source: ./planning-artifacts/architecture.md#Handler-Server Coordination]
- [Source: ./planning-artifacts/architecture.md#Process Patterns]
- [Source: ./planning-artifacts/architecture.md#Architectural Boundaries]
- [Source: ./planning-artifacts/epics.md#Story 1.4]
- [Source: ./planning-artifacts/prd.md#Event Capture]
- [Source: ./docs/hook-stdin-schema.md#Hook Output Format]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
