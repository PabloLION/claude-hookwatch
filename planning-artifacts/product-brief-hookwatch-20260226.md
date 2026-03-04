---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - docs/design.md
  - docs/hook-stdin-schema.md
  - README.md
  - AGENTS.md
date: 20260226
author: pablo
---

# Product Brief: hookwatch

## Executive Summary

hookwatch is a Claude Code plugin that lets developers see what their agent did,
debug their hooks, and query their sessions. It captures all 18 hook event types,
stores them in a local SQLite database, and provides three interfaces: a web UI
for visual browsing, direct SQL for power users, and Claude Code skills for
agent-queryable access.

Zero config to start — install the plugin, open the browser. One command in, one
command out.

---

## Core Vision

### Problem Statement

Claude Code's hook system fires events for every meaningful agent action — tool
calls, session lifecycle, subagent spawning, permissions — but provides no
built-in way to see what happened. Developers have no dashboard, no event log,
no way to answer "what did the agent do in that session?" without reading raw
transcript files.

### Problem Impact

Without visibility, developers are working blind:

- No way to audit which tools were called or what inputs they received
- No way to compare behavior across sessions
- No way to spot patterns (which tools are used most, which events fire)
- Debugging custom hooks requires manual stderr inspection — no structured view
  of stdin, stdout, or stderr

### Why Existing Solutions Fall Short

10 upstream tools address parts of this problem, but none combine all three
requirements:

- Full event coverage — most tools cover 2-12 of 18 event types
- Plugin compliance — only one tool (claude-session-logger) supports
  `claude plugin install`, covering just 2 events
- Local web UI — only one tool (observability) has a web UI, but requires manual
  server startup and covers 12 events

No existing tool delivers full coverage + easy install + visual browsing.

### Proposed Solution

hookwatch registers a single handler for all 18 event types. Every event's full
stdin payload is validated with Zod and stored in SQLite (bun:sqlite, zero
external dependencies). A persistent Bun daemon manages the database, serves
the web UI, and handles the wrap CLI.

Architecture:

- **hookwatch-core** — persistent Bun daemon (SQLite + web UI + wrap CLI),
  auto-started by the first hook invocation, self-terminates after idle timeout
- **hookwatch-hooks** (plugin, v0) — event capture, sends events to daemon
- **hookwatch-skills** (plugin, v1) — agent-queryable skills for querying data

Three interfaces:

- **Web UI** (humans) — real-time event browsing, point-and-click filtering
- **SQLite** (power users) — direct SQL queries for custom analysis
- **Skills** (agents) — Claude Code skills shipped with the plugin for agent
  access to hookwatch data

Key constraints: hook handler completes in <100ms (amortized, with warm daemon),
never crashes, never blocks the agent.

### Key Differentiators

- **Only tool combining** all 18 event types + plugin compliance + local web UI
- **Zero-config** — works immediately after `claude plugin install`
- **hookwatch wrap** (v1) — tee-like CLI that captures stdin/stdout/stderr of
  any command, viewable in the web UI for hook debugging
- **Forward-compatible** — unknown event types logged gracefully, never rejected
- **Two-plugin architecture** — install only what you need (hooks, skills, or both)

---

## Target Users

### Primary: Claude Code Developer

Covers two use cases — **session reviewers** who want to see what the agent did,
and **hook authors** who are writing or debugging custom hooks. Same person,
different moments.

- **Motivation**: visibility into agent behavior, hook debugging, session audit
- **Current workaround**: grepping stderr, reading raw transcript files, guessing
- **Interfaces used**: web UI (both), `hookwatch wrap` + SQLite (hook authors)

**User Journey:**

1. **Discovery** — developer hits a problem ("what did the agent do?" or "why
   isn't my hook firing?"), finds hookwatch on GitHub
2. **Onboarding** — `claude plugin install hookwatch-hooks`. Zero config. First
   hook event auto-starts the daemon
3. **First value** — open browser, see real event data. Under 60 seconds from
   install to "aha"
4. **Deepening** — hook author uses `hookwatch wrap` to debug specific commands,
   power user opens SQLite for custom queries
5. **Routine** — web UI becomes the default way to check session activity.
   `hookwatch open` (v0) for manual access to browse old data without waiting
   for a hook to fire

**Success moment**: seeing real event data in the browser within 60 seconds of
install.

### Secondary: Agent Consumer (v1)

Agents that query hookwatch data programmatically via hookwatch-skills. Not a
human user — a Claude Code skill that asks "what tools were called in session X?"

- **Motivation**: programmatic access to session and event data
- **Journey**: skill author integrates hookwatch query skills into their workflows
- **Success moment**: agent answers questions about past sessions using hookwatch
  data

---

## Success Metrics

### User Success

- **Time to first value** — events visible in browser within 60 seconds of
  plugin install (directional, no hard target yet)
- **Handler latency** — hook handler completes in <100ms amortized with warm
  daemon. Measures our handler execution time, not Claude Code's tool duration
- **Event completeness** — all 18 event types captured, zero data loss
- **Zero crashes** — handler never blocks or crashes the agent

### Project Success

- **Plugin compliance** — installs and uninstalls cleanly via
  `claude plugin install/uninstall`
- **Adoption signals** — GitHub stars, installs, issues filed (directional)
- **Promotion strategy** — deferred to v1 completion (ch-9yk)

### Deferred (v3)

- Specific numeric targets for all metrics above
- Metrics for `hookwatch wrap` and skills interfaces

---

## MVP Scope

### v0 — Core Features

- Single handler for all 18 event types (`handler.ts`)
- Zod validation of every stdin payload
- SQLite storage via `bun:sqlite` (WAL mode)
- Persistent Bun daemon — auto-started by first hook, idle timeout
- Web UI — Preact + htm, minimal event browsing + session filtering
- `hookwatch open` — manual daemon start + open browser
- `hookwatch wrap` — tee-like CLI for stdin/stdout/stderr capture
- hookwatch-hooks plugin — `claude plugin install` compliant
- Forward-compatible — unknown events logged, never rejected

### v0 Success Gate

Install → see events → filter by session works end-to-end.

### v1

- hookwatch-skills plugin — agent-queryable skills
- Web UI enhancements — charts, timelines, network-panel-style request viewer

### v2

- Promotion/discovery strategy (ch-9yk)

### v3

- Specific numeric metric targets
- Wrap/skills metrics

### Out of Scope (not hookwatch)

- Guardrails — separate project
- Claude Code internal tool duration tracking
- PTY emulation for wrap — simple pipes only
