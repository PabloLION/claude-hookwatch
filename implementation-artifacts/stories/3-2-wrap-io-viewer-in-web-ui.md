# Story 3.2: Wrap I/O Viewer in Web UI

Status: ready-for-dev

## Story

As a hook author,
I want to see captured wrap I/O in the web UI,
so that I can debug my hook's input/output behavior visually.

## Acceptance Criteria

1. **Given** wrap events exist in the database, **when** the event list page
   loads, **then** wrap events are displayed alongside hook events with a
   distinct visual indicator.

2. **Given** a developer clicks on a wrap event, **when** the detail view
   expands, **then** stdin, stdout, and stderr are displayed in separate panels,
   and the original command and exit code are shown.

3. **Given** the session filter is active, **when** wrap events are filtered,
   **then** they follow the same session filtering as hook events.

## Tasks / Subtasks

- [ ] Create `src/ui/wrap/wrap-viewer.ts` — Preact component for rendering wrap event detail view with three I/O panels (AC: #2)
- [ ] Add wrap event visual indicator to the event list component — different background color or icon to distinguish `"Wrap"` events from hook events (AC: #1)
- [ ] Implement stdout panel — `<pre><code>` block displaying captured stdout text (AC: #2)
- [ ] Implement stderr panel — `<pre><code>` block displaying captured stderr text (AC: #2)
- [ ] Implement stdin panel — `<pre><code>` block displaying captured stdin text (AC: #2)
- [ ] Display original command as formatted text (e.g., `my-hook-script.sh arg1 arg2`) above the I/O panels (AC: #2)
- [ ] Display exit code with color coding — green for exit code 0, red for non-zero (AC: #2)
- [ ] Use collapsible panels — `<details>` or `<article>` elements via Pico CSS for each I/O stream (AC: #2)
- [ ] Integrate wrap-viewer into event detail expansion — when event type is `"Wrap"`, render wrap-viewer instead of the standard event detail view (AC: #1, #2)
- [ ] Verify session filter works for wrap events — `POST /api/query` with session filter returns wrap events alongside hook events (AC: #3)
- [ ] Verify SSE live updates include wrap events — new wrap events appear in the list without page refresh (AC: #1)
- [ ] Create Playwright browser test for wrap viewer — test visual indicator, panel rendering, exit code display, and session filtering (AC: #1, #2, #3)

## Dev Notes

### Frontend Stack

- Preact + htm tagged template literals — NO JSX, no `.tsx` files
- Preact signals for state management — wrap event data flows through signals
- Pico CSS as base styling — semantic HTML gets automatic styling
- Custom styles via CSS-in-JS (style objects or inline `<style>` tags)
- UI delivery: Bun.Transpiler on-the-fly, no `.js` on disk, in-memory Map cache

### Component Design

The wrap-viewer component renders the detail view for wrap events. It receives the wrap event's `payload` JSON (parsed) and displays:

- **Command header**: the original command array joined as a shell-like string
- **Exit code badge**: color-coded inline element (green background for `0`, red for non-zero)
- **Three collapsible I/O panels**: stdin, stdout, stderr — each in a `<details>` element with `<pre><code>` content

Example component structure using htm:

```ts
html`
  <article class="hw-wrap-detail">
    <header>
      <code>${command}</code>
      <span class=${exitCodeClass}>Exit: ${exitCode}</span>
    </header>
    <details open>
      <summary>stdout</summary>
      <pre><code>${stdout}</code></pre>
    </details>
    <details>
      <summary>stderr</summary>
      <pre><code>${stderr}</code></pre>
    </details>
    <details>
      <summary>stdin</summary>
      <pre><code>${stdin}</code></pre>
    </details>
  </article>
`
```

### Visual Indicator for Event List

- In the event list, wrap events need a distinct appearance
- Options: different background color row, a "Wrap" badge/tag, or a terminal icon
- Use a CSS class prefix `hw-wrap-event` for wrap-specific styling
- Event type column already shows the event name — `"Wrap"` is self-describing, but add visual emphasis

### Query Integration

- Same `POST /api/query` endpoint used by the event list — no new endpoints needed
- Filter by event type: `{ "event": "Wrap" }` to show only wrap events (optional filter)
- Session filter: wrap events have `session_id` in the events table, so existing session filter logic applies without modification
- SSE stream (`GET /api/events/stream`) already pushes all new events — wrap events included automatically

### Security

- NEVER use `innerHTML` or `dangerouslySetInnerHTML` (ch-u88) — htm auto-escapes interpolated values
- Wrap payloads may contain arbitrary command output — all content rendered via htm template interpolation (auto-escaped)
- Parameterized SQL for any queries (ch-lar) — handled by existing query layer

### Testing

- Playwright browser tests in `tests/` directory
- Test scenarios:
  - Load event list with mix of hook and wrap events — verify wrap events have visual indicator
  - Click wrap event — verify three panels render with correct content
  - Verify exit code 0 renders green, exit code 1 renders red
  - Apply session filter — verify wrap events filter correctly
- Unit tests not needed for pure Preact components — Playwright covers rendering behavior

### Project Structure Notes

```text
src/
  ui/
    wrap/
      wrap-viewer.ts    — Preact component for wrap event detail
    events/
      event-list.ts     — modify to add wrap visual indicator
      event-detail.ts   — modify to delegate to wrap-viewer for Wrap events
    app.ts              — import wrap-viewer
tests/
  wrap-viewer.test.ts   — Playwright browser test
```

- Path alias: `@/` maps to `./src/`
- File naming: kebab-case
- Preact signals: camelCase, no suffix
- CSS class prefixes: `hw-` namespace for hookwatch-specific styles

### References

- [Source: planning-artifacts/architecture.md#Frontend Architecture]
- [Source: planning-artifacts/architecture.md#API & Communication]
- [Source: planning-artifacts/architecture.md#Data Architecture]
- [Source: planning-artifacts/architecture.md#Complete Project Directory Structure]
- [Source: planning-artifacts/architecture.md#Security Hardening (Red Team Analysis)]
- [Source: planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: planning-artifacts/epics.md#Story 3.2]
- [Source: planning-artifacts/prd.md#FR14]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
