# hookwatch Design Document

Status: Draft
Created: 20260224, updated 20260225

## Overview

hookwatch is a Claude Code plugin that captures all 18 hook event types, stores
them in a local SQLite database, and serves a web UI for browsing and querying
events. It installs via `claude plugin install` and uninstalls cleanly.

The gap it fills: no existing tool combines full event coverage with plugin
compliance. DazzleML/claude-session-logger is the only plugin-compliant tool but
covers 2 of 18 event types. conclaude covers 18 event types but has no plugin
system. hookwatch bridges both.

## Versioning

```csv
Version,Scope,Description
v0,Core,"Logging + SQLite + basic web UI + plugin system + Zod validation"
v1,Human UX,"UI polish + desktop notifications + waterfall chart + swim lanes + session renaming + log retention"
v2,HITL,"Human-in-the-loop — detect risky actions, ask the human"
v3,Guardrails,"Automated HITL — machine decides based on rules"
```

## Feature Decisions

Complete feature inventory derived from 10 upstream tools. Each feature was
reviewed and classified as goal (with version), non-goal (with reason), or TBD
(tracked as beads issue). See `.git-ignored/notes/upstream-feature-catalog.md`
for the full upstream comparison.

```csv
#,Feature,Decision,Version
A1,Full hook event coverage (18 types),Goal,v0
A2,Unknown event resilience,Goal,v0
A3,Matcher patterns per event,Non-goal,—
B1,JSONL daily files,Non-goal,—
B2,SQLite database,Goal,v0
B3,Per-event-type JSON files,Non-goal,—
B4,Per-session directories,Non-goal,—
B5,OTEL backend export,TBD,tracked (claude-hookwatch-0rm)
B6,Promoted top-level fields,Non-goal,subsumed by SQLite
B7,Log retention (high/low water mark),Goal,v1 (human UX)
C1,Block dangerous commands,Goal,v2 (HITL)
C2,Protect secrets/env files,Goal,v2 (HITL)
C3,File scope enforcement,Goal,v2 (HITL)
C4,Agent-scoped rules,TBD,v3 (guardrail) tracked (claude-hookwatch-r2z)
C5,Permission auto-approve/deny,Goal,v3 (guardrail)
C6,Input modification,Non-goal,—
C7,Path traversal prevention,Goal,v2 (HITL)
C8,Bash pipeline detection,Goal,v2 (HITL)
C9,Risk scoring + posture escalation,Goal,v3 (guardrail)
C10,Autonomy budgets,Goal,v3 (guardrail)
C11,Cryptographic receipts,Goal,v3 (guardrail)
C12,Quality gates,TBD,v3 (guardrail) tracked (claude-hookwatch-cme)
C13,Exfiltration detection,Goal,v2 (HITL)
D1,Real-time event timeline,Goal,v0
D2,Live pulse chart,Goal,v1 (human UX)
D3,Agent swim lanes,Goal,v1 (human UX)
D4,Filter panel,Goal,v0
D5,Chat transcript viewer,Non-goal,—
D6,Grafana dashboard,Non-goal,—
D7,Cost tracking,Non-goal,—
D8,Token tracking,Non-goal,—
D9,Hook performance profiling,Goal,v0
D10,Hook execution stats,Goal,v0
D11,Waterfall chart,Goal,v1 (human UX)
E1,Slack alerts,Non-goal,—
E2,Desktop notifications (toggleable),Goal,v1 (human UX)
E3,TTS announcements,Non-goal,—
E4,LLM completion messages,Non-goal,—
E5,Agent naming via LLM,Non-goal,—
E6,Toast notifications (in web UI),Goal,v1 (human UX)
F1,Interactive approvals,Goal,v2 (HITL)
F2,Question/permission/choice types,Goal,v2 (HITL)
F3,Response routing,Goal,v2 (HITL)
G1,Codebase map injection,Non-goal,—
G2,Thinking level injection,Non-goal,—
G3,Self-review on stop,Non-goal,—
G4,Git auto-stash checkpoints,Non-goal,—
G5,Auto-stage modified files,Non-goal,—
G6,Context injection,Non-goal,—
G7,Infinite mode,Non-goal,—
G8,Stop commands,Non-goal,—
G9,Session auto-naming (cwd + first prompt),Goal,v0
G10,Slash commands,Non-goal,—
G11,Transcript backup,Non-goal,—
G12,Run tracking,Goal,v0
G13,Session renaming (web UI edit),Goal,v1 (human UX)
H1,claude plugin install,Goal,v0
H2,Clean uninstall,Goal,v0
H3,CLAUDE_PLUGIN_ROOT env var,Goal,v0
I1,Proxy-based interception,Non-goal,—
I2,OAuth passthrough,Non-goal,—
I3,Multi-backend routing,Non-goal,—
I4,Built-in OTEL telemetry,Non-goal,—
I5,Session reconstruction,Non-goal,—
I6,Span duplication analysis,Non-goal,—
I7,Privacy controls,Non-goal,—
```

### Non-goal rationale

Features excluded for a stated reason — not because they lack value, but because
they conflict with hookwatch's design constraints or belong in a separate tool.

```csv
Category,Reason
A3 Matcher patterns,"Users filter at query time (SQL), not capture time. Filtering at capture = data loss."
B1 JSONL,"SQLite (bun:sqlite built-in) is better for querying and agent consumption."
B3/B4 Split files/dirs,"Fragments data across files. Daily SQLite keeps everything together."
B5 OTEL export,TBD — tracked for later evaluation.
B6 Promoted fields,"Subsumed by SQLite columns — tool_name, session_id are indexed columns."
C6 Input modification,"Rewrites tool inputs silently. Intervention, not observation."
D5 Chat transcript,"transcript_path is logged. Users open the file directly."
D6 Grafana,"Separate install, designed for infra monitoring. Our web UI is simpler."
D7/D8 Cost/token tracking,"No cost or token data in hook stdin payloads. Only available at API level."
E1 Slack,"Requires API keys, webhook URLs, network calls."
E3 TTS,"Requires external APIs (ElevenLabs, OpenAI) or platform-specific engines."
E4/E5 LLM features,"Requires API keys and network calls. Conflicts with offline goal."
G1-G8 Context/workflow,"Modify agent behavior rather than observe it. Separate concern."
G10 Slash commands,"Web UI and CLI serve the same purpose."
G11 Transcript backup,"Not hookwatch's responsibility."
I1-I7 API-level,"Fundamentally different approach (proxy/OTEL). Not hook-based."
```

## Functional Requirements

### FR-1: Event Capture

hookwatch handles all 18 confirmed Claude Code hook event types. Every event's
full stdin payload (common fields + event-specific fields) is captured. The
complete schema is documented in `./hook-stdin-schema.md`.

All matcher target fields (tool_name, source, reason, notification_type,
agent_type, trigger) are included in the stdin payload — no data is hidden
behind the matcher. hookwatch registers `".*"` (regex: match everything) for
all matchers so every event fires.

The handler must be resilient to unknown event types: log them with a generic
schema rather than crashing. This ensures forward compatibility when Claude Code
adds new events.

**Event type discovery:** hooks.json requires explicit registration per event
type. During implementation, attempt a wildcard catch-all key (`"*"`) in
hooks.json to auto-capture future event types. If the plugin system does not
support wildcards, register all known types explicitly and document that users
should file an issue when new Claude Code event types appear and hookwatch
misses them. Silent event loss is unacceptable.

### FR-2: SQLite Storage

Events are stored in a local SQLite database using `bun:sqlite` (built-in, zero
dependencies). WAL mode for concurrent read/write.

```text
~/.local/share/hookwatch/hookwatch.db    ($XDG_DATA_HOME/hookwatch/hookwatch.db)
```

Key columns are indexed for fast querying:

```csv
Column,Type,Description
id,INTEGER PRIMARY KEY,Auto-incrementing event ID
ts,TEXT,ISO 8601 timestamp (generated at write time)
event,TEXT,Hook event type (e.g. PreToolUse)
session_id,TEXT,From hook stdin
cwd,TEXT,Working directory at time of event
tool_name,TEXT,"Tool name for tool events, NULL otherwise"
session_name,TEXT,Human-readable session name
payload,TEXT,Full event JSON from stdin
hook_duration_ms,INTEGER,hookwatch handler execution time in milliseconds (always NULL — not yet populated by ingest.ts; see ch-95ia)
```

Indexed on: `event`, `session_id`, `ts`, `tool_name`.

### FR-3: Plugin System

hookwatch ships as a Claude Code plugin with this structure:

```text
.claude-plugin/
  plugin.json          — plugin manifest
hooks/
  hooks.json           — hook registration (all event types)
  handler.ts           — single entry point for all events
```

**plugin.json** follows the format established by DazzleML/claude-session-logger:

```json
{
  "name": "hookwatch",
  "version": "0.1.0",
  "description": "Hook event logger for Claude Code",
  "author": { "name": "PabloLION" },
  "repository": "https://github.com/PabloLION/claude-hookwatch",
  "license": "MIT"
}
```

**hooks.json** registers a single handler command for every event type using
`${CLAUDE_PLUGIN_ROOT}` for portable paths:

```json
{
  "hooks": {
    "PreToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "bun run ${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts" }] }],
    "PostToolUse": [{ "matcher": ".*", "hooks": [{ "type": "command", "command": "bun run ${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts" }] }]
  }
}
```

(Abbreviated — all 18 event types follow the same pattern.)

### FR-4: Web UI (v0: basic, v1: polished)

hookwatch serves a local web UI for browsing and querying events. Built with
**Preact + htm** — tagged template literals (no JSX transform), ~4KB runtime,
no build step required (Bun runs `.ts` directly).

**v0 features:**

- Real-time event timeline (D1) — scrollable list of events as they arrive
- Filter panel (D4) — filter by session, event type, tool name, time range
- Hook execution stats (D10) — count, success rate, avg duration per event type
- Hook performance profiling (D9) — duration per hook invocation

**v1 features (human UX polish):**

- Waterfall chart (D11) — Chrome DevTools Network panel style: horizontal bars
  showing tool/subagent execution timing
- Agent swim lanes (D3) — side-by-side multi-agent timeline comparison
- Live pulse chart (D2) — activity density over time
- Session renaming (G13) — edit session names via the UI
- Toast notifications (E6) — in-app alerts for new events
- Desktop notifications (E2) — native OS notifications (toggleable)

### FR-5: HITL (v2)

HITL enables the hook to pause execution and ask the user a question before
proceeding. Three interaction types:

```csv
Type,Input,Output
permission,"Yes/No question (e.g., ""Delete production database?"")",Boolean (approve/deny)
question,Free-text prompt,User-typed string
choice,"List of options (e.g., [""skip"", ""retry"", ""abort""])",Selected option
```

HITL is triggered by specific event conditions (configurable). When triggered:

1. The hook presents the question to the user through the web UI
2. The hook blocks until the user responds or a timeout expires
3. The response determines the hook's exit behavior (exit 0 to proceed, exit 2
   to deny, or JSON output with the response)

HITL enables the v2 guardrail features: C1 (block dangerous commands), C2
(protect secrets), C3 (file scope), C7 (path traversal), C8 (bash pipeline
detection), C13 (exfiltration detection).

### FR-6: Stdin Validation (Zod)

The handler validates every stdin payload against Zod schemas before logging.
TypeScript interfaces and Zod schemas are generated from the hook stdin
reference (`./hook-stdin-schema.md`).

- One Zod schema per event type (e.g. `PreToolUseSchema`, `SessionStartSchema`)
- One discriminated union over all event types (`HookEventSchema`)
- Common fields validated on every event
- Unknown event types pass through a fallback schema (common fields only +
  passthrough for the rest) — never rejected
- Validation errors are logged locally, not thrown — the hook must never crash

This ensures hookwatch detects upstream schema changes early and logs structured,
type-safe data.

**Note on dependencies:** Zod is a runtime dependency. This is an exception to
the minimal-dependency goal, justified by: Zod is small (~50KB), has zero
transitive dependencies, and provides critical correctness guarantees for the
core logging pipeline.

### FR-7: Session Naming

Sessions are auto-named and stored in SQLite.

- **SessionStart** — assign initial name from `cwd` (last path segment, e.g.
  `claude-hookwatch`)
- **First UserPromptSubmit** — update name by appending a truncated summary of
  the prompt (e.g. `claude-hookwatch: Write design doc`)
- **Web UI (v1)** — editable via the session renaming feature (G13)
- **Naming rule** — configurable in config (default: folder name + first prompt)

Auto-naming happens once (on SessionStart + first prompt). The stored name
persists in SQLite.

### FR-8: Run Tracking

Track session lifecycle events. SessionStart provides `source` field
(`startup`, `resume`, `clear`, `compact`), enabling run counting within a
session. Each SessionStart increments a run counter for that session_id.

### FR-9: Configuration

Minimal configuration via a single TOML file:

```text
~/.config/hookwatch/config.toml    ($XDG_CONFIG_HOME/hookwatch/config.toml)
```

```toml
# Database location (default: ~/.local/share/hookwatch/hookwatch.db)
db_path = "~/.local/share/hookwatch/hookwatch.db"

[notifications]
desktop = false  # v1: native OS notifications

[hitl]
enabled = false  # v2: human-in-the-loop
timeout = 300    # seconds to wait for user response

[session_naming]
include_first_prompt = true
max_length = 60

[retention]
# v1: log retention with high/low water mark
# Both rules are active — either one triggers cleanup
max_age_days = 365       # delete events older than this
max_size_mb = 1024       # high-water mark: trigger cleanup above this
target_size_mb = 819     # low-water mark: trim down to this (~80% of max)
```

Defaults are sensible — hookwatch works with zero configuration. The config
file is optional.

**TOML rationale:** Supports comments (JSON does not), human-readable, widely
understood. TOML parsing may require a small library (e.g. `smol-toml`, ~15KB)
if Bun does not support native TOML imports — verify during implementation.

### FR-10: Log Retention (v1)

Configurable data cleanup using a high-water / low-water mark pattern.

- **Trigger:** SessionStart hook — runs once per session, before any work
- **Rules:** Both `max_age_days` and `max_size_mb` are active. Either condition
  triggers cleanup independently
- **Age cleanup:** `DELETE FROM events WHERE ts < datetime('now', '-N days')`
- **Size cleanup:** When DB exceeds `max_size_mb` (high-water mark), delete
  oldest events until size drops below `target_size_mb` (low-water mark, default
  80% of max). This margin prevents re-triggering every session
- **Post-cleanup:** Run SQLite `VACUUM` to reclaim disk space (rebuilds the
  database file to match actual data size)
- **Logging:** Cleanup is logged silently as a hookwatch internal event (not
  surfaced to the user). Users can query cleanup history from the database
- **Default (v1):** 365 days / 1024 MB / 819 MB target. v0 keeps everything

## Non-Functional Requirements

### NFR-1: Performance

- Hook execution must complete in <100ms for non-HITL events (measured from
  process start to exit)
- HITL events are inherently blocking (waiting for human input) and are exempt
  from this target
- SQLite uses WAL mode — no blocking on concurrent reads
- Single process per hook invocation (no child processes for logging)

### NFR-2: Security

- Hook handler makes no network calls
- Web UI binds to localhost only — not accessible from other machines
- Database file readable only by the owning user (file permissions 0600)
- Event payloads are logged as-is — hookwatch does not inject, modify, or
  filter payload content. Sensitive data filtering is Claude Code's
  responsibility.
- No secrets stored — no API keys, no tokens, no credentials
- **Parameterized SQL only** — never concatenate user data into SQL strings.
  All values passed to SQLite must use `?` placeholders via `bun:sqlite`
  parameterized queries. Prevents SQL injection.
- **No innerHTML** — never use `innerHTML`, `outerHTML`, or
  `dangerouslySetInnerHTML`. htm tagged template literals auto-escape all
  interpolated values. Enforced by Biome rule `noDangerouslySetInnerHtml:
  error`. Prevents XSS.

### NFR-3: Compatibility

- **Required runtime:** Bun (version TBD — target latest stable)
- **Platforms:** macOS and Linux (Claude Code's primary platforms)
- **Windows:** Not a v0 target. May work if Bun supports it, but untested.
- **Plugin system:** Compatible with `claude plugin install` / `claude plugin
  remove` as documented by Claude Code

### NFR-4: Reliability

- A hook crash must never break Claude Code's workflow — all hook errors are
  caught and logged locally, exit code 0 returned
- Disk full or permission errors during writes are caught and silently
  skipped (the hook must not block the agent)
- SQLite WAL mode tolerates crashes — incomplete transactions are rolled back
  on next open

### NFR-5: Maintainability

- TypeScript with Bun — type safety without a build step
- Single handler file — one entry point for all event types, branching
  internally by `hook_event_name`
- No transpilation, no bundling — Bun runs `.ts` directly

## Key Decisions

Decisions made during the research phase. These are final unless revisited
explicitly.

```csv
Decision,Rationale,Alternatives Considered
Bun/TypeScript (no Python),"User requirement. Eliminates Python/uv dependency. Bun runs TS natively, fast startup, built-in SQLite.","Python (used by 5/10 upstream tools), Node.js, Rust"
SQLite over JSONL,"bun:sqlite is built-in (zero deps). SQL queries for time range, event type, aggregation. Better for agent consumption — precise queries, bounded results.","JSONL (greppable but requires full scan), OTEL backends, per-event files"
Web UI included,"Local web server for browsing events. Enables v1 UX polish and v2 HITL response routing through the UI.","No server (CLI only), Grafana (separate install)"
HITL included (v2),"User requirement. PreToolUse blocking decisions add meaningful safety. Web UI provides the response routing mechanism.","Logging-only (no blocking), platform-native dialogs"
Plugin compliant,"User requirement. One-command install/uninstall. Only DazzleML has done this; hookwatch extends it to full event coverage.","Manual settings.json editing (used by 7/10 upstream tools)"
Single handler,"One handler.ts for all events. Simpler than 18 separate scripts (observability has 26). Event routing via payload inspection.","Per-event scripts (observability), per-category handlers"
Zod validation,"Runtime validation of stdin payloads. Detects upstream schema changes. Only runtime dependency (justified by correctness guarantees).","Hand-written validators, no validation (trust stdin)"
Bun runtime (not standalone),"Users already need Bun for bun:sqlite. Small TS files over ~80MB binary. Plugin updates are file changes, no recompilation. Easy to switch later via bun build --compile.","Standalone binary (eliminates runtime dep but large)"
TOML config,"Supports comments (JSON does not). Human-readable. May need smol-toml (~15KB) if Bun lacks native TOML imports.","JSON (no comments), YAML (verbose)"
Preact + htm for web UI,"Tagged template literals — no JSX transform or build step. ~4KB runtime. Fits Bun-native no-transpilation goal.","Svelte (requires build step — conflicts with NFR-5), Vanilla HTML/JS (harder to maintain), React (heavier)"
Log retention (v1),"High/low water mark pattern. Checked at SessionStart (once per session). Both age and size limits active. Margin prevents re-triggering.","No retention (user responsibility), PreCompact trigger (adds latency during active work)"
```

## Open Questions

None — all initial questions resolved. See Key Decisions for rationale.

## Tracked Issues

```csv
ID,Title,Category
claude-hookwatch-fgm,Write hookwatch design doc,This document
claude-hookwatch-0rm,Evaluate OTEL backend export (B5),TBD
claude-hookwatch-r2z,Evaluate agent-scoped guardrail rules (C4),TBD
claude-hookwatch-cme,Evaluate quality gates (C12),TBD
claude-hookwatch-bgr,Update hook-json-schema.md in agent-console-dashboard,Docs
claude-hookwatch-9d5,Interesting features for other projects,Research
```

## Prior Art

Detailed comparison of all 10 upstream tools is in
`.git-ignored/notes/upstream-feature-catalog.md`. Summary of positioning:

```csv
Tool,Events,Plugin,Server,Language
hookwatch (this project),18,yes,yes (local),Bun/TypeScript
DazzleML/claude-session-logger,2,yes,no,Python
disler/observability,12,no,yes,Python + Bun
connerohnesorge/conclaude,18,no,no,Rust
karanb192/claude-code-hooks,12,no,no,Node.js
carlrannaberg/claudekit,12,no,no,Node.js
MacFall7/M87-Spine-lite,8,no,no,Python
TechNickAI/claude_telemetry,6,no,no,Python
ColeMurray/claude-code-otel,0 (built-in),no,yes,Docker
Teraflop-Inc/dev-agent-lens,0 (proxy),no,yes,Docker
```

hookwatch is the only tool targeting full event coverage + plugin compliance +
local web UI.
