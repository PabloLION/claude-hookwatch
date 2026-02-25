# AGENTS.md — claude-hookwatch

## Project Overview

Claude Code plugin that captures all 19 hook event types, stores them in a
local SQLite database, and serves a web UI for browsing and querying events.
Install with `claude plugin install`, uninstall cleanly with `claude plugin
remove`.

## File Structure

```text
.claude-plugin/
  plugin.json              — Plugin manifest (name, version, author)
hooks/
  hooks.json               — Hook registration (all 19 event types, ".*" matchers)
  handler.ts               — Single entry point for all events
src/
  schemas/                 — Zod schemas for each event type
  db.ts                    — SQLite database operations (bun:sqlite)
  server.ts                — Local web UI server
  ui/                      — Web UI frontend
docs/
  design.md                — Design document (goals, non-goals, FRs, NFRs)
  hook-stdin-schema.md     — Complete stdin schema for all 19 events
```

## Code Conventions

- **Bun/TypeScript** — Bun runs `.ts` natively, no transpilation or bundling
- **bun:sqlite** — built-in SQLite module, WAL mode, zero external dependencies
- **Zod** — runtime validation of stdin payloads (only runtime dependency)
- **Single handler** — one `handler.ts` handles all event types; event routing
  via `hook_event_name` field from stdin JSON
- **Localhost only** — web UI binds to `127.0.0.1`, no external network calls
- **Append-only** — events are never modified after insertion

## Reference Docs

- Hook events (19 types), SQLite schema, querying → `./README.md`
- Full stdin payload schema per event type → `./docs/hook-stdin-schema.md`
- Design decisions, FRs, NFRs, versioning → `./docs/design.md`

## Testing Approach

- Unit tests: mock stdin with sample payloads, verify SQLite rows
- Integration: install plugin in a scratch project, trigger events, verify DB
- All 19 event types must have at least one test case
- Zod schema validation tests against known payloads
- Web UI: Playwright for browser testing

## Commit Conventions

```text
<type>[scope]: <description>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Atomic commits — one logical change per commit.

## Session Close Protocol

When ending a work session, complete ALL steps:

1. **File issues** — create beads issues for remaining work
2. **Quality gates** (if code changed) — tests, linters, type checks
3. **Update issues** — close finished work, update in-progress items
4. **Sync issues** — `bd sync --flush-only` (local export to JSONL)
5. **Commit** — all changes committed
6. **Push** (if remote configured) — `git push` with `git status` verification
7. **Hand off** — provide context for next session
