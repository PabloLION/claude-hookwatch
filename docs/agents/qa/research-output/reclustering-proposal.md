# Module Reclustering Proposal

**Author:** QA agent
**Date:** 2026-03-11
**Scope:** Phase 2 reclustering — full analysis of `src/` after file splitting
**Verdict:** Structure is largely sound. Three targeted moves recommended.

---

## 1. Current Structure Inventory

All TypeScript source files with their primary responsibility and line count. Test files included.

### Root-level (`src/`)

| File | Lines | Responsibility |
|------|-------|---------------|
| `types.ts` | 116 | Shared DB types (`EventRow`, `InsertEventParams`, `WrapResult`), known event names |
| `paths.ts` | 84 | XDG path resolution, `DEFAULT_PORT`, `readPort()` |
| `version.ts` | 12 | `VERSION` constant from `package.json` |
| `paths.test.ts` | 198 | Unit tests for `readPort()` |

### `src/handler/` (7 source + 3 test files)

| File | Lines | Responsibility |
|------|-------|---------------|
| `index.ts` | 352 | Entry point: `handleHook()` pipeline, `runHandler()` public API, `exitFatal()` |
| `post-event.ts` | 263 | `postEvent()` — HTTP POST to server, auto-spawn on connection failure, version check |
| `wrap.ts` | 156 | `runWrapped()` — child process tee, stdin buffering |
| `spawn.ts` | 137 | `spawnServer()` — detached background server spawn + health probe |
| `context.ts` | 77 | `getEventSubtype()`, `buildSystemMessage()` — Claude Code context injection |
| `signals.ts` | 83 | `signalExitCode()`, `describeExitCode()` — POSIX 128+N signal math |
| `errors.ts` | 14 | `errorMsg()` — extracts message from `unknown` thrown value |
| `wrap-runner.fixture.ts` | 25 | Test fixture: runs `runWrapped()` and writes `WrapResult` to stderr |
| `handler.test.ts` | 293 | Port reading, stdin parsing, Zod validation, unknown event types |
| `post-event.test.ts` | 589 | Server communication, auto-start, wrapped mode, pipeline |
| `context.test.ts` | 332 | `getEventSubtype()`, `buildSystemMessage()` |
| `connection-error.test.ts` | 180 | `isConnectionError()` — Bun vs Node.js error detection |
| `wrap.test.ts` | 166 | `runWrapped()` subprocess tests via fixture |

### `src/db/` (4 source + 3 test files)

| File | Lines | Responsibility |
|------|-------|---------------|
| `connection.ts` | 105 | DB open, WAL mode, version check, backup-on-mismatch |
| `schema.ts` | 86 | DDL strings, `CURRENT_VERSION`, `checkVersion()`, `applyFreshSchema()` |
| `queries.ts` | 111 | Parameterized SQL: insert, select, filter |
| `errors.ts` | 17 | `isSqliteBusy()` — SQLite BUSY/LOCKED detection |
| `schema.test.ts` | 389 | DB lifecycle, WAL, version mismatch, backup |
| `queries.test.ts` | 177 | Insert, select, filter, distinct sessions |
| `errors.test.ts` | 133 | `isSqliteBusy()` edge cases |

### `src/server/` (7 source + 3 test files)

| File | Lines | Responsibility |
|------|-------|---------------|
| `index.ts` | 248 | Server startup, routing, idle timeout, port file write/delete |
| `ingest.ts` | 104 | `POST /api/events` — parse, validate, insert, broadcast |
| `query.ts` | 63 | `POST /api/query` — filter, DB query, return rows |
| `health.ts` | 13 | `GET /health` — returns `{status, app, version}` |
| `static.ts` | 128 | Static file serving, `.ts` transpilation, path traversal guard |
| `stream.ts` | 97 | SSE client registry, `broadcast()`, `closeAll()` |
| `errors.ts` | 18 | `errorResponse()` + `ErrorCode` type |
| `server.test.ts` | 442 | Full integration: ingest, query, SSE, static, health, port-in-use |
| `idle-timeout.test.ts` | 175 | Idle timer reset, callback, shutdown |
| `stream.test.ts` | 141 | SSE broadcast, client disconnect, concurrent clients |

### `src/schemas/` (3 source + 3 test files)

| File | Lines | Responsibility |
|------|-------|---------------|
| `events.ts` | 349 | 18 Zod event schemas + `parseHookEvent()` dispatch |
| `output.ts` | 80 | Hook stdout output schemas (base, PreToolUse, Stop) |
| `query.ts` | 39 | `queryFilterSchema` for `POST /api/query` |
| `events.test.ts` | 507 | All 18 event schemas + fallback + `parseHookEvent()` |
| `output.test.ts` | 308 | Hook output schema validation |
| `query.test.ts` | 183 | Query filter schema defaults, validation |

### `src/cli/` (5 source + 2 test files)

| File | Lines | Responsibility |
|------|-------|---------------|
| `index.ts` | 110 | citty root command, 18 event subcommands + 3 management subcommands |
| `install.ts` | 173 | `install` command: generate `plugin.json`, `hooks.json`, run `bun link` |
| `uninstall.ts` | 97 | `uninstall` command: remove generated files, run `bun unlink` |
| `ui.ts` | 154 | `ui` command: check server health, spawn if needed, open browser |
| `events.ts` | 33 | `EVENT_TYPES` constant array + `EventType` type + `EVENT_TYPE_SET` |
| `install.test.ts` | 211 | Install/uninstall dry-run, `bun link`, file generation |
| `ui.test.ts` | 238 | `isServerRunning`, `isPortOccupied`, `openBrowser`, `uiCommand` |

### `src/test/` (6 files, all test utilities)

| File | Lines | Responsibility |
|------|-------|---------------|
| `index.ts` | 14 | Barrel re-export of all test utilities |
| `types.ts` | 24 | `ServerHandle<P>` interface |
| `fixtures.ts` | 93 | `BASE_SESSION_START`, `GENERIC_EVENT_BASE`, `makeEvent()`, `makeEventRow()` |
| `setup.ts` | 147 | `createTempXdgHome()`, `setupTestDb()`, `createHandlerTestContext()` |
| `test-server.ts` | 123 | `startTestServer()`, `firstEventBody()`, `writePortFile()` |
| `subprocess.ts` | 207 | `runHandler()`, `runHandlerWrapped()`, `runWrapRunner()`, `killProcessOnPort()` |
| `handler-assertions.ts` | 132 | `assertBareExitLegality()`, `assertWrappedExitLegality()` |

### `src/ui/` (9 source files, no test files)

| File | Lines | Responsibility |
|------|-------|---------------|
| `app.ts` | 43 | Root Preact component, cross-component signals, SSE client init |
| `shared/html.ts` | 13 | `htm.bind(h)` — shared tagged template literal |
| `shared/sse-client.ts` | 87 | SSE `EventSource` connection, event push into signal |
| `events/event-list.ts` | 205 | `EventList` component — event table, row expansion, fetch |
| `events/event-detail.ts` | 153 | `EventDetail` component — stdin display, tool info, I/O sections |
| `sessions/session-filter.ts` | 66 | `SessionFilter` component — dropdown, session change handler |
| `sessions/session-list.ts` | 52 | `fetchSessions()`, `formatSessionId()` |
| `wrap/wrap-viewer.ts` | 104 | `WrapViewer` component — wrapped event I/O display |

Vendor files (`src/ui/vendor/`) and static assets (`index.html`, `pico.min.css`) are excluded.

---

## 2. Import Graph Analysis

### Full dependency map (by module, leaf → root order)

```
version.ts       ← server/health.ts, server/index.ts, handler/post-event.ts

paths.ts         ← handler/index.ts, handler/spawn.ts, cli/ui.ts,
                    server/index.ts
                    (also transitively via readPort() in spawn.ts health probe)

types.ts         ← schemas/events.ts (EVENT_NAMES)
                    handler/wrap.ts (WrapResult)
                    server/stream.ts (EventRow)
                    server/ingest.ts (toKnownEventName)
                    db/queries.ts (EventRow, InsertEventParams)
                    ui/app.ts (EventRow)
                    test/fixtures.ts (EventRow, InsertEventParams)
                    test/subprocess.ts (WrapResult)

schemas/events.ts ← handler/index.ts, handler/post-event.ts (type-only),
                     handler/context.ts (type-only), server/ingest.ts

schemas/output.ts ← handler/index.ts

schemas/query.ts  ← server/query.ts, db/queries.ts (type-only)

db/errors.ts     ← server/ingest.ts, server/query.ts

db/schema.ts     ← db/connection.ts

db/connection.ts ← server/index.ts (close), server/ingest.ts (openDb),
                    server/query.ts (openDb)

db/queries.ts    ← server/ingest.ts, server/query.ts

handler/errors.ts ← handler/index.ts, handler/post-event.ts,
                     handler/spawn.ts, handler/wrap.ts

handler/signals.ts ← handler/wrap.ts

handler/wrap.ts  ← handler/index.ts

handler/spawn.ts ← handler/post-event.ts, cli/ui.ts

handler/context.ts ← handler/index.ts

handler/post-event.ts ← handler/index.ts

handler/index.ts ← cli/index.ts

server/errors.ts ← server/index.ts, server/ingest.ts,
                    server/query.ts, server/static.ts

server/stream.ts ← server/index.ts, server/ingest.ts

server/health.ts ← server/index.ts

server/static.ts ← server/index.ts

server/ingest.ts ← server/index.ts

server/query.ts  ← server/index.ts

server/index.ts  ← (CLI spawns it as a subprocess; no direct import)

ui/shared/html.ts ← ui/app.ts, ui/events/event-list.ts,
                     ui/events/event-detail.ts, ui/sessions/session-filter.ts,
                     ui/wrap/wrap-viewer.ts

ui/app.ts        ← ui/events/event-list.ts, ui/events/event-detail.ts,
                    ui/shared/sse-client.ts, ui/wrap/wrap-viewer.ts
```

### Circular dependency check

No circular dependencies exist. The dependency graph is a DAG. The critical absence to confirm: `handler/` never imports from `server/`, and `server/` never imports from `handler/`. The only connection between these two domains is the HTTP POST at runtime, not at the module level.

### Cross-domain boundary import audit

| Import direction | Files | Notes |
|-----------------|-------|-------|
| `cli/ui.ts` → `handler/spawn.ts` | 1 file | Intentional: CLI reuses spawn logic. Documented in spawn.ts header. |
| `cli/index.ts` → `handler/index.ts` | 1 file | Intentional: CLI delegates handler invocation. |
| `server/*` → `db/*` | 5 files | Correct: server is the only DB consumer. |
| `handler/*` → `schemas/*` | 3 files | Correct: handler validates events before posting. |
| `server/ingest.ts` → `schemas/events.ts` | 1 file | Correct: server re-validates on ingestion. |
| `ui/events/*.ts` → `../app.ts` | 4 files | See coupling assessment below. |
| `db/queries.ts` → `schemas/query.ts` | 1 file | See coupling assessment below. |

---

## 3. Coupling Assessment

### 3.1 `ui/` components importing `EventRow` from `app.ts`

Four UI files (`event-list.ts`, `event-detail.ts`, `sse-client.ts`, `wrap-viewer.ts`) import `EventRow` from `../app.ts`. This creates a coupling from leaf components back to the root entry point. The entry point re-exports `EventRow` from `@/types.ts` (via `export type { EventRow }`), but the import path goes through `app.ts`.

**Assessment:** Minor structural awkwardness. The components should import `EventRow` from `@/types.ts` directly. The `app.ts` re-export exists only because it was added as an alias; removing it would clarify that `EventRow` belongs to the shared type layer, not the UI root.

**Impact level:** Low. No circular dependency, no behavioral issue. A rename/redirect cosmetic fix.

### 3.2 `db/queries.ts` importing `QueryFilter` from `schemas/query.ts`

`db/queries.ts` imports `QueryFilter` (the Zod-inferred type) from `@/schemas/query.ts`. This ties the DB query layer to the Zod schema layer. The type is used only as a parameter type for `queryEvents()`.

**Assessment:** Minor coupling. The DB layer should not depend on the schema layer. `QueryFilter` is a plain object shape that does not require Zod to express. It could be defined as a plain TypeScript interface in `src/types.ts` (or in `db/queries.ts` itself and exported), with the schema layer using `z.infer<typeof queryFilterSchema>` which is structurally identical.

However, this is a low-priority change. The coupling is read-only (type import only, not value import), and the pragmatic benefit of a single `QueryFilter` type for both schema and DB layer outweighs the architectural purity of decoupling them.

**Impact level:** Low. Worth tracking but not urgent.

### 3.3 `handler/spawn.ts` used by both `handler/post-event.ts` and `cli/ui.ts`

`spawnServer()` is defined in `handler/spawn.ts` and imported by two callers: `handler/post-event.ts` (server auto-start on connection failure) and `cli/ui.ts` (manual server start). This cross-domain import is documented in `spawn.ts`'s header comment (`Exported for reuse by cli/ui.ts (Story 2.5)`).

**Assessment:** The function clearly serves two consumers in different domains. It should move to a domain-neutral location. Both `src/paths.ts` (already a shared layer) and a new `src/server-spawn.ts` or `src/spawn.ts` at the root level are candidates.

Moving it to `src/paths.ts` would overload that module with spawn logic (currently pure path/port operations). A dedicated `src/server-spawn.ts` is cleaner.

**Impact level:** Medium. The current location works, but `spawn.ts` living in `handler/` while also serving `cli/` is a mild organizational violation of "files live where their primary consumer lives."

### 3.4 `src/handler/` file count (7 files)

Seven files is not too many for the handler domain. Each has a distinct responsibility with minimal overlap:
- `index.ts` — pipeline orchestration
- `post-event.ts` — HTTP transport
- `wrap.ts` — child process management
- `spawn.ts` — server lifecycle (debated above)
- `context.ts` — Claude Code context injection
- `signals.ts` — POSIX signal math
- `errors.ts` — error message extraction

The split is well-justified. `errors.ts` is very small (14 lines) but is imported by 4 files — a legitimate micro-utility to avoid duplication.

### 3.5 `src/schemas/` scope (events + output + query)

`output.ts` validates hook stdout — what the handler writes back to Claude Code. It is only imported by `handler/index.ts`. `events.ts` is imported by both handler and server. `query.ts` is imported by server and db.

The question is whether `output.ts` should move closer to `handler/`. The argument for moving it: only the handler uses it, it describes the handler's output contract, it belongs in the handler domain. The argument for leaving it: it is a schema validation concern, grouped with other schema files, and consistent with `events.ts` and `query.ts` in the same directory.

**Assessment:** Leave `output.ts` in `schemas/`. The schema layer's role is "Zod validation of external interfaces." Hook stdout is an external interface (the Claude Code SDK defines it). Grouping it with other schema files is correct and consistent. Moving it to `handler/` would make `handler/` responsible for schema definition, which blurs the boundary.

### 3.6 `src/types.ts` growth

`src/types.ts` currently contains:
- `EVENT_NAMES` constant + `KnownEventName` type + `toKnownEventName()` function
- `EventRow` interface
- `InsertEventParams` type alias
- `WrapResult` interface

This is 116 lines covering three distinct type clusters. The placement rule in the file's own JSDoc ("2+ domains → move to shared") is being correctly applied — all four items are used by 2+ domains. The file is not yet large enough to warrant splitting. At 400-line max per the style guide, `types.ts` has substantial headroom.

**Assessment:** Current size is appropriate. No split needed now. If `WrapResult` becomes handler-only after potential UI wrap timeline display changes, move it back to `handler/wrap.ts`.

### 3.7 `src/paths.ts` scope

`paths.ts` contains: XDG path resolution for 4 paths, `DEFAULT_PORT`, and `readPort()`. All are consumed by multiple modules (handler, server, cli). This is a clean, focused module. The `readPort()` consolidation (ch-qj6h) was the right call.

**Assessment:** Correct placement. No changes needed.

### 3.8 `src/test/` organization

The 7 test utility files have well-defined roles:
- `index.ts` — barrel export
- `types.ts` — `ServerHandle<P>` shared interface
- `fixtures.ts` — payload factories
- `setup.ts` — DB and temp dir lifecycle
- `test-server.ts` — in-process HTTP test server
- `subprocess.ts` — subprocess launchers and process cleanup
- `handler-assertions.ts` — exit code contract assertions

The `wrap-runner.fixture.ts` lives in `handler/` rather than `test/`. This is correct: it is a fixture specific to testing `handler/wrap.ts` and requires access to the handler's internal `runWrapped()` function. It does not belong in `src/test/`.

**Assessment:** Coherent and well-organized. The decision to keep `runHandler()` and `runWrapRunner()` as separate exports (not unified) in `subprocess.ts` is documented and correct — their output shapes are fundamentally different.

One observation: `src/test/types.ts` (24 lines, single interface) is small enough that `ServerHandle<P>` could move into `test-server.ts` or `setup.ts`. However, it is used by Playwright E2E tests (the JSDoc mentions this), so keeping it separate avoids coupling the Playwright test entrypoint to Bun-specific modules.

---

## 4. Proposed Structure

Two structural changes are recommended. One is declined.

### Recommended Change A: Move `spawnServer()` out of `handler/`

**Rationale:** `handler/spawn.ts` is imported by `cli/ui.ts`, which is outside the handler domain. A utility that serves two different domains (handler auto-start, CLI manual-start) belongs in a shared location.

**Proposed location:** `src/server-spawn.ts`

```
Before:
  src/handler/spawn.ts      ← imported by handler/post-event.ts AND cli/ui.ts

After:
  src/server-spawn.ts       ← imported by handler/post-event.ts AND cli/ui.ts
```

Import changes required:
- `handler/post-event.ts`: `from "./spawn.ts"` → `from "@/server-spawn.ts"`
- `cli/ui.ts`: `from "@/handler/spawn.ts"` → `from "@/server-spawn.ts"`

The file content does not change. Only the location and import paths change.

**Tradeoff:** Adds one more root-level file. The benefit (removing a cross-domain import from `cli/` into `handler/`) is real but small given the documented intent in the existing code.

### Recommended Change B: Fix `EventRow` import source in UI components

**Rationale:** Four UI components import `EventRow` from `../app.ts`. The type lives in `@/types.ts`; `app.ts` merely re-exports it. Importing from the entry point creates a false dependency on the root component.

**Proposed change:** In each of the four files, replace:
```typescript
import type { EventRow } from "../app.ts";
```
with:
```typescript
import type { EventRow } from "@/types.ts";
```

And remove the `export type { EventRow }` re-export from `app.ts` (it is no longer needed once all internal consumers import directly).

Files affected:
- `src/ui/events/event-list.ts`
- `src/ui/events/event-detail.ts`
- `src/ui/shared/sse-client.ts`
- `src/ui/wrap/wrap-viewer.ts`
- `src/ui/app.ts` (remove re-export)

**Tradeoff:** Minimal. Five small edits. No behavioral change.

### Declined: Splitting `src/types.ts`

At 116 lines with clear section headers and a documented placement rule, `types.ts` does not need splitting. The four type clusters are related (all describe the DB event model or wrap contract). Splitting would add import complexity with no clarity gain at the current size.

### Overall verdict on current structure

The current structure is sound. The module boundaries are correctly drawn. No large misplacements exist. The two recommended changes are improvements, not corrections of serious errors.

```
src/
  types.ts              (shared)
  paths.ts              (shared)
  version.ts            (shared)
  server-spawn.ts       (MOVE: currently handler/spawn.ts) [Change A]
  handler/
    index.ts
    post-event.ts
    wrap.ts
    context.ts
    signals.ts
    errors.ts
    wrap-runner.fixture.ts
  db/
    connection.ts
    schema.ts
    queries.ts
    errors.ts
  server/
    index.ts
    ingest.ts
    query.ts
    health.ts
    static.ts
    stream.ts
    errors.ts
  schemas/
    events.ts
    output.ts
    query.ts
  cli/
    index.ts
    install.ts
    uninstall.ts
    ui.ts
    events.ts
  test/
    index.ts
    types.ts
    fixtures.ts
    setup.ts
    test-server.ts
    subprocess.ts
    handler-assertions.ts
  ui/
    app.ts
    shared/
      html.ts
      sse-client.ts       (EventRow import: @/types.ts) [Change B]
    events/
      event-list.ts       (EventRow import: @/types.ts) [Change B]
      event-detail.ts     (EventRow import: @/types.ts) [Change B]
    sessions/
      session-filter.ts
      session-list.ts
    wrap/
      wrap-viewer.ts      (EventRow import: @/types.ts) [Change B]
```

---

## 5. Migration Plan

Both changes are independent and can be executed in either order.

### Change A: Move `handler/spawn.ts` → `src/server-spawn.ts`

1. Create `src/server-spawn.ts` with the exact content of `src/handler/spawn.ts` (or use `git mv` to preserve history, then update the import alias in the file header)
2. Update `src/handler/post-event.ts`: change `from "./spawn.ts"` to `from "@/server-spawn.ts"`
3. Update `src/cli/ui.ts`: change `from "@/handler/spawn.ts"` to `from "@/server-spawn.ts"`
4. Update `src/test/subprocess.ts`: `WRAP_RUNNER_PATH` references `handler/spawn.ts` path indirectly via `../handler` URL; verify no test imports `spawn.ts` directly
5. Delete `src/handler/spawn.ts`
6. Run `bun run check` to verify

Note: if using `git mv`, do step 1 as `git mv src/handler/spawn.ts src/server-spawn.ts`, then do steps 2–3, then step 6.

### Change B: Fix `EventRow` import source in UI components

1. In `src/ui/events/event-list.ts`: replace `from "../app.ts"` with `from "@/types.ts"` (import line only)
2. In `src/ui/events/event-detail.ts`: same replacement
3. In `src/ui/shared/sse-client.ts`: same replacement
4. In `src/ui/wrap/wrap-viewer.ts`: same replacement
5. In `src/ui/app.ts`: remove `export type { EventRow }` line (and the now-unused import of `EventRow`)
6. Run `bun run check` to verify

Change B can be done first without any conflict with Change A.

---

## Appendix: Dependency Complexity by Module

Sorted by number of distinct files that import the module (consumer count):

| Module | Consumers |
|--------|-----------|
| `server/errors.ts` | 4 |
| `handler/errors.ts` | 4 |
| `db/connection.ts` | 4 |
| `types.ts` | 8 |
| `paths.ts` | 7 |
| `version.ts` | 6 |
| `schemas/events.ts` | 5 |
| `server/stream.ts` | 3 |
| `handler/spawn.ts` | 2 |
| `db/queries.ts` | 2 |
| `schemas/query.ts` | 2 |
| `db/errors.ts` | 2 |

`types.ts`, `paths.ts`, and `version.ts` are the most-imported modules, correctly positioned at root level. `server/errors.ts` and `handler/errors.ts` are the most-imported within their domains — both are correctly placed. `handler/spawn.ts` with 2 consumers in different domains is the structural outlier noted in Change A.
