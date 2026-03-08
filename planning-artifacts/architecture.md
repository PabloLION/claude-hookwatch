---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - planning-artifacts/prd.md
  - docs/design.md
  - docs/hook-stdin-schema.md
workflowType: 'architecture'
lastStep: 8
status: 'complete'
completedAt: '20260304'
project_name: 'hookwatch'
user_name: 'pablo'
date: '20260304'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

28 FRs across 8 capability areas. The core pipeline is: capture (FR1-5) →
store (FR6-9) → serve (FR10-14, FR20-23). Two CLI commands add secondary entry
points: `hookwatch open` (FR15-16) for manual server start, and `hookwatch
wrap` (FR17-19) for stdin/stdout/stderr capture of arbitrary commands. Plugin
compliance (FR24-26) and context injection (FR27-28) round out the surface.

The FRs split across two process boundaries:

- **Handler process** (short-lived): FR1-5, FR20, FR27-28. Invoked per hook
  event. Must be fast, never crash, never block
- **Bun server** (long-lived): FR6-9, FR10-14, FR21-23. Manages SQLite, serves
  web UI, accepts events from handler

**Non-Functional Requirements:**

14 NFRs shaping architecture:

- **Performance** (NFR1-4): <100ms amortized handler latency (design principle
  in v0, enforced SLA in v3). No build step. Web UI handles up to 10k events
- **Reliability** (NFR5-8): Handler never crashes, exits 2 + JSON stdout if
  server unreachable (fatal; non-fatal issues log to hookwatch_log DB column),
  SQLite WAL for crash recovery
- **Security** (NFR9-11): 0600 file permissions, localhost-only, no secrets in
  config
- **Integration** (NFR12-14): Forward-compatible schemas, clean plugin
  install/uninstall, no external runtime deps beyond Bun

**Scale & Complexity:**

- Primary domain: Developer tool (local web app)
- Complexity level: Low
- Estimated architectural components: ~6 (handler, server, SQLite layer, web UI,
  CLI commands, plugin manifest)

### Technical Constraints and Dependencies

- **Runtime**: Bun only. Min + max version range (not pinned to exact)
- **Dependencies**: `bun:sqlite` (built-in) + Zod (~50KB, zero transitive deps)
- **No build step**: Handler path runs raw TypeScript via Bun
- **Plugin system**: Must comply with `claude plugin install` format
  (plugin.json + hooks.json + handler)
- **hooks.json event registration**: Wildcard support (`"*"`) unverified
  (ch-0fn). If unsupported, all 18 event types registered explicitly. CI cron
  monitors SDK for new types (ch-vnv)
- **Localhost only**: Web server binds to 127.0.0.1
- **File permissions**: Database created with 0600 (owner-only)
- **Two-plugin split**: hookwatch-hooks (v0) and hookwatch-skills (v1) share one
  Bun server and SQLite database

### Server Configuration

- **Default port**: 6004, auto-increment (6005, 6006...) if occupied (ch-1sn)
- **CLI override**: `hookwatch open --port N` — if port occupied, error with
  "port in use" (no auto-increment on explicit choice)
- **Shared server model**: One Bun server + one SQLite database per machine.
  Multiple Claude Code sessions share the same server, differentiated by
  `session_id`. Per-session isolation is a non-goal in v0-v3
- **Session grouping**: Via `HOOKWATCH_GROUP` env var, v4+ (ch-ujs)

### Handler-Server Coordination

The handler (short-lived) must communicate with the Bun server (long-lived).
The coordination flow for v0 (ch-a2f):

1. Handler POSTs event to `localhost:6004/api/events`
2. If connection refused → spawn Bun server in background
3. Poll `GET /health` at 50ms intervals (max 2s timeout)
4. If health OK → retry POST
5. If health timeout → exit 2 + JSON stdout (fatal, server unreachable)

Happy path (server running) is one POST with no overhead.

### Cross-Cutting Concerns Identified

- **Error resilience**: Handler must catch all errors — no exception may
  propagate to Claude Code. Exit 0 on success; fatal errors (server unreachable)
  exit 2 + JSON stdout. Non-fatal errors logged to `hookwatch_log` DB column.
- **Forward compatibility**: Unknown event types and unknown fields must be
  preserved. Affects Zod schemas, SQLite storage, and web UI rendering.
  Note: forward compatibility applies to field-level schema evolution. New event
  type discovery depends on hooks.json registration strategy (ch-0fn)
- **Data sensitivity**: All stdin payloads stored in plaintext. File permissions
  are the only v0 barrier. v1 adds per-event-type filtering (ch-x42)
- **Design doc drift**: `./docs/design.md` contains outdated decisions (Svelte,
  daemon terminology, HITL/guardrail scope). The PRD is the authoritative source
  for v0 scope. Multiple beads issues track the updates needed

## Starter Template Evaluation

### Primary Technology Domain

CLI tool + local web server. Not a web application — standard web framework
starters (Next.js, Vite, SvelteKit, etc.) do not apply.

### Starter Options Considered

No starter template needed. The project is a small Bun/TypeScript project (~10
source files) with no build step, no bundler, and no framework scaffolding. All
technology decisions are already established in the PRD.

### Selected Approach: Manual initialization

**Rationale:** hookwatch's minimal stack (Bun + TypeScript + Preact/htm +
bun:sqlite + Zod) has no matching starter template. The closest equivalent is
`bun init`, which creates a bare `package.json` and `tsconfig.json`.

**Initialization:**

```sh
bun init
```

**Architectural Decisions (pre-established, not from starter):**

- **Language & Runtime**: TypeScript on Bun. No transpilation, no build step.
  Bun runs `.ts` directly. TypeScript only — no JavaScript files
- **Web UI**: Preact + htm (tagged template literals in `.ts` files — no
  JSX/TSX transform needed). Served as static assets from the Bun server
- **Database**: `bun:sqlite` (built-in). WAL mode. Zero external dependencies
- **Validation**: Zod for hook stdin payload validation. Only runtime dependency
- **Config**: TOML (`smol-toml` if needed). Optional config file
- **Testing**: Bun's built-in test runner (`bun test`)
- **CLI**: citty (~10KB, modern, zero deps) for subcommand parsing (`install`,
  `uninstall`, `open`, `wrap`). Global flags: `--help`/`-h`, `--version`/`-v`
- **Linting/Formatting**: Biome (lint + format in one tool)
- **Code Organization**: Single handler entry point, plugin manifest structure
  per `claude plugin install` requirements

### Type Configuration

- **Server code**: `bun-types` for Bun APIs (`Bun.serve()`, `bun:sqlite`,
  `Bun.file()`, etc.)
- **Frontend code**: Standard DOM types (runs in browser, not Bun)
- **No JSX/TSX config**: htm uses tagged template literals — works in plain
  `.ts` files without any JSX transform or pragma

### Dev Experience

- **Server reload**: `bun --watch` restarts Bun server on file changes
- **Browser reload**: SSE endpoint (`/dev/events`) in dev mode — injects
  `EventSource` snippet that triggers `location.reload()` on file changes
- **No separate dev server**: Bun server serves both API and web UI. Dev mode
  adds the SSE reload endpoint

### Gaps Deferred to Architectural Decisions (step 4)

**Monorepo strategy:** hookwatch-hooks (v0) and hookwatch-skills (v1) share
code (SQLite layer, Zod schemas, server). Options to evaluate:

- Bun workspaces (lightweight, built-in)
- Single repo with internal packages
- Single plugin with both hooks and skills, feature-flagged

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (block implementation):**

- Data architecture: single events table + JSON payload
- Handler→server: JSON over HTTP on localhost:6004
- Web UI: Preact + htm + Preact signals
- Plugin files: generated from source, placed at root level

**Important Decisions (shape architecture):**

- Live updates: SSE (Server-Sent Events)
- CLI framework: citty
- Styling: Pico CSS base + CSS-in-JS for custom styles
- File layout: by layer
- Linting: Biome
- Schema migrations: SQLite user_version pragma

**Deferred Decisions (post-MVP):**

- Wrap table split if performance issues (ch-2db, P4, v2+)
- Standalone desktop app (ch-r8b, P4, v3+)
- Homebrew distribution (ch-8rv, P4, v2+)
- Session grouping via env var (ch-ujs, P4, v4+)

### Data Architecture

- **Single `events` table**: All 18 event types + wrap data in one table.
  Common columns extracted (id, ts, event, session_id, cwd, tool_name,
  session_name, hook_duration_ms), full stdin JSON in `payload` column
- **No table-per-event-type**: Waterfall chart in v1 needs all events in one
  query. Separate tables would require UNION across 18 tables
- **Wrap data in same table (v0)**: Wrap captures (stdout, stderr, exit_code)
  stored alongside hook events. Split to dedicated table only if performance
  issues arise (ch-2db)
- **Schema migrations**: SQLite `PRAGMA user_version` tracks schema version.
  Server checks on startup, runs sequential migrations if needed
- **Bidirectional validation**: Zod schemas derived from Claude Code SDK
  TypeScript interfaces. Validates both stdin (Claude Code → hook) and stdout
  (hook → Claude Code). Output validation catches silent failures where Claude
  Code ignores malformed hook JSON (ch-27o). Strict on known fields, permissive
  on unknown

### API & Communication

- **Handler → Server**: JSON over HTTP. `POST /api/events` to ingest events.
  No Unix domain socket — HTTP is cross-platform (Windows support)
- **Web UI → Server**: Single query endpoint + SSE for live updates
  - `POST /api/query` — flexible filter-based queries for events, sessions,
    event detail. One route handler, one filter parser. Adding new filters
    doesn't require new routes. Skills (v1) use the same endpoint
  - `GET /api/events/stream` — SSE stream for live updates. Browser reconnects
    automatically on connection drop
- **Error format**: Structured JSON
  `{ "error": { "code": "DB_LOCKED", "message": "..." } }`.
  Codes: `DB_LOCKED`, `NOT_FOUND`, `INVALID_QUERY`, `INTERNAL`

### Frontend Architecture

- **State management**: Preact signals (~1KB). Automatic reactivity, shared
  state without prop drilling. The reason to use Preact over vanilla JS
- **Component structure**: File-per-component + feature folders

  ```text
  src/ui/
    events/event-list.ts, event-detail.ts
    sessions/session-filter.ts, session-list.ts
    wrap/wrap-viewer.ts
    shared/layout.ts
    app.ts
  ```

- **Styling**: Pico CSS (~10KB) as base — semantic HTML styled automatically,
  dark mode built-in. Custom styles via CSS-in-JS (style objects or inline
  `<style>` tags in components) for hookwatch-specific views (event timeline,
  waterfall chart)
- **Style scoping**: No built-in scoping in Preact. Use unique class prefixes
  (e.g., `.hw-event-list`) or inline style objects. Shared styles as TypeScript
  constants imported by components
- **Live updates**: SSE via `EventSource`. Server pushes new events, Preact
  signal updates, DOM re-renders automatically. No polling
- **UI delivery**: No .js files on disk. Bun server transpiles `.ts` → JS
  on-the-fly using `Bun.Transpiler`, serves with
  `Content-Type: application/javascript`. In-memory `Map` cache keyed by file
  path + mtime — each file transpiled once per server session. ~15 UI files ×
  sub-millisecond per file = <10ms cold start. No build step, no service
  worker, no pre-built artifacts

### CLI & Distribution

- **CLI framework**: citty (~10KB). 4 subcommands: `install`, `uninstall`,
  `open`, `wrap`. Global flags: `--help`/`-h`, `--version`/`-v` (available on
  all subcommands)
- **`hookwatch install`**: Generates plugin files from source and registers
  hooks in Claude Code. Also serves as update — uninstalls then reinstalls.
  Does not modify Claude Code config, only hooks. Skills registration added
  in v1 (may use separate `install hooks` / `install skills` subcommands with
  different scopes). External "skill" package is an alternative for plugin
  installation — evaluate during implementation
- **`hookwatch uninstall`**: Removes hooks (and skills in v1) from Claude Code
- **Runtime dependency**: Bun is a runtime requirement, not just a development
  tool. Users must have Bun installed. npm package should declare this or
  provide installation guidance
- **Distribution (v0)**: npm/bun global install only
  (`npm install -g hookwatch` → `hookwatch install`). `hookwatch install`
  calls `claude plugin install` internally — not a user-facing channel.
  Same model as beads-tracker
- **Distribution (v2+)**: Homebrew custom tap or core (ch-8rv). Requires
  `bun build --compile` for standalone binary if targeting core
- **Build step**: None. Bun runs `.ts` directly (server-side), Bun.Transpiler
  handles UI delivery (browser-side). `bun build --compile` only for
  Homebrew standalone binary (v2+)

### Infrastructure & Code Organization

- **File layout**: By layer — `src/handler/`, `src/server/`, `src/db/`,
  `src/ui/`, `src/cli/`
- **Plugin manifest**: Generated from source via script during `hookwatch
  install` or release step. Also placed at root level in repo for `claude
  plugin install` compatibility. Plugin version enforced to match package.json
  version (ch-9eh, post-v0)
- **Single package**: One repo, one package.json. hookwatch-hooks (v0) and
  hookwatch-skills (v1) are install targets within the same package, not
  separate plugins
- **Linting/Formatting**: Biome (lint + format in one tool)
- **Dev experience**: `bun --watch` for server + SSE-based browser reload in
  dev mode
- **Config path**: XDG — `~/.config/hookwatch/config.toml`
- **Database path**: XDG data — `~/.local/share/hookwatch/hookwatch.db`

### Security Hardening (Red Team Analysis)

Five attack vectors evaluated. Two are mitigated by design, one deferred to v1,
two deferred to v5+.

**Mitigated by design (v0):**

- **SQL injection via payload**: `bun:sqlite` parameterized queries prevent
  interpolation of user data into SQL. Enforce: never string-concatenate
  values into queries. Add to AGENTS.md as mandatory rule (ch-lar, P1)
- **XSS via event payload**: htm tagged template literals auto-escape all
  interpolated values. Enforce: never use `innerHTML` or
  `dangerouslySetInnerHTML`. Add to AGENTS.md as mandatory rule (ch-u88, P1)

**Deferred:**

- **Large payload DoS** (v1): Oversized hook stdin payloads could fill SQLite
  or slow queries. Accept all payloads in v0. Query limits (ch-q3u) provide
  partial protection in v1
- **Port hijacking** (v5+): Any file-readable secret (token, PID, nonce) is
  defeatable by an attacker with filesystem access. If attacker has local FS
  access, hookwatch is not the primary threat. Revisit if hookwatch ever serves
  non-localhost (ch-bl4, P4)
- **Spawn race condition** (v5+): Two handlers fire simultaneously, both get
  connection refused, both attempt to spawn the server. Related risk: handler
  must discover which port the server landed on after auto-increment. Retry
  after spawn failure is the v0 workaround (ch-b5o, P2)

### Decision Impact Analysis

**Implementation sequence:**

1. SQLite schema + db layer (foundation for everything)
2. Handler + Zod validation — both stdin and stdout (event capture pipeline)
3. Bun server + query endpoint (serves data)
4. SSE stream (live updates)
5. Preact + htm web UI (renders events)
6. CLI commands via citty (install, uninstall, open, wrap)
7. Plugin manifest generation

**Cross-component dependencies:**

- Web UI depends on query endpoint depends on SQLite schema
- SSE depends on server + signals depends on Preact
- Handler depends on server (POST events) depends on SQLite
- CLI `install` depends on plugin manifest generation
- All Zod schemas depend on Claude Code SDK type definitions (both input and
  output directions)

## Implementation Patterns & Consistency Rules

Patterns that prevent AI agents from writing incompatible code. Each pattern
addresses a specific conflict point where different agents could make different
choices.

### Naming Patterns

- **Database columns**: snake_case everywhere — `session_id`, `event_type`,
  `hook_duration_ms`. Same casing in SQL and TypeScript. Fallback: if Biome
  enforces camelCase in TS, add a snake↔camel converter at the db layer
  boundary and use camelCase in TypeScript only
- **File naming**: kebab-case for all files — `event-list.ts`, `db-layer.ts`,
  `session-filter.ts`. Fallback: PascalCase for Preact components only
  (`EventList.ts`) if kebab-case causes tooling issues
- **Zod schemas**: camelCase + Schema suffix — `sessionStartSchema`,
  `toolUseSchema`. Inferred types use PascalCase:
  `type SessionStart = z.infer<typeof sessionStartSchema>`
- **Preact signals**: camelCase, no suffix — `eventList`, `activeSession`,
  `filterState`. Signals are used like normal variables
- **JSON API fields**: snake_case — matches database columns end-to-end.
  No mapping layer between SQLite → API → frontend

### Structure Patterns

- **Tests**: Mixed — unit tests co-located (`src/db/schema.test.ts` next to
  `src/db/schema.ts`), integration tests in `tests/` directory
  (`tests/handler-server.test.ts`). Bun test runner discovers `*.test.ts`
  anywhere
- **Shared schemas**: `src/schemas/` — dedicated directory for Zod schemas
  shared across handler, server, and UI. Core data contract lives here
- **Imports**: Path aliases — `@/` maps to `./src/` via tsconfig.json `paths`.
  Bun supports this natively. Fallback: relative paths without barrel
  `index.ts` files (avoid circular dependency traps)

### Format Patterns

- **Dates**: Unix epoch milliseconds (`Date.now()`) in handler, database, and
  API. Numeric comparison in queries, `new Date(ts)` in UI. No string parsing
  overhead

### Process Patterns

- **Handler errors**: Priority chain — fatal (server unreachable): exit 2 + JSON
  stdout; non-fatal (server OK, hookwatch internal issue): log to `hookwatch_log`
  DB column; normal: `hookwatch_log` NULL. Never exit 1 — Claude Code shows only
  a generic "hook error" and swallows stderr. Exit 2 + JSON is strictly better.
  In wrapped mode: child exit code is always forwarded unchanged.
- **Server errors**: Structured JSON
  `{ "error": { "code": "DB_LOCKED", "message": "..." } }` for all API
  responses. Log to stderr with level prefix (`[ERROR]`, `[WARN]`, `[INFO]`)
- **UI errors**: Display server errors in UI. Never swallow errors silently

### Enforcement

These patterns go into AGENTS.md as mandatory rules for all AI agents:

- Parameterized SQL queries only (ch-lar)
- Never use innerHTML or dangerouslySetInnerHTML (ch-u88)
- snake_case for database columns and JSON API fields
- Exit 2 + JSON stdout (not exit 1) for fatal handler errors
- Co-locate unit tests, integration tests in `tests/`
- Path aliases `@/` for imports

## Project Structure & Boundaries

### FR → Directory Mapping

```csv
FR Category,Directory,Key Files
"Capture (FR1-5, FR20, FR27-28)",src/handler/,"Entry point, POST to server, spawn logic"
Store (FR6-9),src/db/,"Schema, migrations, query helpers"
"Serve (FR10-14, FR21-23)",src/server/,"HTTP server, query endpoint, SSE"
Web UI (FR10-14),src/ui/,"Preact components, app entry"
CLI (FR15-19),src/cli/,citty subcommands
Plugin (FR24-26),src/cli/ + root,"Manifest generation, hooks.json"
Validation (FR27-28),src/schemas/,Zod schemas (stdin + stdout)
```

### Complete Project Directory Structure

```text
hookwatch/
├── package.json
├── tsconfig.json
├── biome.json
├── README.md
├── AGENTS.md
├── LICENSE
├── .gitignore
│
├── plugin.json              ← generated, checked in for `claude plugin install`
├── hooks.json               ← generated, registered event types
│
├── src/
│   ├── handler/
│   │   ├── index.ts         ← hook entry point (stdin → validate → POST)
│   │   ├── spawn.ts         ← server spawn + health probe logic
│   │   └── handler.test.ts
│   │
│   ├── server/
│   │   ├── index.ts         ← Bun.serve() setup, route dispatch
│   │   ├── ingest.ts        ← POST /api/events handler
│   │   ├── query.ts         ← POST /api/query handler
│   │   ├── stream.ts        ← GET /api/events/stream (SSE)
│   │   ├── health.ts        ← GET /health
│   │   ├── static.ts        ← serves UI files
│   │   └── server.test.ts
│   │
│   ├── db/
│   │   ├── schema.ts        ← CREATE TABLE, migrations, user_version
│   │   ├── queries.ts       ← parameterized query helpers
│   │   ├── connection.ts    ← open db, WAL mode, 0600 permissions
│   │   └── schema.test.ts
│   │
│   ├── schemas/
│   │   ├── events.ts        ← Zod schemas for all 18 event types (stdin)
│   │   ├── output.ts        ← Zod schemas for hook stdout validation
│   │   ├── query.ts         ← Zod schema for POST /api/query filter
│   │   └── events.test.ts
│   │
│   ├── ui/
│   │   ├── app.ts           ← Preact app entry, signal definitions
│   │   ├── index.html       ← shell HTML (loads Pico CSS + app.ts)
│   │   ├── events/
│   │   │   ├── event-list.ts
│   │   │   └── event-detail.ts
│   │   ├── sessions/
│   │   │   ├── session-filter.ts
│   │   │   └── session-list.ts
│   │   ├── wrap/
│   │   │   └── wrap-viewer.ts
│   │   └── shared/
│   │       └── layout.ts
│   │
│   └── cli/
│       ├── index.ts         ← citty main, subcommand registration
│       ├── install.ts       ← hookwatch install (generate + register)
│       ├── uninstall.ts     ← hookwatch uninstall
│       ├── open.ts          ← hookwatch open (start server + open browser)
│       ├── wrap.ts          ← hookwatch wrap (stdin/stdout/stderr capture)
│       └── generate.ts      ← plugin.json + hooks.json generation
│
├── tests/                   ← integration tests only
│   ├── handler-server.test.ts  ← handler → server round-trip
│   ├── query-filter.test.ts    ← query endpoint with various filters
│   └── fixtures/
│       └── sample-events.ts    ← test event payloads
│
├── scripts/
│   └── generate-plugin.ts   ← CI/release: generate plugin.json + hooks.json
│
├── docs/
│   ├── design.md            ← original design doc (outdated in parts)
│   └── hook-stdin-schema.md ← Claude Code hook event reference
│
└── planning-artifacts/      ← BMAD workflow outputs (not shipped)
    ├── architecture.md
    ├── prd.md
    ├── product-brief-hookwatch-20260226.md
    └── workflow-status.yaml
```

### Architectural Boundaries

**Handler ↔ Server** (HTTP on localhost:6004):

- Handler POSTs JSON to `/api/events`
- One-way data flow: handler → server. Handler never reads from server except
  health check
- Connection refused → spawn → health probe → retry → exit 1 on timeout

**Server ↔ DB** (in-process):

- Direct `bun:sqlite` calls via `src/db/queries.ts`
- No ORM, no abstraction layer beyond query helpers
- All queries parameterized

**Server ↔ UI** (HTTP):

- Server serves `src/ui/` as static files
- UI calls `POST /api/query` for data
- UI subscribes to `GET /api/events/stream` for live SSE updates
- No server-side rendering

**CLI ↔ Claude Code** (filesystem):

- `hookwatch install` generates plugin.json + hooks.json at project root
- Calls `claude plugin install` to register
- `hookwatch uninstall` calls `claude plugin uninstall`

### Data Flow

```text
Claude Code hook event
  → stdin JSON
  → src/handler/index.ts (validate with src/schemas/events.ts)
  → POST /api/events
  → src/server/ingest.ts
  → src/db/queries.ts (INSERT with parameterized SQL)
  → SQLite (WAL mode, ~/.local/share/hookwatch/hookwatch.db)

Browser
  → POST /api/query { filter }
  → src/server/query.ts (validate with src/schemas/query.ts)
  → src/db/queries.ts (SELECT with parameterized SQL)
  → JSON response → Preact signals → DOM
```

## Architecture Validation Results

### Coherence Validation

Four inconsistencies found and resolved during validation:

1. Handler POST path: `localhost:6004/events` → `localhost:6004/api/events`
2. Exit code strategy: resolved as priority chain — fatal errors exit 2 + JSON
   stdout; non-fatal errors log to hookwatch_log DB column; never exit 1
3. Component file naming: PascalCase example → kebab-case (matching step 5
   decision, PascalCase as fallback)
4. UI delivery gap: added on-the-fly transpile via `Bun.Transpiler` with
   in-memory cache. No .js files on disk, no build step

Distribution model updated: npm-only (like beads-tracker). `claude plugin
install` is an internal implementation detail of `hookwatch install`, not a
user-facing channel.

### Requirements Coverage

- **28 FRs**: All mapped to project directories (FR → Directory Mapping table)
- **14 NFRs**: All addressed architecturally. NFR6 updated to reflect priority
  chain (fatal: exit 2 + JSON; non-fatal: hookwatch_log column)
- **19 beads issues**: Track all deferred decisions — no untracked debt

### Implementation Readiness

- All critical and important decisions documented
- Naming, structure, format, and process patterns defined
- Complete project tree with file-level detail
- Architectural boundaries and data flow mapped
- Enforcement rules ready for AGENTS.md

### Architecture Completeness Checklist

**Requirements Analysis:**

- [x] Project context analyzed (28 FRs, 14 NFRs)
- [x] Scale and complexity assessed (low complexity)
- [x] Technical constraints identified (Bun runtime, plugin format)
- [x] Cross-cutting concerns mapped (error resilience, forward compat, security)

**Architectural Decisions:**

- [x] Data architecture (single events table + JSON payload)
- [x] API design (POST /api/query + SSE)
- [x] Frontend stack (Preact + htm + signals + Pico CSS)
- [x] CLI framework (citty, 4 subcommands)
- [x] Security hardening (Red Team analysis, 5 vectors evaluated)
- [x] UI delivery (Bun.Transpiler on-the-fly, no build step)
- [x] Distribution (npm-only, hookwatch install calls claude plugin install)

**Implementation Patterns:**

- [x] Naming conventions (snake_case db/API, kebab-case files, camelCase code)
- [x] Structure patterns (co-located unit tests, integration in tests/)
- [x] Format patterns (Unix epoch ms, snake_case JSON)
- [x] Process patterns (exit 1 on failure, structured errors)
- [x] Enforcement rules for AGENTS.md

**Project Structure:**

- [x] Complete directory tree defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Data flow documented
