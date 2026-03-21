---
layout: home

hero:
  name: hookwatch
  text: See what Claude did
  tagline: Debug your hooks, query your sessions — a Claude Code plugin that captures all 18 hook event types to local SQLite with a web UI.
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/quick-start
    - theme: alt
      text: Hook Events Reference
      link: /reference/hook-events

features:
  - title: 18 Hook Events
    details: PreToolUse, PostToolUse, SessionStart, Stop, and 14 more — every event Claude Code emits, captured and stored.
  - title: Local Web UI
    details: Real-time event timeline with session filter, event detail viewer, and wrap mode visualization. SSE live updates.
  - title: SQLite Storage
    details: bun:sqlite with WAL mode. Fast queries, zero external deps. Full event payloads preserved.
  - title: Zod Validation
    details: All 18 stdin payloads validated at runtime. Schema mismatches logged, never silently dropped.
  - title: Wrap Mode
    details: Wrap any command to capture its stdin/stdout/stderr alongside the hook event. Transparent proxy — no behavior changes.
  - title: Offline-First
    details: Localhost only. No network calls, no accounts, no config files required. Install and browse.
---
