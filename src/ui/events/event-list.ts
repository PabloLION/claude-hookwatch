/**
 * EventList component — displays a paginated table of hook events.
 *
 * On mount and whenever activeSession changes, fetches events via
 * POST /api/query and updates the eventList signal. Renders a table with
 * columns: timestamp, event type, session ID, tool name. Shows an empty-state
 * message when no events exist.
 *
 * Each row is clickable — clicking toggles an expanded EventDetail view below
 * the row. Multiple rows can be expanded simultaneously.
 *
 * Visual distinction (bare vs wrapped):
 *   - Bare handler events (wrapped_command is null): outline/hollow badge style
 *   - Wrapped events (wrapped_command is non-null): solid/filled badge style
 *
 * Invalid row rendering (ch-lx8i):
 *   - Rows that fail parseEventRow validation are kept as { valid: false } entries
 *   - Rendered with a red/error background and expandable raw data + error detail
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import type { Signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_QUERY_LIMIT } from '@/config.ts';
import { errorMsg } from '@/errors.ts';
import { parseEventRow } from '@/schemas/rows.ts';
import type { EventRow } from '@/types.ts';
import { html } from '../shared/html.ts';
import { EventDetail } from './event-detail.ts';

// ---------------------------------------------------------------------------
// RowEntry union type
// ---------------------------------------------------------------------------

/**
 * A discriminated union representing one entry in the event list.
 *
 * Valid entries wrap a fully-parsed EventRow.
 * Invalid entries carry the raw server response, the validation error message,
 * and a stable negative key assigned at construction time. The key must be
 * assigned once and never change, so expanded invalid rows do not collapse when
 * SSE prepends new events to the list (array-index-based keys would shift).
 *
 * Exported for cross-component use (app.ts, event-detail.ts, sse-client.ts).
 */
export type RowEntry =
  | { readonly valid: true; readonly row: EventRow }
  | { readonly valid: false; readonly raw: unknown; readonly error: string; readonly key: number };

/**
 * Monotonically decreasing counter for invalid row keys.
 *
 * Starts at -1 and decrements with each call. Negative values never collide
 * with real DB ids (which are always positive auto-increment integers).
 */
let _nextInvalidKey = -1;

/**
 * Return the next unique negative key for an invalid row.
 * Mutates the module-level counter — call once per invalid RowEntry construction.
 */
export function nextInvalidRowKey(): number {
  return _nextInvalidKey--;
}

/**
 * Reset the invalid row key counter to its initial value.
 *
 * @internal For testing only — resets module-level state between test runs.
 * Do not call in application code.
 */
export function _resetInvalidKeyCounter(): void {
  _nextInvalidKey = -1;
}

interface EventListProps {
  readonly eventList: Signal<RowEntry[]>;
  readonly activeSession: Signal<string | null>;
}

/**
 * Format a numeric epoch-millisecond timestamp for display.
 */
function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch (err) {
    console.warn('hookwatch: failed to format timestamp', ts, err);
    return String(ts);
  }
}

const BASE_BADGE_STYLE = {
  display: 'inline-block',
  padding: '0.1em 0.5em',
  borderRadius: '0.25em',
  fontWeight: '600',
  fontSize: '0.85em',
};

/**
 * Return inline style object for the event type cell.
 * Wrapped events use solid/filled appearance; bare events use outline style.
 */
function eventTypeBadgeStyle(isWrapped: boolean): Record<string, string> {
  if (isWrapped) {
    return {
      ...BASE_BADGE_STYLE,
      background: 'var(--pico-primary)',
      color: 'var(--pico-primary-inverse, #fff)',
    };
  }
  return {
    ...BASE_BADGE_STYLE,
    background: 'transparent',
    color: 'var(--pico-primary)',
    border: '1px solid var(--pico-primary)',
  };
}

// ---------------------------------------------------------------------------
// Module-level style constants — defined once, not recreated on every render
// ---------------------------------------------------------------------------

const INVALID_ROW_STYLE = {
  cursor: 'pointer',
  userSelect: 'none',
  background: 'var(--pico-mark-background-color, #fdecea)',
  color: 'var(--pico-color, inherit)',
};

const INVALID_ROW_LABEL_STYLE = {
  color: 'var(--pico-del-color, #c0392b)',
  fontWeight: '600',
};

const CLICKABLE_ROW_STYLE = { cursor: 'pointer', userSelect: 'none' };

export function EventList({ eventList, activeSession }: EventListProps) {
  // Track which row keys are currently expanded. A Set allows multiple open rows.
  // Valid rows use their DB id; invalid rows use a negative index key.
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());

  // Re-fetch whenever activeSession changes
  useEffect(() => {
    void fetchEvents(eventList, activeSession.value);
  }, [activeSession.value]);

  function toggleRow(key: number): void {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const entries = eventList.value;

  if (entries.length === 0) {
    return html`
      <section>
        <p>No events captured yet. Interact with Claude Code to generate events.</p>
      </section>
    `;
  }

  return html`
    <section>
      <div style=${{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th scope="col">Timestamp</th>
              <th scope="col">Event Type</th>
              <th scope="col">Session ID</th>
              <th scope="col">Tool Name</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((entry) => {
              if (!entry.valid) {
                // Invalid row — render with error styling using the stable key
                // assigned at construction time (not derived from array index).
                const key = entry.key;
                const expanded = expandedKeys.has(key);
                return html`
                  <tr
                    key=${key}
                    onClick=${() => toggleRow(key)}
                    style=${INVALID_ROW_STYLE}
                    aria-expanded=${expanded}
                    data-invalid-row=${key}
                  >
                    <td colspan="4">
                      <span style=${INVALID_ROW_LABEL_STYLE}>
                        [invalid row] Validation error — click to expand
                      </span>
                    </td>
                  </tr>
                  ${
                    expanded &&
                    html`
                    <tr key=${`invalid-detail-${key}`} data-detail-for=${key}>
                      <td colspan="4">
                        <${EventDetail} entry=${entry} />
                      </td>
                    </tr>
                  `
                  }
                `;
              }

              const event = entry.row;
              const expanded = expandedKeys.has(event.id);
              const isWrapped = event.wrapped_command !== null;
              return html`
                <tr
                  key=${event.id}
                  onClick=${() => toggleRow(event.id)}
                  style=${CLICKABLE_ROW_STYLE}
                  aria-expanded=${expanded}
                  data-event-id=${event.id}
                  data-wrapped=${isWrapped ? 'true' : 'false'}
                >
                  <td>${formatTimestamp(event.timestamp)}</td>
                  <td>
                    <span
                      class=${isWrapped ? 'event-type-badge event-type-badge--wrapped' : 'event-type-badge event-type-badge--bare'}
                      style=${eventTypeBadgeStyle(isWrapped)}
                      data-testid="event-type-badge"
                    >${event.event}</span>
                  </td>
                  <td>${event.session_id}</td>
                  <td>${event.tool_name ?? '\u2014'}</td>
                </tr>
                ${
                  expanded &&
                  html`
                  <tr key=${`detail-${event.id}`} data-detail-for=${event.id}>
                    <td colspan="4">
                      <${EventDetail} entry=${entry} />
                    </td>
                  </tr>
                `
                }
              `;
            })}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function fetchEvents(eventList: Signal<RowEntry[]>, sessionId: string | null): Promise<void> {
  try {
    const body: Record<string, unknown> = { limit: DEFAULT_QUERY_LIMIT };
    if (sessionId !== null) {
      body.session_id = sessionId;
    }

    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '(unreadable)');
      console.error('hookwatch: /api/query returned', res.status, bodyText);
      return;
    }

    const rows: unknown = await res.json();
    if (!Array.isArray(rows)) {
      console.error('hookwatch: /api/query response is not an array', rows);
      return;
    }

    const entries: RowEntry[] = rows.map((item: unknown): RowEntry => {
      try {
        return { valid: true, row: parseEventRow(item) };
      } catch (err) {
        const error = errorMsg(err);
        console.warn('hookwatch: event row failed validation', error, item);
        return { valid: false, raw: item, error, key: nextInvalidRowKey() };
      }
    });

    eventList.value = entries;
  } catch (err) {
    console.error('hookwatch: failed to fetch events', err);
  }
}
