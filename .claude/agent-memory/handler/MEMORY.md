# Handler Agent Memory

## Project context

Hookwatch handler domain: `src/handler/`. Entry point is `src/handler/index.ts`.
Run `bun run check` before committing (= `bun test src/ tests/handler-server.test.ts tests/smoke-http.test.ts && biome check .`).
Working directory is `/Users/pablo/LocalDocs/repo/PabloLION/claude-hookwatch`.

## Handler source structure (post-split)

```
src/handler/
  index.ts        — handleHook(), runHandler(), exitFatal(), parseEventSafely()
  post-event.ts   — postEvent(), isConnectionError(), EventPostPayload, PostEventResult
  context.ts      — getEventSubtype(), buildSystemMessage(event, logEntries?)
  errors.ts       — errorMsg()
  spawn.ts        — spawnServer() (also used by cli/open.ts)
  wrap.ts         — runWrapped()
```

## Handler test structure (post ch-qmy7)

```
src/handler/
  handler.test.ts     — port file, stdin parsing, Zod validation, unknown event forwarding
  post-event.test.ts  — server errors, auto-start, wrapped mode, unified pipeline
  context.test.ts     — getEventSubtype(), buildSystemMessage() unit + subprocess integration
```

## Shared test utilities (`src/test/`)

All imports go through `@/test` barrel:
- `BASE_SESSION_START`, `GENERIC_EVENT_BASE` — fixtures.ts
- `makeEvent()`, `makeEventRow()` — fixtures.ts
- `startTestServer()`, `writePortFile()`, `writeInvalidPortFile()` — test-server.ts
- `runHandler()`, `runHandlerWrapped()`, `runSubprocess()`, `runWrapRunner()` — subprocess.ts
- `assertExitLegality()` — handler-assertions.ts (exit code contract checker)
- `createTempXdgHome()`, `setupTestDb()`, `closeTestDb()` — setup.ts

## Key constraints

- stdout suppression is CRITICAL: all logging to stderr (console.error), never console.log
- Exit codes: 0 = success (always in bare mode); wrapped mode forwards child exit code
- Fatal errors (stdin parse failure only): exit 0 + JSON with `hookwatch_fatal` + `systemMessage`
- POST failures are NON-FATAL: failure reason goes into logEntries → appended to systemMessage
- Never exit 1 — shows generic "hook error" in Claude Code, stderr not surfaced
- `fetch()` must use `AbortSignal.timeout(5000)`
- spawn server detached via `spawnServer()` from `spawn.ts`, don't wait for it
- handler exits quickly; server health probe in spawn.ts (100ms interval, 20 polls)

## Biome import ordering

Biome requires `import type` before `import` when both reference the same module:
```ts
import type { TestServer } from "@/test";    // type import first
import { runHandler } from "@/test";          // value import second
```

## Pre-existing bug fixed

`src/test/subprocess.ts` HANDLER_PATH was `../../handler/index.ts` (wrong — resolves to `<root>/handler/`).
Fixed to `../handler/index.ts` (resolves correctly to `src/handler/`). Same for WRAP_RUNNER_PATH.
This bug was latent — no test used the shared runHandler before ch-qmy7.

## assertExitLegality()

Lives in `src/test/handler-assertions.ts`, exported from `@/test`.
Validates: exit 0 + (empty stdout OR JSON with `continue: boolean`). Exit 2 abandoned — hookwatch always exits 0. Fatal errors (stdin parse only) use exit 0 + JSON with `hookwatch_fatal` and `systemMessage`. POST failures are non-fatal: normal hook output JSON with failure reason in `systemMessage`.
Handles wrapped mode: extracts last `{...}` block if full parse fails (child stdout precedes hook JSON).

## PostEventResult (ch-6k4y)

`postEvent()` returns `PostEventResult { ok: boolean; failureReason?: string; detail?: string }`.
Four failure paths: HTTP error, non-connection exception, spawn failure, retry exhausted.
Caller (handleHook) puts `failureReason` + `detail` into logEntries on `ok: false`.
logEntries are appended to `systemMessage` via `buildSystemMessage(event, logEntries)`.
Never call `exitFatal()` on POST failure — passive observer principle.
