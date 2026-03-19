# AGENTS.md — hookwatch

Claude Code plugin that captures all 18 hook event types, stores them in a
local SQLite database, and serves a web UI for browsing and querying events.
Install with `hookwatch install` (registers via `bun link`), then activate with
`claude --plugin-dir <path>`. Uninstall cleanly with `hookwatch uninstall`.

## Mandatory Rules

These rules MUST NOT be violated by any agent. They are enforced by code review.

**ch-lar — Parameterized SQL only.** Never concatenate user data into SQL
strings. All values passed to SQLite must use `?` placeholders via
`bun:sqlite` parameterized queries. Violating this rule creates SQL injection
vulnerabilities.

**ch-u88 — No innerHTML.** Never use `innerHTML`, `outerHTML`, or
`dangerouslySetInnerHTML`. SSE data is JSON-stringified and never interpolated
into HTML. htm tagged template literals auto-escape all interpolated values
— use them for all UI rendering.

## Naming Conventions

```csv
Context,Convention,Example
Database columns,snake_case,"session_id, hook_duration_ms"
JSON API fields,snake_case,"session_id, hook_duration_ms"
TypeScript identifiers,camelCase,"sessionId, hookDurationMs"
File names,kebab-case,"event-list.ts, db-connection.ts"
Zod schemas,camelCase + Schema suffix,"sessionStartSchema, toolUseSchema"
Zod inferred types,PascalCase,"SessionStart, ToolUse"
Preact signals,camelCase,"eventList, activeSession"
```

## File Layout

```text
hookwatch/
├── package.json
├── tsconfig.json
├── biome.json
├── AGENTS.md
├── README.md
├── .gitignore
├── .claude-plugin/
│   └── plugin.json          — plugin manifest for `claude --plugin-dir`
├── hooks/
│   └── hooks.json           — generated, registered event types
│
├── src/
│   ├── handler/             — hook entry point (stdin → validate → POST)
│   ├── server/              — Bun.serve() HTTP server, routes, SSE
│   ├── db/                  — bun:sqlite: schema, migrations, query helpers
│   ├── schemas/             — Zod schemas for all 18 event types
│   ├── ui/                  — Preact + htm web UI components
│   ├── cli/                 — citty subcommands (install, uninstall, ui) + 18 PascalCase event subcommands
│   └── test/                — shared test utilities (fixtures, setup, subprocess helpers)
│
└── tests/                   — integration tests (handler-server, smoke-http)
```

## Tech Stack

```csv
Concern,Technology,Notes
Runtime,Bun,Runs .ts natively — no transpilation or build step
Database,bun:sqlite (built-in),"WAL mode, zero external deps"
Validation,Zod,Runtime event validation — validates stdin payloads for all 18 event types
CLI,citty,"~10KB, 3 subcommands: install uninstall ui — plus 18 PascalCase event family subcommands"
Web UI,Preact + htm,Tagged template literals — no JSX transform needed
State,Preact signals,~1KB — automatic reactivity without prop drilling
Styling,Pico CSS + CSS-in-JS,Pico for base styles; custom via style objects
Linting,Biome,Lint + format in one tool
Testing,bun test,Built-in test runner
Config,smol-toml,~/.config/hookwatch/config.toml (not yet used — planned for ch-1ex5.1)
```

## Database

- Path: `$XDG_DATA_HOME/hookwatch/hookwatch.db` (default: `~/.local/share/hookwatch/hookwatch.db`)
- Permissions: `0600` — set immediately after file creation
- WAL mode: `PRAGMA journal_mode=wal` on every connection open
- Schema version: `PRAGMA user_version` for sequential migrations

## API

- `POST /api/events` — handler → server event ingestion
- `POST /api/query` — flexible filter-based queries (web UI → server)
- `GET /api/events/stream` — SSE stream for live updates
- `GET /health` — health check (used by handler spawn probe)
- Error format: `{ "error": { "code": "DB_LOCKED", "message": "..." } }`
- Error codes: `DB_LOCKED`, `NOT_FOUND`, `INVALID_QUERY`, `INTERNAL`

## Testing Approach

- Unit tests co-located with source (`src/db/schema.test.ts` next to `src/db/schema.ts`)
- Integration tests in `tests/` directory
- All 18 event types must have at least one test case
- Zod schema validation tests against known payloads

## Scripts

Use `package.json` scripts for all tooling — never call `bunx biome` directly.

```csv
Command,What it runs
bun run check,tests + biome lint (run before each commit)
bun run dev,start server with --watch
bun run format,biome format --write .
bun run generate,regenerate .claude-plugin/plugin.json and hooks/hooks.json
bun run lint,biome check .
bun run probe:launcher,run Claude Code probe scripts
bun run release <version>,pre-release validation + git tag (accepts v0.1.0 or 0.1.0)
bun run start,start server
bun run test,unit + integration tests
bun run test:e2e,Playwright UI e2e tests
bun run test:smoke-browser,Playwright browser smoke test
bun run test:smoke-http,HTTP smoke test
bun run test:sse-e2e,Playwright SSE e2e tests
bun run verify <plugin-dir>,e2e verification with Claude Code (absolute path required)
```

## Handler Entry Point

The handler is invoked by the CLI (18 PascalCase event subcommands) and directly
when run as the main module. The public API is:

```ts
export async function runHandler(wrappedCommand?: string[]): Promise<void>
```

Mode is determined solely by the `wrappedCommand` argument:

- `wrappedCommand` undefined or empty → bare mode (observe only)
- `wrappedCommand` non-empty → wrapped mode (spawn child, tee I/O)

The CLI passes `context.rawArgs` directly: non-empty = wrapped mode, empty =
bare mode. There is no environment variable for mode detection — only this
argument.

Both modes share the same `handleHook()` pipeline. The branch point is
`wrapArgs` being null (bare) or non-null (wrapped).

## Process Rules

- **Handler errors:** Fatal errors exit 0 + JSON stdout with `systemMessage` (server unreachable, schema parse failure). Non-fatal errors log to `hookwatch_log` DB column. Never exit 1 (generic "hook error", useless) or exit 2 (JSON ignored per Claude Code docs). Hookwatch must never block Claude Code. `systemMessage` format: `"hookwatch captured <EventType> (<subtype>)"` (subtype omitted when not applicable).
- **Server errors:** Structured JSON `{ "error": { "code": "...", "message": "..." } }`
- **UI errors:** Display server errors — never swallow silently
- **Imports:** Use `@/` path alias (maps to `./src/`) — no relative `../` chains
- **No build step:** Bun runs `.ts` directly. `Bun.Transpiler` handles UI delivery on-the-fly
- **Bun-native APIs preferred:** Use `Bun.write()`, `Bun.file().text()`, `Bun.file().exists()`, `Bun.file().delete()` instead of `node:fs` equivalents. Keep `node:fs` only when no Bun equivalent exists: `mkdirSync({ recursive })`, `mkdtempSync()`, `rmSync({ recursive })`, `chmodSync()`, `renameSync()`, `appendFileSync()`, `openSync()`, `tmpdir()`
