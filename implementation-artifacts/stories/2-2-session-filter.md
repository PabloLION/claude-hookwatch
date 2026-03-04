# Story 2.2: Session Filter

Status: ready-for-dev

## Story

As a Claude Code developer,
I want to filter events by session ID,
so that I can focus on what happened in a specific session.

## Acceptance Criteria

1. **Given** the event list is displayed, **when** the session filter component
   loads, **then** it shows a list of available session IDs from the database.

2. **Given** a session ID is selected in the filter, **when** the filter is
   applied, **then** only events matching that session ID are displayed, and the
   query uses `POST /api/query` with the session filter.

3. **Given** the filter is cleared ("All sessions"), **when** the reset option
   is selected, **then** all events are displayed again.

## Tasks / Subtasks

- [ ] Add a distinct session_id query helper in `src/db/queries.ts` — parameterized SELECT DISTINCT session_id FROM events ORDER BY ts DESC (AC: #1)
- [ ] Extend `src/schemas/query.ts` — add optional `session_id` field to the filter schema and add `queryType` discriminator field (values: `"events"` | `"sessions"`) (AC: #1, #2)
- [ ] Extend `src/server/query.ts` — route on `queryType`: when `"sessions"` run DISTINCT session_id query; when `"events"` (default) apply optional `session_id` WHERE clause (AC: #1, #2)
- [ ] Create `src/ui/sessions/session-filter.ts` — Preact component that fetches distinct session IDs on mount and renders a `<select>` dropdown with "All sessions" as the default option (AC: #1, #3)
- [ ] Create `src/ui/sessions/session-list.ts` — helper module for fetching and formatting session list data (AC: #1)
- [ ] Define `activeSession` signal in `src/ui/app.ts` — shared state that drives filtering across components (AC: #2, #3)
- [ ] Wire `session-filter.ts` to `activeSession` signal — on selection change, update signal value (AC: #2)
- [ ] Update `src/ui/events/event-list.ts` — subscribe to `activeSession` signal, re-fetch events via `POST /api/query { "filter": { "session_id": "..." } }` when the signal changes (AC: #2, #3)
- [ ] Handle "All sessions" selection — set `activeSession` signal to `null` or empty, fetch without session_id filter (AC: #3)
- [ ] Write unit test for session_id query helper — verify DISTINCT query returns unique session IDs (AC: #1)
- [ ] Write Playwright integration test — verify dropdown populates with sessions, filtering shows only matching events, clearing filter restores all events (AC: #1, #2, #3)

## Dev Notes

### Signal-Driven Filtering

- `activeSession` signal defined in `src/ui/app.ts` — `null` means "All sessions"
- When `activeSession` changes, `event-list.ts` re-fetches from the server with the appropriate filter
- No client-side filtering — always query the server so pagination and large datasets work correctly

### Query Contract

- Filter with session: `POST /api/query { "filter": { "session_id": "abc-123" } }`
- Filter without session (all): `POST /api/query { "filter": {} }` or `POST /api/query {}`
- The query handler adds `WHERE session_id = ?` only when `session_id` is present in the filter
- All SQL must use parameterized queries (ch-lar)

### Session List Endpoint

- Session list is fetched via the same `POST /api/query` endpoint using a `queryType: "sessions"` discriminator field in the request body
- The query handler routes on `queryType` — when `"sessions"`, it runs the `SELECT DISTINCT session_id` query and returns an array of unique session_id values sorted by most recent event timestamp
- The `queryType` field is added to `src/schemas/query.ts` alongside the existing filter fields

### UI Component

- Use semantic HTML `<select>` element — Pico CSS auto-styles it
- First option: "All sessions" (value: empty string or sentinel)
- Remaining options: one per distinct session_id
- Preact + htm tagged template literals — NO JSX/TSX
- NEVER use `innerHTML` or `dangerouslySetInnerHTML` (ch-u88)

### Dependencies

- Story 2.1: event list page — provides `src/ui/events/event-list.ts`, `src/server/query.ts`, and `src/schemas/query.ts` that this story extends

### Naming Conventions

- snake_case for database columns and JSON API fields (`session_id`)
- camelCase for TypeScript code (`activeSession`, `sessionFilter`)
- kebab-case for file names (`session-filter.ts`)

### Project Structure Notes

```text
src/
  ui/
    app.ts                    — add activeSession signal
    sessions/
      session-filter.ts       — dropdown component
      session-list.ts         — session list data helper
    events/
      event-list.ts           — update to use activeSession signal
  schemas/
    query.ts                  — extend filter schema with session_id
  server/
    query.ts                  — handle session_id filter
  db/
    queries.ts                — add DISTINCT session_id query
```

### References

- [Source: ./planning-artifacts/architecture.md#API & Communication]
- [Source: ./planning-artifacts/architecture.md#Frontend Architecture]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/epics.md#Story 2.2]
- [Source: ./planning-artifacts/prd.md#Web UI]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
