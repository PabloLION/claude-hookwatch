# Story 1.3: Bun Server with Event Ingestion Endpoint

Status: ready-for-dev

## Story

As a hookwatch handler,
I want a Bun server that accepts events via HTTP,
so that captured events flow from handler to database.

## Acceptance Criteria

1. **Given** the Bun server is started, **when** it binds to `127.0.0.1:6004`,
   **then** it is accessible on localhost only, and `GET /health` returns
   `200 OK`.

2. **Given** a valid event JSON is POSTed to `/api/events`, **when** the server
   receives it, **then** the event is inserted into SQLite via the query helper,
   and the server responds with `201 Created`.

3. **Given** an invalid JSON body is POSTed to `/api/events`, **when** the server
   receives it, **then** it responds with `400` and structured error JSON
   `{ "error": { "code": "INVALID_QUERY", "message": "..." } }`.

4. **Given** port 6004 is already in use, **when** the server starts without
   explicit `--port`, **then** it auto-increments to 6005, 6006, etc.

## Tasks / Subtasks

- [ ] Create `src/server/index.ts` — `Bun.serve()` setup, route dispatch, bind to `127.0.0.1` (AC: #1)
- [ ] Create `src/server/health.ts` — `GET /health` handler returning `200 OK` (AC: #1)
- [ ] Create `src/server/ingest.ts` — `POST /api/events` handler: parse body, validate with Zod, insert via db query helper, return `201 Created` (AC: #2, #3)
- [ ] Implement structured error responses with error codes: `DB_LOCKED`, `NOT_FOUND`, `INVALID_QUERY`, `INTERNAL` (AC: #3)
- [ ] Implement port auto-increment: try 6004, catch `EADDRINUSE`, increment, retry (AC: #4)
- [ ] Bind server to `127.0.0.1` explicitly — never `0.0.0.0` (AC: #1)
- [ ] Create `src/server/server.test.ts` — test health endpoint, successful event ingestion, invalid JSON rejection, port auto-increment (AC: #1, #2, #3, #4)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2, #3, #4)

## Dev Notes

### Server Architecture

- Use `Bun.serve()` built-in — no Express, Hono, or other HTTP framework needed
- Single `fetch` handler in `Bun.serve()` that routes by method + pathname
- Route dispatch: `GET /health` -> health handler, `POST /api/events` -> ingest handler
- All other routes return `404 Not Found`

### Port Configuration

- Default port: `6004`
- Auto-increment on `EADDRINUSE`: try 6004 -> 6005 -> 6006 -> ...
- Maximum retry count: define a reasonable cap (e.g., 10 attempts)
- When `--port` is specified explicitly via CLI (Story 1.6), auto-increment is disabled — error if port is in use
- The final port must be discoverable by the handler for auto-start (Story 1.5)

### Error Format

All API error responses use this structure:

```json
{
  "error": {
    "code": "INVALID_QUERY",
    "message": "Human-readable description"
  }
}
```

Error codes:

```csv
Code,HTTP Status,When
INVALID_QUERY,400,Malformed JSON or Zod validation failure
DB_LOCKED,503,SQLite busy (concurrent write conflict)
NOT_FOUND,404,Resource not found
INTERNAL,500,Unexpected server error
```

### Ingest Endpoint Flow

1. Read request body as JSON
2. Validate with Zod event schema (from `@/schemas/events`)
3. Extract common fields (event, session_id, cwd, tool_name, ts)
4. Insert into SQLite via `@/db/queries` (parameterized)
5. Return `201 Created` with `{ "id": <inserted_id> }` or similar confirmation
6. On validation failure: return `400` with `INVALID_QUERY` error
7. On database error: return `503` with `DB_LOCKED` or `500` with `INTERNAL`

### Security

- Bind to `127.0.0.1` explicitly — prevents network exposure (NFR10)
- No authentication in v0 — localhost-only is the security boundary
- Parameterized SQL only in the ingest path (ch-lar)

### Dependencies

- Story 1.1: database layer (`@/db/connection`, `@/db/queries`)
- Story 1.2: Zod schemas (`@/schemas/events`)

### Project Structure Notes

```text
src/
  server/
    index.ts         — Bun.serve() setup, route dispatch
    ingest.ts        — POST /api/events handler
    health.ts        — GET /health handler
    server.test.ts   — co-located unit test
```

### References

- [Source: ./planning-artifacts/architecture.md#API & Communication]
- [Source: ./planning-artifacts/architecture.md#Server Configuration]
- [Source: ./planning-artifacts/architecture.md#Architectural Boundaries]
- [Source: ./planning-artifacts/epics.md#Story 1.3]
- [Source: ./planning-artifacts/prd.md#Bun Server]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
