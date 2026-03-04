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

### JSON Display

- Format: `JSON.stringify(parsedPayload, null, 2)` inside `<pre><code>` block
- Pico CSS auto-styles `<code>` blocks — no external syntax highlighter in v0
- Syntax highlighting is minimal — monospace font with Pico's code styling is sufficient
- The `payload` column stores the full stdin JSON as TEXT — parse it client-side for display

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

### Expand/Collapse

- Track expanded state via a Preact signal (e.g., `expandedEventId` signal holding the ID of the currently expanded event, or `null` if none)
- Only one event expanded at a time (accordion behavior) — or allow multiple, depending on UX preference. Single-expand is simpler
- Click handler on the event row toggles the signal

### Security

- NEVER use `innerHTML` or `dangerouslySetInnerHTML` (ch-u88)
- htm auto-escapes all interpolated values — event payloads containing HTML-like strings are rendered safely as text
- Render JSON as text content inside `<pre>` — never parse it as HTML

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

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
