# Story 2.1: Serve Web UI & Event List Page

Status: ready-for-dev

## Story

As a Claude Code developer,
I want to open a browser and see a chronological list of hook events,
so that I can review what the agent did.

## Acceptance Criteria

1. **Given** the Bun server is running, **when** a browser navigates to
   `http://localhost:6004`, **then** `index.html` is served with Pico CSS loaded,
   and `.ts` files are transpiled on-the-fly via `Bun.Transpiler` and served with
   `Content-Type: application/javascript`.

2. **Given** events exist in the database, **when** the event list page loads,
   **then** events are displayed in reverse chronological order (newest first),
   and each row shows: timestamp, event type, session ID, tool name (if
   applicable).

3. **Given** no events exist in the database, **when** the event list page loads,
   **then** an empty state message is displayed.

## Tasks / Subtasks

- [ ] Create `src/server/static.ts` — static file handler that serves files from `src/ui/`, transpiles `.ts` files on-the-fly via `Bun.Transpiler` with `Content-Type: application/javascript`, caches transpiled output in an in-memory `Map` keyed by file path + mtime (AC: #1)
- [ ] Register static file routes in `src/server/index.ts` — route `/` to `index.html`, route `/*.ts` and nested paths to the transpiler handler (AC: #1)
- [ ] Create `src/ui/index.html` — shell HTML that loads Pico CSS from CDN (`<link>`), loads `app.ts` as `<script type="module">` (AC: #1)
- [ ] Create `src/ui/app.ts` — Preact app entry point using htm tagged template literals, define `eventList` signal, render root component, mount to DOM (AC: #1, #2, #3)
- [ ] Create `src/ui/events/event-list.ts` — Preact component that fetches events via `POST /api/query` on mount, renders reverse-chronological list with columns: timestamp, event type, session ID, tool name (AC: #2)
- [ ] Implement empty state rendering in `event-list.ts` — display a message when the event list is empty (AC: #3)
- [ ] Create `src/server/query.ts` — `POST /api/query` handler that accepts a filter object, validates with `src/schemas/query.ts`, queries `src/db/queries.ts`, returns JSON array of events (AC: #2)
- [ ] Create `src/schemas/query.ts` — Zod schema for the query filter object (AC: #2)
- [ ] Add query helpers in `src/db/queries.ts` — parameterized SELECT for events with optional filters, ORDER BY ts DESC (AC: #2)
- [ ] Write Playwright integration test — verify index.html loads with Pico CSS, event list renders sample events in correct order, empty state displays when no events exist (AC: #1, #2, #3)
- [ ] Verify `bun test` passes and server serves UI correctly from clean state (AC: #1, #2, #3)

## Dev Notes

### Frontend Stack

- **Framework**: Preact + htm (tagged template literals). All UI files are `.ts` — NO JSX, NO TSX
- **State**: Preact signals (~1KB) — `eventList` signal drives the event list component
- **Styling**: Pico CSS (~10KB) loaded from CDN — semantic HTML is auto-styled, dark mode built-in
- **NEVER** use `innerHTML` or `dangerouslySetInnerHTML` (AGENTS.md rule ch-u88)
- htm auto-escapes all interpolated values — XSS prevention by design

### UI Delivery

- `Bun.Transpiler` transpiles `.ts` to JS on-the-fly when the server receives a request for a `.ts` file
- In-memory `Map` cache keyed by `filePath + mtime` — each file transpiled once per server session, invalidated when mtime changes
- Served with `Content-Type: application/javascript`
- No `.js` files on disk, no build step, no service worker, no pre-built artifacts
- ~15 UI files x sub-millisecond per file = <10ms cold start

### Query Endpoint

- `POST /api/query` with filter object — one route handles all query types
- Filter schema defined in `src/schemas/query.ts` using Zod
- All SQL queries in `src/db/queries.ts` must use parameterized `?` placeholders (ch-lar)
- Error format: `{ "error": { "code": "INVALID_QUERY", "message": "..." } }`

### Event List Component

- Fetch events on mount via `POST /api/query {}` (empty filter = all events)
- Display in reverse chronological order (`ORDER BY ts DESC`)
- Each row: timestamp (formatted from Unix epoch ms), event type, session_id, tool_name (or empty)
- Use semantic HTML elements (`<table>` or `<article>`) — Pico CSS auto-styles them

### Naming Conventions

- snake_case for database columns and JSON API fields
- camelCase for TypeScript code
- kebab-case for file names

### Project Structure Notes

```text
src/
  server/
    index.ts         — route dispatch (add static + query routes)
    static.ts        — serves src/ui/ files, transpiles .ts on-the-fly
    query.ts         — POST /api/query handler
  schemas/
    query.ts         — Zod schema for query filter
  db/
    queries.ts       — add SELECT helpers with filter support
  ui/
    index.html       — shell HTML, loads Pico CSS CDN + app.ts
    app.ts           — Preact app entry, signal definitions
    events/
      event-list.ts  — chronological event list component
```

- Path alias: `@/` maps to `./src/` via tsconfig.json `paths`
- No server-side rendering — Preact mounts client-side

### Dependencies

- Story 1.1: database layer (`@/db/connection`, `@/db/queries`, `@/db/schema`) must exist for query helpers
- Story 1.2: Zod schemas (`@/schemas/events`) used by the ingest path that feeds these queries
- Story 1.3: Bun server (`src/server/index.ts`, `src/server/ingest.ts`) — this story extends the existing server

### Testing

- Playwright for browser integration tests — verify HTML served, events rendered, empty state
- Co-locate unit tests for server handlers (e.g., `src/server/static.test.ts`)
- Integration tests in `tests/` directory

### References

- [Source: ./planning-artifacts/architecture.md#Frontend Architecture]
- [Source: ./planning-artifacts/architecture.md#API & Communication]
- [Source: ./planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/epics.md#Story 2.1]
- [Source: ./planning-artifacts/prd.md#Web UI]
- [Source: ./planning-artifacts/prd.md#Bun Server]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
