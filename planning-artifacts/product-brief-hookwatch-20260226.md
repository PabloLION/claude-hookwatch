---
stepsCompleted: [1, 2]
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
