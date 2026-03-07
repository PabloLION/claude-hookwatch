---
stepsCompleted: [step-01-init, step-02-discovery, step-02b-vision, step-02c-executive-summary, step-03-success, step-04-journeys, step-05-domain, step-06-innovation, step-07-project-type, step-08-scoping, step-09-functional, step-10-nonfunctional, step-11-polish]
classification:
  projectType: developer_tool
  domain: general
  complexity: low
  projectContext: greenfield
inputDocuments:
  - planning-artifacts/product-brief-hookwatch-20260226.md
  - docs/design.md
  - docs/hook-stdin-schema.md
  - .git-ignored/notes/upstream-feature-catalog.md
  - .git-ignored/notes/mastery-vs-observability.md
  - .git-ignored/notes/observability-repo-analysis.md
  - .git-ignored/notes/mastery-repo-analysis.md
  - .git-ignored/notes/hooks-json-matcher-syntax.md
  - .git-ignored/notes/mastery-tts-llm-dataflow.md
documentCounts:
  briefs: 1
  research: 6
  projectDocs: 2
  projectContext: 0
workflowType: 'prd'
---

# Product Requirements Document - hookwatch

**Author:** pablo
**Date:** 20260303

## Executive Summary

hookwatch is a Claude Code plugin that lets developers see what their agent did,
debug their hooks, and query their sessions. Install the plugin, open the
browser, see real data — zero config. Backed by a local SQLite database and a
web UI for browsing and filtering events, with full coverage of all 18 hook
event types.

The hook system fires events for every meaningful agent action — tool calls,
session lifecycle, subagent spawning, permissions — but provides no built-in way
to see what happened. Developers currently work blind: no event log, no session
audit, no structured view of hook I/O. hookwatch fills this gap.

Two user modes, one persona: **session reviewers** who want to see what the
agent did, and **hook authors** who are writing or debugging custom hooks. Same
developer, different moments. A secondary audience (v1) is **agent consumers** —
Claude Code skills that query hookwatch data programmatically.

### What Makes This Special

- **Zero-config** — first hook event auto-starts the Bun server. Under 60 seconds
  from install to seeing real data.
- **hookwatch wrap** — tee-like CLI that captures stdin/stdout/stderr of any
  command, viewable in the web UI for hook debugging.
- **Only tool combining** full 18-event coverage + `claude plugin install`
  compliance + local web UI. 10 upstream tools exist; none deliver all three.
- **Forward-compatible** — unknown event types logged gracefully, never rejected.
- **Two-plugin architecture** — hookwatch-hooks (event capture, v0) and
  hookwatch-skills (agent queries, v1) sharing one backend. Install only what
  you need.

## Project Classification

| Attribute | Value |
|-----------|-------|
| Project type | Developer tool |
| Domain | General |
| Complexity | Low |
| Project context | Greenfield |

## Success Criteria

### User Success

- **Time to first value** — events visible in browser within 60 seconds of
  `claude plugin install` (directional, no hard target yet)
- **Handler latency** — hook handler completes in <100ms amortized with warm Bun
  server. Measures our handler execution time, not Claude Code's tool duration
- **Event completeness** — all 18 event types captured, zero data loss
- **Zero crashes** — handler never blocks or crashes the agent

### Business Success

- **Plugin compliance** — installs and uninstalls cleanly via
  `claude plugin install/uninstall`
- **Adoption signals** — GitHub stars, installs, issues filed (directional)
- **Promotion strategy** — deferred to v2 (ch-9yk)

### Technical Success

- **SQLite WAL mode** — concurrent reads from web UI while handler writes
- **Bun server auto-start** — first hook invocation starts server transparently
- **Idle timeout** — Bun server self-terminates after inactivity, no resource leak
- **Forward compatibility** — unknown event types stored without error

### Measurable Outcomes

Specific numeric targets for all metrics deferred to v3. Current targets are
directional — good enough to guide implementation, refined after real usage data.

## User Journeys

### Journey 1: Session Reviewer — "What did the agent do?"

**Kai**, a backend developer, let Claude Code refactor his auth module for 20
minutes. He returns to a changed codebase with no trail.

- **Opening**: Modified files in git diff, but no idea which tools were called
  or in what order.
- **Rising action**: Opens hookwatch web UI, filters by session. Sees every tool
  call — Read, Edit, Bash, Grep — with full stdin payloads including file paths
  from `tool_input`.
- **Climax**: Spots that the agent ran `rm -rf test/fixtures/` in a Bash call.
  Tests pass, but the fixtures were shared with another project.
- **Resolution**: Restores from git. hookwatch becomes his first stop after
  unattended sessions.

**Capabilities**: event browsing, session filtering, tool call detail, stdin
payload with file paths.

### Journey 2: Hook Author — "Why isn't my hook firing?"

Same Kai, writing a hook to block `sudo` in Bash calls.

- **Opening**: Hook should block, but `sudo apt install` went through.
- **Rising action**: Wraps his hook with `hookwatch wrap`. Web UI shows his hook
  received the event but stderr has a JSON parse error.
- **Climax**: Wrap output reveals he read `input` instead of `tool_input`.
- **Resolution**: Fixes field name, hook blocks correctly.

**Capabilities**: `hookwatch wrap`, stdin/stdout/stderr capture, web UI I/O
viewer.

### Journey 3: Session Reviewer — Bun server not running

Kai wants to check yesterday's session. Server timed out overnight.

- **Opening**: Browser shows connection refused.
- **Rising action**: Runs `hookwatch open`. Bun server restarts, web UI loads.
- **Climax**: Yesterday's data intact — SQLite is the source of truth.
- **Resolution**: Browses yesterday's session.

**Capabilities**: `hookwatch open`, data persistence, idle timeout recovery.

### Journey 4: Agent Consumer (v1) — Skills Query

A Claude Code skill queries hookwatch: "What tools were called last session?"

- **Opening**: Skill invokes hookwatch query.
- **Rising action**: hookwatch-skills returns structured data — tool names,
  counts, timestamps.
- **Climax**: Agent detects 15 Write calls on test files, skips redundant test
  generation.
- **Resolution**: Agent adjusts plan based on historical data.

**Capabilities**: hookwatch-skills plugin, structured query, cross-session
context.

### Journey Requirements Summary

| Capability | Journeys | Version |
|-----------|----------|---------|
| Event browsing + session filtering | 1, 3 | v0 |
| Tool call detail + stdin payload | 1 | v0 |
| `hookwatch wrap` + I/O capture | 2 | v0 |
| `hookwatch open` + server restart | 3 | v0 |
| Data persistence (SQLite) | 3 | v0 |
| Skills query interface | 4 | v1 |
| Git-based file diff tracking | — | v2 (ch-tws) |
| Service worker + restart button | 3 | v1 (ch-xdu) |

## Domain-Specific Requirements

Domain: general, complexity: low. No regulatory or compliance requirements.
However, the following domain concerns were identified during exploration:

- **Data sensitivity** — hookwatch stores all hook stdin payloads in plaintext
  SQLite, including potential API keys, credentials, and secrets from
  `tool_input`. v0 mitigation: file permissions (`0600`) + documentation. v1:
  per-event-type filtering and field redaction in web UI (ch-x42, ch-e3k)
- **Plugin system instability** — Claude Code's plugin system has known issues
  (GitHub #28540, ch-i5i). hookwatch must handle plugin install/uninstall
  cleanly
- **Schema evolution** — hookwatch depends on Claude Code's hook stdin schema.
  Zod validation strategy: strict on known fields, permissive on unknown.
  Forward-compatible by design
- **Data growth** — SQLite files grow unbounded in v0. Retention policy needed
  for v1+

## Developer Tool Specific Requirements

### Runtime and Distribution

- **Runtime**: Bun only. Minimum + maximum version range (not pinned to exact
  version). Specific range determined during implementation
- **Installation**: `claude plugin install <git-url>` only in v0. Alternative
  install methods in v1 if plugin system issues persist (GitHub #28540)
- **No registry publishing** in v0 — distributed via git repository

### Interface Surface

- **v0 interfaces**: Web UI (event browsing, session filtering) + CLI
  (`hookwatch open`, `hookwatch wrap`, `hookwatch --help`)
- **v1 interfaces**: hookwatch-skills plugin (agent-queryable API) + docs site
- **No programmatic API in v0** — skills provide agent access in v1

### Documentation

- **v0**: README + `hookwatch --help` inline help
- **v1**: Separate documentation site. Significant v1 effort dedicated to
  documentation (usage guides, hook event reference, query examples)

### Skip Sections

Per developer tool profile: visual design and store compliance not applicable.

## Project Scoping and Phased Development

### MVP Strategy

**MVP Approach:** Problem-solving MVP — deliver the minimum that makes
developers say "I can see what the agent did." No polish, no advanced features,
just: install → events appear → filter by session.

**Resource:** Solo developer. Bun runtime, no external dependencies beyond
`bun:sqlite` and Zod.

### MVP Feature Set (v0)

**Core journeys supported:** Journey 1 (session review), Journey 2 (hook
debugging), Journey 3 (offline recovery).

**Must-have capabilities:**

- Hook handler capturing all 18 event types
- Zod validation (strict known fields, permissive unknown)
- SQLite storage (WAL mode)
- Bun server (auto-start on first hook, idle timeout)
- Web UI (event list + session filter, Preact + htm)
- `hookwatch open` (manual server start + browser)
- `hookwatch wrap` (stdin/stdout/stderr capture)
- Plugin compliance (`claude plugin install`)
- Data sensitivity docs + file permissions (ch-6cl)

**Without these, hookwatch fails:** handler, SQLite, web UI, plugin install.
Everything else enhances but isn't strictly required for "I can see events."

### Post-MVP Features

**v1 (Growth):**

- hookwatch-skills plugin (Journey 4: agent queries)
- Web UI enhancements (charts, timelines, network-panel viewer)
- Service worker + restart button (ch-xdu)
- Event filtering and field redaction (ch-x42)
- Setup wizard (ch-e3k)
- Documentation site
- Alternative install methods if plugin system issues persist
- Hook stdout context injection (ch-9xg)

**v2 (Expansion):**

- Promotion/discovery strategy (ch-9yk)
- Git-based file change tracking per tool call (ch-tws)

**v3 (Maturity):**

- Specific numeric metric targets
- Wrap/skills metrics

### Risk Mitigation Strategy

**Technical risks:**

- Bun cold start may exceed 100ms — benchmark early (ch-3h4). If too slow,
  Bun server architecture absorbs it
- Plugin system instability (GitHub #28540) — prepare alternative install
  method as fallback
- Schema evolution — forward-compatible Zod validation handles unknown fields

**Market risks:**

- Small addressable market (Claude Code developers who write hooks). Mitigated
  by zero-config appeal to broader session reviewer audience
- Claude Code could ship built-in observability — move fast, build community

**Resource risks:**

- Solo developer — scope deliberately small (~10 source files, no build step,
  no external deps). v0 is sized for one person
- If blocked on plugin system issues, fallback to manual hook registration in
  `~/.claude/settings.json`. Plugin system is convenience, not hard dependency

## Functional Requirements

### Event Capture

- **FR1**: Handler can receive and process all 18 Claude Code hook event types
- **FR2**: Handler can validate each event's stdin payload against a schema
- **FR3**: Handler can accept and store unknown/future event types without error
- **FR4**: Handler can send captured events to the Bun server for storage
- **FR5**: Handler can complete processing without blocking the Claude Code agent

### Data Storage

- **FR6**: System can store validated event data in a local SQLite database
- **FR7**: System can support concurrent reads and writes to the database
- **FR8**: System can persist data across Bun server restarts
- **FR9**: System can create the database file with owner-only permissions

### Web UI

- **FR10**: Developer can view a chronological list of hook events
- **FR11**: Developer can filter events by session ID
- **FR12**: Developer can view the full stdin payload of any event
- **FR13**: Developer can view tool name and tool input for tool-related events
- **FR14**: Developer can view wrap command I/O (stdin/stdout/stderr) captured
  by `hookwatch wrap`

### CLI — hookwatch open

- **FR15**: Developer can manually start the Bun server via `hookwatch open`
- **FR16**: Developer can open the web UI in their default browser via
  `hookwatch open`

### CLI — hookwatch wrap

- **FR17**: Developer can wrap any command to capture its stdin, stdout, and
  stderr
- **FR18**: System can forward captured I/O to the Bun server for storage
- **FR19**: System can forward wrapped command's I/O to original destinations
  (passthrough)

### Bun Server

- **FR20**: Handler can auto-start the Bun server on first hook invocation if
  not running
- **FR21**: Bun server can self-terminate after a configurable idle timeout
- **FR22**: Bun server can serve the web UI over HTTP on localhost
- **FR23**: Bun server can accept events from the hook handler

### Plugin System

- **FR24**: Developer can install hookwatch-hooks via `claude plugin install`
- **FR25**: Developer can uninstall hookwatch-hooks cleanly with no leftover
  files
- **FR26**: Plugin can register hook handlers for all 18 event types via
  hooks.json

### Context Injection

- **FR27**: Handler can output system messages to Claude Code via hook stdout
- **FR28**: Each injected message can identify its source hook and event type

## Non-Functional Requirements

### Performance

- **NFR1**: Hook handler completes in <100ms amortized with warm Bun server
- **NFR2**: Hook handler cold path (Bun server not running) completes auto-start
  + event delivery without blocking the agent
- **NFR3**: Web UI renders event list without perceptible delay for up to 10,000
  events
- **NFR4**: No transpilation or build step in the hook handler path

### Reliability

- **NFR5**: Hook handler never crashes — all errors caught and logged, never
  propagated to Claude Code
- **NFR6**: Hook handler never blocks — if Bun server is unreachable, event is
  dropped silently (no retry loop)
- **NFR7**: Zero data loss under normal operation (Bun server running, disk
  available)
- **NFR8**: Bun server recovers gracefully from unexpected termination — no
  corrupted database (SQLite WAL mode)

### Security

- **NFR9**: Database file created with `0600` permissions (owner read/write
  only)
- **NFR10**: Bun server listens on localhost only — no network exposure
- **NFR11**: No secrets or credentials in hookwatch's own configuration or logs

### Integration

- **NFR12**: Forward-compatible with Claude Code hook stdin schema changes —
  unknown fields preserved, never rejected
- **NFR13**: Plugin installs and uninstalls cleanly via `claude plugin
  install/uninstall` with no leftover files or broken hooks
- **NFR14**: No external runtime dependencies beyond Bun (no npm install, no
  Python, no native modules)
