# Tester Agent Memory

## Project Context

Hookwatch: Bun/TypeScript, bun:sqlite, Preact+htm, Pico CSS. Tests in `tests/`.

## Key Patterns

### Playwright vs Bun Test

- Playwright runs in Node.js — `Bun.spawn()` is NOT available. Use `child_process.spawn`.
- `bun test` auto-discovers `*.test.ts` files — Playwright test files must be excluded.
- Exclusion strategy: `bun test src/ tests/handler-server.test.ts` (explicit paths, not glob).
- Cannot use `bun test --ignore=...` — flag does not exist.
- Cannot use negation patterns like `bun test '!file.ts'` — bun ignores them.
- `test-results/` and `playwright-report/` must be excluded from biome.json and .gitignore.

### Server Lifecycle in Playwright Tests

- Spawn server with `child_process.spawn("bun", ["--bun", SERVER_PATH], ...)`.
- Isolate each test with its own `XDG_DATA_HOME` temp dir.
- Discover server port by polling the port file at `<xdgDataHome>/hookwatch/hookwatch.port`.
- Then poll `/health` until server responds before proceeding.

### DB vs UI Contract Mismatch (Known Bug)

The DB column is `event` (not `hook_event_name`). The UI `EventRow` interface in `app.ts`
uses `hook_event_name`. This means the event type column renders empty in the browser.

Also: `ts` is stored as epoch ms number but the UI `EventRow` types it as a string.

These are known bugs documented by the failing E2E test #3.

### Biome Import Order

Biome's organizeImports sorts `type` imports: non-type specifiers come before type specifiers
within the same import. Example: `{ type BrowserContext, chromium, type Page }` → biome wants
`{ type BrowserContext, chromium, type Page }` where types are interleaved alphabetically.

### /api/query Return Shape

The `/api/query` endpoint returns rows with these fields: `id`, `ts` (number epoch ms),
`event` (string), `session_id`, `cwd`, `tool_name`, `session_name`, `hook_duration_ms`, `payload`.

## Files Owned

- `tests/ui-e2e.test.ts` — Playwright E2E tests for event list UI
- `tests/handler-server.test.ts` — integration tests (pre-existing)
