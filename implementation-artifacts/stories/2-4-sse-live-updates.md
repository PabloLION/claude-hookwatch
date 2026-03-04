# Story 2.4: SSE Live Updates

Status: ready-for-dev

## Story

As a Claude Code developer,
I want the event list to update in real-time as new events arrive,
so that I can watch agent activity live.

## Acceptance Criteria

1. **Given** the web UI is open in a browser, **when** a new event is ingested
   by the server, **then** the server pushes the event via
   `GET /api/events/stream` (SSE), and the event list updates automatically
   without page refresh.

2. **Given** the SSE connection drops (e.g., server restart), **when** the
   browser detects the disconnection, **then** `EventSource` reconnects
   automatically.

3. **Given** the session filter is active, **when** a new event arrives via SSE,
   **then** it only appears in the list if it matches the active session filter.

## Tasks / Subtasks

- [ ] Create `src/server/stream.ts` — SSE endpoint handler for `GET /api/events/stream`, maintains a `Set` of connected response writers, sends `data: {json}\n\n` format (AC: #1)
- [ ] Register SSE route in `src/server/index.ts` — route `GET /api/events/stream` to the stream handler (AC: #1)
- [ ] Implement client broadcast in `src/server/stream.ts` — export a `broadcast(event)` function that iterates over all connected SSE clients and writes the event JSON (AC: #1)
- [ ] Integrate broadcast into `src/server/ingest.ts` — after successful event insertion into SQLite, call `broadcast(event)` to push to all SSE clients (AC: #1)
- [ ] Handle SSE client disconnection in `src/server/stream.ts` — detect closed connections and remove from the client `Set` (AC: #1, #2)
- [ ] Add SSE client logic in `src/ui/app.ts` or a dedicated `src/ui/shared/sse-client.ts` — create `EventSource` connected to `/api/events/stream`, parse incoming events, push to `eventList` signal (AC: #1, #2)
- [ ] Implement client-side session filter check — before adding an SSE event to `eventList`, check if `activeSession` signal is set and if the event's `session_id` matches (AC: #3)
- [ ] Handle EventSource reconnection — `EventSource` auto-reconnects by default; verify no custom logic overrides this behavior (AC: #2)
- [ ] Insert new events at the beginning of the `eventList` signal array — maintains reverse-chronological order without re-fetching (AC: #1)
- [ ] Write integration test — ingest an event via POST while UI is open, verify event appears in list without refresh (AC: #1)
- [ ] Write integration test — verify SSE respects session filter: ingest event with non-matching session, confirm it does not appear (AC: #3)

## Dev Notes

### Server-Side SSE

- Endpoint: `GET /api/events/stream`
- Response headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- SSE message format: `data: ${JSON.stringify(event)}\n\n`
- Maintain a `Set<WritableStreamDefaultWriter>` (or equivalent Bun response writers) of connected clients
- On new event ingest (in `ingest.ts`), call `broadcast(event)` which iterates the set and writes to each client
- On client disconnect, remove from the set — detect via request abort signal or write error

### Client-Side SSE

- Use browser-native `EventSource` API — no polyfill needed
- `EventSource` auto-reconnects on disconnect with exponential backoff — this is built-in behavior
- On `message` event, parse `event.data` as JSON, prepend to `eventList` signal
- No polling — pure push via SSE

### Session Filter Integration

- Before adding a received SSE event to `eventList`, check `activeSession` signal
- If `activeSession` is `null` (All sessions), always add the event
- If `activeSession` is set, only add the event if `event.session_id === activeSession.value`
- This is a client-side filter — the SSE stream sends all events regardless of filter state

### Bun.serve SSE Pattern

Bun's `Bun.serve` returns a `Response` object. For SSE, use a `ReadableStream` with a controller that stays open:

```ts
new Response(
  new ReadableStream({
    start(controller) {
      // Add controller to client set
      // On data: controller.enqueue(encoder.encode(`data: ${json}\n\n`))
    },
    cancel() {
      // Remove controller from client set
    },
  }),
  { headers: { "Content-Type": "text/event-stream" } }
)
```

### Dependencies

- Story 2.1: event list page — provides `src/ui/events/event-list.ts` and `eventList` signal in `src/ui/app.ts`, and `src/server/ingest.ts` which this story modifies to call `broadcast()`
- Story 1.3: ingest endpoint (`src/server/ingest.ts`) — must exist for `broadcast()` integration
- Story 2.2: session filter — `activeSession` signal must exist in `src/ui/app.ts` for the client-side SSE filter check

### Naming Conventions

- snake_case for JSON event fields (`session_id`, `tool_name`)
- camelCase for TypeScript code (`eventList`, `activeSession`, `broadcast`)
- kebab-case for file names (`sse-client.ts`)

### Project Structure Notes

```text
src/
  server/
    index.ts       — add GET /api/events/stream route
    stream.ts      — SSE endpoint handler + broadcast function (new)
    ingest.ts      — call broadcast() after event insertion
  ui/
    app.ts         — add EventSource client logic (or delegate to shared/)
    shared/
      sse-client.ts  — optional: dedicated SSE client module
    events/
      event-list.ts  — prepend SSE events to signal
```

### References

- [Source: ./planning-artifacts/architecture.md#API & Communication]
- [Source: ./planning-artifacts/architecture.md#Frontend Architecture]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/epics.md#Story 2.4]
- [Source: ./planning-artifacts/prd.md#Web UI]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
