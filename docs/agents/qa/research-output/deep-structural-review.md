# Deep Structural Review

**Author:** QA agent
**Date:** 2026-03-11
**Scope:** Are the module boundaries themselves the right abstractions?
**Verdict:** Yes, with two genuine structural problems and one latent coupling.

---

## Framing

The previous reclustering report checked whether files were in the right
folders. This review goes one level deeper: are the folders themselves the
right units? The questions are:

1. Should `handler/` be split differently?
2. Should `server/` and `db/` merge?
3. Should `schemas/` live inside `handler/`?
4. Is the `handler/` vs `cli/` split correct?
5. Would a feature-based split be better than the current layer-based split?
6. Is the `test/` organization coherent?

The project has approximately 35 production TypeScript files and roughly 2,500
lines of production code. That count matters. Proposals that add abstraction
layers without removing confusion are wrong at this scale.

---

## Question 1: Should `handler/` be split differently?

**Current:** 7 source files, one folder.

Reading the actual import graph, `handler/` contains two distinct execution
domains that happen to share a folder:

**Domain A — hook pipeline (Claude Code boundary)**
- `index.ts` — pipeline orchestration, `exitFatal()`, `parseEventSafely()`
- `context.ts` — context injection, `buildSystemMessage()`
- `wrap.ts` — child process tee, I/O capture
- `signals.ts` — POSIX signal math
- `errors.ts` — `errorMsg()` micro-utility

**Domain B — server communication (network boundary)**
- `post-event.ts` — HTTP POST, version check, retry logic
- `spawn.ts` — detached server spawn, health poll

The two domains are not symmetric in how tightly they couple to each other.
`post-event.ts` is the bridge between them: it is called by `index.ts` (Domain
A), internally calls `spawnServer()` from `spawn.ts` (Domain B), and is also
reused indirectly by `cli/ui.ts` via `spawn.ts`.

**Should `post-event.ts` + `spawn.ts` become a `transport/` or `client/`
module?**

The argument for splitting: the server communication files do not depend on any
handler-pipeline files. `post-event.ts` imports only `errors.ts` and `spawn.ts`
from within `handler/`. `spawn.ts` imports only `errors.ts`. They could be
extracted as an independent module.

The argument against: at this project size, adding a `src/transport/` folder
means navigating one more directory to understand what amounts to 400 lines of
code. The benefit is marginal. More importantly, the conceptual boundary between
"handle a hook event" and "send it to the server" is thin — they are steps 5
and 6 in a single pipeline. Splitting them into separate modules would make the
pipeline harder to trace, not easier.

**Verdict: Do not split `handler/`.** Seven files is not too many. The current
split by file (not by subdirectory) is the right granularity. The only justified
change is moving `spawn.ts` as noted in the reclustering report — but moving it
to `src/server-spawn.ts` not to a new folder.

One legitimate internal issue in `handler/`: `wrap-runner.fixture.ts` sits
inside `handler/` even though its role is test infrastructure. The reclustering
report correctly identified that it must remain in `handler/` because it calls
`runWrapped()` directly. This is correct — fixture files that call internal
functions of the module under test belong next to that module, not in `test/`.

---

## Question 2: Should `server/` and `db/` merge?

**Current:** 7 server files + 4 db files, separate folders.

The instinct to merge them comes from observing that `server/ingest.ts` and
`server/query.ts` call `db/*` functions directly, making `server/` the sole
consumer of `db/`. With a single consumer, why have a separate module?

**The case for merging:**
`server/index.ts` calls `closeDb()`. `server/ingest.ts` calls `openDb()`,
`insertEvent()`, `getEventById()`, `broadcast()`, `isSqliteBusy()`. If you
merged them, you would have a single `server/` folder where data access and
routing logic coexist.

**The case against merging (decisive):**
The DB layer is independently testable and has its own test suite
(`schema.test.ts`, `queries.test.ts`, `errors.test.ts`) that opens databases
directly without an HTTP server. This is valuable — the DB tests run in ~200ms
without spawning any server. If the DB layer were merged into `server/`, these
tests would still work but the test setup would include unnecessary imports and
the clean boundary between "storage" and "HTTP routing" would disappear.

More importantly, the DB module communicates what it is: a persistence layer
with a defined API (`openDb`, `close`, `insertEvent`, `queryEvents`,
`getDistinctSessions`). That API could be consumed by a CLI introspection
command, a bulk export command, or a migration tool without needing to import
any HTTP server code. Keeping them separate preserves this potential.

**Verdict: Keep `server/` and `db/` separate.** The single-consumer pattern is
not a problem at this scale — it is a feature. The separation enables
independent testing and expresses a real architectural boundary.

---

## Question 3: Should `schemas/` live inside `handler/`?

**Current:** `schemas/` is a sibling of `handler/`, `server/`, `db/`, etc.

`schemas/events.ts` is used by both `handler/index.ts` and `server/ingest.ts`.
`schemas/output.ts` is used only by `handler/index.ts`.
`schemas/query.ts` is used by `server/query.ts` and `db/queries.ts`.

**If the rule is "files live where their primary consumer lives":** `output.ts`
would move to `handler/` and `query.ts` would move to `server/`.

**This would be wrong.** The schema layer's job is to define validation
contracts for external interfaces. `events.ts` documents what Claude Code sends
to hookwatch. `output.ts` documents what hookwatch sends back to Claude Code.
`query.ts` documents the query API contract. All three are validation
specifications, not implementation code. They belong together as a group, and
that group is correctly separate from the code that uses them.

The asymmetric consumption pattern (output.ts only used by handler, query.ts
only used by server) is an artifact of the project's current feature set. If a
query CLI command were added later, `query.ts` would gain a second consumer in
`cli/`. The schema module is correctly positioned for that growth.

**Verdict: `schemas/` is correct as a peer module, not a subfolder of
`handler/`.** The reasoning in the reclustering report stands.

---

## Question 4: Is the `handler/` vs `cli/` split correct?

**Current:** `cli/ui.ts` imports `spawnServer()` from `handler/spawn.ts`.

This is the one cross-domain import flagged in the reclustering report. It is
worth analyzing more carefully here.

The import direction is `cli/ → handler/`. The semantic problem is that
`spawn.ts` serves two callers whose concern is identical ("start the hookwatch
server if it is not running") but who call it from different contexts: the hook
handler calls it automatically on connection failure, and the CLI calls it
explicitly when the user runs `hookwatch ui`.

**What is `spawn.ts` really?** It is server lifecycle management. It knows how
to start `server/index.ts` as a detached process and verify it is healthy. It
does not depend on anything in `handler/` except `errors.ts` — a utility that
is genuinely shared.

The reclustering report recommended moving it to `src/server-spawn.ts`. That
recommendation stands, but I want to be explicit about why: `spawn.ts` is not a
handler concern at all. The handler uses it opportunistically (auto-start on
connection failure), but the file's identity is server lifecycle, not hook
processing. Placing it in `handler/` is a category error that the cross-domain
import makes visible.

**Verdict: The `handler/` vs `cli/` split is correct.** The only fix needed is
moving `spawn.ts` to `src/server-spawn.ts`. The reclustering report's Change A
remains valid.

---

## Question 5: Layer-based vs feature-based split

**Current structure:** layer-based (handler, server, db, schemas, cli, ui).

A feature-based split would organize around event lifecycle instead:

```text
src/
  capture/    (receive event from Claude Code → validate → send to server)
  store/      (receive from handler → validate again → insert into DB)
  stream/     (broadcast new events to connected SSE clients)
  query/      (retrieve events from DB → serve to UI)
  display/    (render events in browser UI)
  install/    (CLI install/uninstall/ui commands)
```

**Why the feature-based split is wrong for this project:**

The feature boundaries do not correspond to module boundaries in the current
code. "Capture" spans `handler/index.ts`, `handler/post-event.ts`,
`schemas/events.ts`, and `schemas/output.ts`. "Store" spans `server/ingest.ts`,
`db/queries.ts`, and `db/connection.ts`. Moving these into feature folders would
require either:

1. Duplicating shared utilities across features (breaking DRY), or
2. Keeping shared layers anyway (`schemas/`, `db/`, `paths.ts`) and only
   reorganizing the endpoints, which adds folders without adding clarity.

Feature-based splits make sense for large systems where features are developed
and deployed independently. Hookwatch is a 35-file tool where every feature
touches the same pipeline. The layer-based split reflects the actual process
boundary in the architecture: the handler process (short-lived) vs the server
process (long-lived). `handler/`, `schemas/`, `cli/` are in the handler process;
`server/`, `db/`, `ui/` are in the server process. This process boundary is the
natural organizing principle.

**Verdict: Layer-based split is correct for this project.** Feature-based
splits are over-architecture at this scale and would obscure the process
boundary that defines the system's actual separation of concerns.

---

## Question 6: Test organization

**Current:** `src/test/` contains 7 shared utility files, with test fixtures
and integration helpers organized by concern rather than by production module.

**Assessment: The test organization has one real problem and several minor
observations.**

**Real problem: Two copies of event name lists**

`src/types.ts` exports `EVENT_NAMES` (18 events, alphabetically sorted).
`src/cli/events.ts` exports `EVENT_TYPES` (the same 18 events, in a different
order). These two constants contain identical content but different orderings.
They are not synchronized: adding a new event type requires updating both.
The placement rule in `types.ts` says "2+ domains → move to shared." Both
`handler/` (via `schemas/events.ts`) and `cli/` need this list. There is no
justification for maintaining two lists.

The reclustering report did not flag this. It should be flagged now.

`EVENT_TYPES` in `cli/events.ts` exists because the CLI module needed a
separate file to prevent `import.meta.main` in `cli/index.ts` from executing
during tests. The separation from `index.ts` is correct — but the solution
should be to import `EVENT_NAMES` from `@/types.ts` and re-export it as
`EVENT_TYPES`, not to maintain a second array. Currently there is no type-level
guarantee that the two lists stay in sync.

**Minor observation 1: `src/test/types.ts` (24 lines)**

The single-interface file `ServerHandle<P>` is used by `test/test-server.ts`
and, per its JSDoc, by Playwright E2E tests. The separation is justified to
avoid coupling the Playwright entrypoint to Bun-specific modules. No change
needed.

**Minor observation 2: `handler-assertions.ts` placement**

This file defines the exit code contract for bare and wrapped handler modes. It
uses `bun:test` types directly. It could logically live in `handler/` since it
is specific to handler behavior, but it lives in `src/test/` because it is test
infrastructure, not production code. The current placement is correct.

**Minor observation 3: `wrap-runner.fixture.ts` in `handler/`**

Already noted in the reclustering report: correctly placed because it calls
`handler/wrap.ts` internals. The test layer's reliance on a fixture next to its
production module is standard practice for module-boundary testing.

**Verdict on test organization:** Sound, with one actionable fix (the
`EVENT_TYPES` duplication).

---

## Real problems found

### Problem A: `EVENT_TYPES` duplicates `EVENT_NAMES`

**Location:** `src/cli/events.ts` and `src/types.ts`

Both arrays contain the same 18 event names. They are not linked in any way.
Adding a new Claude Code event type requires editing both. The type system does
not catch a mismatch.

**Concrete consequence:** If `InstructionsLoaded` were added to `EVENT_NAMES`
but missed in `EVENT_TYPES` (or vice versa), the handler would process it but
the CLI would not register it as a known subcommand, and the install command
would not generate a hook entry for it. This would be a silent failure.

**Fix:** In `cli/events.ts`, import `EVENT_NAMES` from `@/types.ts` and derive
`EVENT_TYPES` and `EventType` from it:

```ts
import { EVENT_NAMES } from "@/types.ts";
export const EVENT_TYPES = EVENT_NAMES;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_SET: ReadonlySet<string> = new Set(EVENT_TYPES);
```

The ordering difference is cosmetic. No test currently asserts the array order.

**Severity:** Medium. Latent sync bug, not a current failure.

### Problem B: `cli/ui.ts` imports `spawnServer()` from `handler/spawn.ts`

Already identified in the reclustering report (Change A). Confirmed here with
more detail: `spawn.ts` has no handler-domain logic. Its only dependency from
within `handler/` is `errors.ts`, a utility that should arguably live at
`src/errors.ts` anyway (it is imported by 5 files in 2 domains). Moving
`spawn.ts` to `src/server-spawn.ts` removes the cross-domain import.

**Severity:** Low. Currently documented, not causing bugs. But it sets a
precedent for future cross-domain imports if left unaddressed.

---

## Latent coupling: `db/queries.ts` imports from `schemas/query.ts`

`db/queries.ts` imports `QueryFilter` type from `@/schemas/query.ts`. This
means the DB layer depends on the Zod schema layer. The DB layer should define
its own interface types or accept a plain TypeScript interface.

This was noted as low priority in the reclustering report. After reading the
full code, that assessment stands. The coupling is type-only (not a value
import), and the practical consequence is that `QueryFilter` must remain in
`schemas/query.ts` rather than being duplicated. The fix would require either
moving `QueryFilter` to `src/types.ts` or defining a plain TypeScript interface
in `db/queries.ts` that `schemas/query.ts` satisfies by structural typing.

At this project size, neither option adds enough clarity to justify the
refactor. Track but do not fix.

---

## Overall verdict

The layer-based folder structure is the right abstraction for a project of this
size. The process boundary (short-lived handler vs long-lived server) maps
directly onto the existing module split. Feature-based reorganization would add
navigation complexity without adding clarity.

Three changes are justified:

1. **Fix (medium):** Eliminate `EVENT_TYPES` duplication — derive it from
   `EVENT_NAMES` in `types.ts`. One list, one source of truth.
2. **Refactor (low):** Move `handler/spawn.ts` → `src/server-spawn.ts` to
   remove the cross-domain import from `cli/` into `handler/`.
3. **Track (low):** The `db/` → `schemas/` type dependency is a structural
   impurity worth noting but not fixing now.

Changes from the reclustering report (Change B: fix `EventRow` import source
in UI components) remain valid and are not repeated here, but are still
recommended.

The `schemas/`, `db/`, `test/`, and `ui/` module boundaries are all
well-drawn. No folder merges are warranted. No feature-based restructuring
is warranted.
