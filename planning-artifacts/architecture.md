---
stepsCompleted: [1, 2, 3]
inputDocuments:
  - planning-artifacts/prd.md
  - docs/design.md
  - docs/hook-stdin-schema.md
workflowType: 'architecture'
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
- **Reliability** (NFR5-8): Handler never crashes, drops events silently if
  server unreachable, SQLite WAL for crash recovery
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

1. Handler POSTs event to `localhost:6004/events`
2. If connection refused → spawn Bun server in background
3. Poll `GET /health` at 50ms intervals (max 2s timeout)
4. If health OK → retry POST
5. If health timeout → drop event silently (NFR6)

Happy path (server running) is one POST with no overhead.

### Cross-Cutting Concerns Identified

- **Error resilience**: Handler must catch all errors and exit 0. No exception
  may propagate to Claude Code. This affects every code path in the handler
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
    events/EventList.ts, EventDetail.ts
    sessions/SessionFilter.ts, SessionList.ts
    wrap/WrapViewer.ts
    shared/Layout.ts
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
- **Distribution (v0)**: `claude plugin install` + npm/bun global install
  (`npm install -g hookwatch` → `hookwatch install`)
- **Distribution (v2+)**: Homebrew custom tap or core (ch-8rv). Requires
  `bun build --compile` for standalone binary if targeting core
- **Build step**: No build step for development. `bun build --compile` for
  distribution only (standalone binary for Homebrew, npm binary)

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
