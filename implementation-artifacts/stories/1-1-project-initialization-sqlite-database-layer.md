# Story 1.1: Project Initialization & SQLite Database Layer

Status: ready-for-dev

## Story

As a developer building hookwatch,
I want a project skeleton with a SQLite database layer,
so that events have a storage foundation to write to.

## Acceptance Criteria

1. **Given** a fresh clone of the hookwatch repo, **when** `bun install` is run,
   **then** all dependencies (Zod, citty, smol-toml) are installed with no errors.

2. **Given** the database layer is initialized, **when** a database connection is
   opened for the first time, **then** the file is created at
   `~/.local/share/hookwatch/hookwatch.db` with `0600` permissions, WAL mode is
   enabled (`PRAGMA journal_mode=wal`), and the `events` table exists with
   columns: id, ts, event, session_id, cwd, tool_name, session_name,
   hook_duration_ms, payload.

3. **Given** the events table exists, **when** an event row is inserted via the
   query helper, **then** it is persisted and retrievable after closing and
   reopening the connection.

## Tasks / Subtasks

- [ ] Run `bun init` to generate `package.json` and `tsconfig.json` (AC: #1)
- [ ] Install runtime dependencies: `bun add zod citty smol-toml` (AC: #1)
- [ ] Install dev dependencies: `bun add -d @biomejs/biome bun-types` (AC: #1)
- [ ] Configure `tsconfig.json` with strict mode, path alias `@/` mapping to `./src/`, correct moduleResolution and target (AC: #1)
- [ ] Create `biome.json` with lint + format configuration (AC: #1)
- [ ] Create `.gitignore` with node_modules, *.db, .env, dist entries (AC: #1)
- [ ] Create `AGENTS.md` with all project conventions: ch-lar (parameterized SQL only), ch-u88 (no innerHTML), snake_case DB/API fields, camelCase TS, kebab-case files, Biome linting (AC: #1)
- [ ] Create `README.md` with one-liner description, install command, and dev commands (AC: #1)
- [ ] Create `src/db/connection.ts` — open database, create parent directory, set 0600 permissions immediately after file creation, enable WAL mode (AC: #2)
- [ ] Create `src/db/schema.ts` — CREATE TABLE events DDL, `PRAGMA user_version` migration check (AC: #2)
- [ ] Create `src/db/queries.ts` — parameterized INSERT and SELECT helpers for the events table (AC: #2, #3)
- [ ] Create `src/db/schema.test.ts` — test database creation, WAL mode, table existence, insert+retrieve round-trip, persistence after close+reopen (AC: #2, #3)
- [ ] Verify `bun test` passes and `bun install` succeeds from clean state (AC: #1, #2, #3)

## Dev Notes

### Runtime and Tooling

- Runtime: Bun only, TypeScript, no transpilation. Bun runs `.ts` directly
- Database: `bun:sqlite` built-in — zero external database dependencies
- Linting: Biome (lint + format in one tool)
- Testing: `bun test` built-in test runner discovers `*.test.ts` files
- `bun-types` dev dependency provides TypeScript types for all Bun APIs (`Bun.serve()`, `bun:sqlite`, `Bun.file()`, etc.)

### Database Configuration

- DB path: `~/.local/share/hookwatch/hookwatch.db` (XDG data directory)
- Create parent directory (`~/.local/share/hookwatch/`) if it does not exist
- File permissions: call `fs.chmodSync(dbPath, 0o600)` immediately after `new Database(dbPath)` — before any other operations — so the file is locked down the moment it is created
- WAL mode: enable via `db.exec("PRAGMA journal_mode=WAL")` right after chmod
- Schema migrations: `PRAGMA user_version` tracks version, server checks on startup and runs sequential migrations

### bun:sqlite Usage Pattern

```ts
import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";

const dbDir = `${process.env.HOME}/.local/share/hookwatch`;
mkdirSync(dbDir, { recursive: true });
const dbPath = `${dbDir}/hookwatch.db`;

const db = new Database(dbPath);          // creates file on first open
chmodSync(dbPath, 0o600);                 // lock down immediately after creation
db.exec("PRAGMA journal_mode=WAL");       // enable WAL mode

// Prepared statement (parameterized — never string-concatenate values)
const insert = db.prepare(
  "INSERT INTO events (ts, event, session_id, cwd, tool_name, session_name, hook_duration_ms, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);
insert.run(Date.now(), "PreToolUse", sessionId, cwd, toolName, null, null, JSON.stringify(payload));

// Query
const rows = db.prepare("SELECT * FROM events WHERE session_id = ?").all(sessionId);
```

### Events Table Schema

```sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  event TEXT NOT NULL,
  session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  tool_name TEXT,
  session_name TEXT,
  hook_duration_ms INTEGER,
  payload TEXT NOT NULL
);
```

- `id`: auto-incrementing primary key
- `ts`: Unix epoch milliseconds (`Date.now()`)
- `event`: hook event name (e.g., `PreToolUse`, `SessionStart`)
- `session_id`: UUID v4 from Claude Code
- `cwd`: working directory when hook fired
- `tool_name`: nullable — only present for tool-related events
- `session_name`: nullable
- `hook_duration_ms`: nullable — handler execution time
- `payload`: full stdin JSON as TEXT (never parsed in SQL)

### tsconfig.json Settings

The `tsconfig.json` produced by `bun init` needs these additions before the codebase is usable:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"],
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- `"types": ["bun-types"]` — loads Bun global types (replaces `@types/node` for server-side code)
- `"moduleResolution": "bundler"` — correct mode for Bun's resolver; do not use `"node"` or `"node16"`
- `"paths"` — Bun resolves `@/` aliases natively at runtime; IDE tooling uses tsconfig

### Naming Conventions

- snake_case for database columns and JSON API fields
- camelCase for TypeScript code
- kebab-case for file names

### Security

- Parameterized SQL only — NEVER string-concatenate values into queries (AGENTS.md rule ch-lar)
- All query helpers in `src/db/queries.ts` must use `?` placeholders
- Never use `innerHTML` or `dangerouslySetInnerHTML` in UI code (AGENTS.md rule ch-u88)

### AGENTS.md Required Content

The `AGENTS.md` created in this story must include all mandatory project conventions so every subsequent AI agent session picks them up automatically. Minimum required rules:

- **ch-lar**: Parameterized SQL only — never string-concatenate values into queries
- **ch-u88**: Never use `innerHTML` or `dangerouslySetInnerHTML`
- **Naming — DB/API**: snake_case for all database column names and JSON API fields (e.g., `session_id`, `hook_duration_ms`)
- **Naming — TypeScript**: camelCase for TypeScript variables, functions, and schema names
- **Naming — Files**: kebab-case for all source files (e.g., `event-list.ts`, `db-layer.ts`)
- **Linting**: All code must pass `bun run biome check` before committing

### README.md Required Content

A minimal `README.md` at the repo root with:

- One-line description of what hookwatch does
- Install command: `npm install -g hookwatch`
- Dev commands: `bun install`, `bun test`, `bun run biome check`

### Project Structure Notes

```text
hookwatch/
  package.json
  tsconfig.json
  biome.json
  .gitignore
  AGENTS.md
  src/
    db/
      connection.ts    — open db, WAL mode, 0600 permissions
      schema.ts        — CREATE TABLE, migrations, user_version
      queries.ts       — parameterized query helpers
      schema.test.ts   — co-located unit test
```

- Path alias: `@/` maps to `./src/` via tsconfig.json `paths`
- Bun supports tsconfig `paths` natively — no additional resolver config needed

### References

- [Source: ./planning-artifacts/architecture.md#Data Architecture]
- [Source: ./planning-artifacts/architecture.md#Core Architectural Decisions]
- [Source: ./planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/prd.md#Data Storage]
- [Source: ./planning-artifacts/epics.md#Story 1.1]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
