# QA Agent Memory

## Project: hookwatch

### Module Structure (confirmed correct as of 2026-03-11)

Layer-based split reflects the process boundary: handler (short-lived, per-hook)
vs server (long-lived, persistent). Feature-based splits would obscure this
boundary. Do not propose feature-based reorganization.

`schemas/` is correctly a peer module, not inside `handler/` — it validates
external interfaces (Claude Code SDK contracts), not handler implementation
details.

`server/` and `db/` are correctly separate despite single-consumer pattern —
DB has its own independent test suite and preserves a clean storage API.

### Known Structural Issues (open)

- `EVENT_TYPES` in `cli/events.ts` duplicates `EVENT_NAMES` in `types.ts` —
  same 18 event names, different orderings, no type-level sync guarantee.
  Fix: derive `EVENT_TYPES` from imported `EVENT_NAMES`. Medium severity.
  (Not yet filed as beads issue as of 2026-03-11.)

- `handler/spawn.ts` imported by `cli/ui.ts` — cross-domain import documented
  in file header. Reclustering report proposed moving to `src/server-spawn.ts`.
  Low severity, low priority.

- `db/queries.ts` imports `QueryFilter` type from `schemas/query.ts` — DB layer
  depends on Zod schema layer. Type-only import, low practical impact. Track
  only.

### Confirmed Correct (do not re-flag)

- `wrap-runner.fixture.ts` lives in `handler/` not `test/` — correct, calls
  `runWrapped()` internal directly.
- `handler-assertions.ts` in `test/` — correct, it is test infrastructure.
- `schemas/output.ts` in `schemas/` not `handler/` — correct, it describes an
  external interface contract.
- `WrapResult` in `types.ts` — currently used by handler and test utilities,
  shared placement justified.

### Reclustering Report Changes (still pending)

Change A: Move `handler/spawn.ts` to `src/server-spawn.ts`
Change B: Fix `EventRow` import source in 4 UI components (from `../app.ts`
  to `@/types.ts`)

### Security Audit Patterns

ch-lar (parameterized SQL): All queries in `db/queries.ts` use `?` placeholders.
  No string concatenation on user input. Compliant.
ch-u88 (no innerHTML): All UI rendering via htm template literals. Server SSE
  uses `JSON.stringify()`. Static file handler never interpolates paths into HTML.
  Compliant.
Static file server path traversal guard: `resolveUiPath()` in `server/static.ts`
  checks `resolved.startsWith(UI_DIR + "/")`. Guard present and correct.
Server binds 127.0.0.1: `HOSTNAME = "127.0.0.1"` in `server/index.ts`. Compliant.

### Test Coverage Notes

Handler tests split into 3 files: handler.test.ts (port/stdin/Zod/unknown),
post-event.test.ts (server comm/auto-start/wrapped/pipeline),
context.test.ts (subtype/systemMessage). Plus connection-error.test.ts and
wrap.test.ts as standalone focused tests.

Shared test utilities at `src/test/` (barrel at index.ts):
- fixtures.ts: BASE_SESSION_START, GENERIC_EVENT_BASE, makeEvent(), makeEventRow()
- setup.ts: createTempXdgHome(), setupTestDb(), createHandlerTestContext()
- test-server.ts: startTestServer(), firstEventBody(), writePortFile()
- subprocess.ts: runHandler(), runHandlerWrapped(), runWrapRunner(), killProcessOnPort()
- handler-assertions.ts: assertBareExitLegality(), assertWrappedExitLegality()
