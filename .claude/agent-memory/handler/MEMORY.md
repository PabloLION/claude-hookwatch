# Handler Agent Memory

## Project context

Hookwatch handler domain: `src/handler/`. Entry point is `src/handler/index.ts`.
Run `bun run check` before committing (= `bun test src/ tests/handler-server.test.ts tests/smoke-http.test.ts && biome check .`).
Working directory is `/Users/pablo/LocalDocs/repo/PabloLION/claude-hookwatch`.

## Handler source structure (post-split)

```
src/handler/
  index.ts        — handleHook(), runHandler(), readPort(), exitFatal(), parseEventSafely()
  post-event.ts   — postEvent(), isConnectionError(), EventPostPayload
  context.ts      — getEventSubtype(), buildSystemMessage()
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
- Exit codes: 0 = success, 2 = hookwatch fatal (JSON stdout with hookwatch_fatal field)
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
Validates: exit 0 + (empty stdout OR JSON with `continue: boolean`), exit 2 + JSON with `hookwatch_fatal: string`.
Handles wrapped mode: extracts last `{...}` block if full parse fails (child stdout precedes hook JSON).
