# Story 2.3: Event Detail & Tool Input View

Status: ready-for-dev

## Story

As a Claude Code developer,
I want to expand any event to see its full stdin payload and tool input,
so that I can understand exactly what data the agent sent.

## Acceptance Criteria

1. **Given** the event list is displayed, **when** a developer clicks on an
   event row, **then** it expands to show the full stdin JSON payload, formatted
   and syntax-highlighted.

2. **Given** the expanded event is a tool-related event (e.g., `PreToolUse`),
   **when** the detail view renders, **then** `tool_name` and `tool_input` are
   displayed prominently above the raw payload.

3. **Given** the event detail is open, **when** the developer clicks the event
   row again, **then** the detail collapses.

## Tasks / Subtasks

- [ ] Create `src/ui/events/event-detail.ts` — Preact component that receives an event object and renders the expanded detail view (AC: #1, #2)
- [ ] Implement JSON formatting — use `JSON.stringify(payload, null, 2)` rendered inside `<pre><code>` tags for formatted display (AC: #1)
- [ ] Implement tool-related event detection — check if `event` field is one of: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest` (AC: #2)
- [ ] Render tool info header — when event is tool-related, display `tool_name` and `tool_input` prominently above the raw payload using semantic HTML (e.g., `<dl>` definition list) (AC: #2)
- [ ] Add expand/collapse signal per event row — toggle a per-row `expandedEventId` signal in event-list or a local signal in the row component (AC: #1, #3)
- [ ] Update `src/ui/events/event-list.ts` — make each row clickable, toggle expansion, render `event-detail.ts` when expanded (AC: #1, #3)
- [ ] Ensure JSON content is rendered as text content (not HTML) — use Preact's text interpolation, NEVER `innerHTML` (AC: #1)
- [ ] Write Playwright integration test — verify clicking row expands detail, payload is formatted JSON, tool-related events show tool_name and tool_input, clicking again collapses (AC: #1, #2, #3)

## Dev Notes

### Preact + htm Import

All UI components use Preact + htm loaded from ESM CDN — no build step, no JSX.
Use this exact import at the top of every UI file:

```ts
import { html, render, useState, useEffect } from 'https://esm.sh/htm/preact/standalone';
```

For shared state (signals), import from the same bundle:

```ts
import { signal, computed } from 'https://esm.sh/@preact/signals';
```

Never import from npm package paths or use JSX syntax. htm template literals
(`html\`...\``) replace JSX throughout.

### Payload Fetch Strategy

The events list response from `POST /api/query` includes the full `payload`
field for every event — no second request needed. This avoids extra round-trips
and keeps the detail view instant.

- The `payload` column is stored as TEXT (full stdin JSON string) in SQLite
- The query endpoint returns it as a string in the JSON response
- Parse it client-side with `JSON.parse(event.payload)` before display
- Do not implement a `GET /api/events/:id` endpoint for v0

### JSON Display

- Format: `JSON.stringify(JSON.parse(event.payload), null, 2)` inside a `<pre><code>` block
- Pico CSS auto-styles `<code>` blocks — no external syntax highlighter in v0
- Syntax highlighting is minimal — monospace font with Pico's code styling is sufficient
- Render formatted JSON as a text node inside `<pre>` — never set it via innerHTML

### Tool-Related Events

Tool-related event types that have `tool_name` and `tool_input` fields:

```text
PreToolUse
PostToolUse
PostToolUseFailure
PermissionRequest
```

- Extract `tool_name` and `tool_input` from the parsed payload JSON
- Display in a definition list (`<dl><dt>Tool</dt><dd>tool_name</dd>...`) above the raw payload
- Non-tool events (e.g., `SessionStart`, `Stop`) show only the raw payload

`tool_input` is an object — render it as a nested JSON block:
`JSON.stringify(payload.tool_input, null, 2)` inside its own `<pre><code>` block.

### PermissionRequest: tool_use_id Handling

`PermissionRequest` is the only tool-related event that does **not** include
`tool_use_id` (see `./docs/hook-stdin-schema.md`). Render it defensively:

- If `tool_use_id` is present in the parsed payload: display as a linkable
  reference in the tool info header (e.g., `<code>toolu_01ABC123...</code>`)
- If absent (as is always the case for `PermissionRequest`): display `N/A`

This makes the absence explicit instead of rendering an empty or undefined value.

### Signal Ownership

`expandedEventIds` is a local signal owned by `event-list.ts`. It does not
belong in `app.ts` — it is UI interaction state, not shared application state.

The `selectedEvent` signal (the currently clicked event object, if needed by
other components) should also be owned by `event-list.ts` and passed down as a
prop. `app.ts` owns only signals that multiple sibling components consume
(e.g., `activeSession`, `eventList`).

### Expand/Collapse

- Allow multiple sections open simultaneously (not exclusive accordion) — simpler
  to implement and better UX when comparing fields across events
- Track expanded state via a `Set<string>` held in a Preact signal
  (e.g., `expandedEventIds` signal in `event-list.ts`):
  - Click on a collapsed row: add its ID to the set
  - Click on an expanded row: remove its ID from the set
- This is a multi-expand model — no accordion constraint

### Security

- NEVER use `innerHTML` or `dangerouslySetInnerHTML` (ch-u88)
- htm auto-escapes all interpolated values — event payloads containing HTML-like strings are rendered safely as text
- Render JSON as text content inside `<pre>` — never parse it as HTML

### Dependencies

- Story 2.1: event list component (`src/ui/events/event-list.ts`) — this story modifies that component to add expand/collapse
- Story 2.2: session filter — `activeSession` signal must exist in `src/ui/app.ts` before this story modifies `event-list.ts`

### Naming Conventions

- snake_case for JSON fields from API (`tool_name`, `tool_input`, `session_id`)
- camelCase for TypeScript variables (`expandedEventId`, `parsedPayload`)
- kebab-case for file names (`event-detail.ts`)

### Project Structure Notes

```text
src/
  ui/
    events/
      event-list.ts    — add click handler, expand/collapse logic
      event-detail.ts  — expanded detail view component (new)
```

### References

- [Source: ./planning-artifacts/architecture.md#Frontend Architecture]
- [Source: ./planning-artifacts/architecture.md#Security Hardening (Red Team Analysis)]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/epics.md#Story 2.3]
- [Source: ./planning-artifacts/prd.md#Web UI]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
