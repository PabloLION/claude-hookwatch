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
 * Visual distinction (Story 3.2):
 *   - Bare handler events (wrapped_command is null): outline/hollow badge style
 *   - Wrapped events (wrapped_command is non-null): solid/filled badge style
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import type { Signal } from '@preact/signals';
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_QUERY_LIMIT } from '@/config.ts';
import type { EventRow } from '@/types.ts';
import { html } from '../shared/html.ts';
import { EventDetail } from './event-detail.ts';

interface EventListProps {
  eventList: Signal<EventRow[]>;
  activeSession: Signal<string | null>;
}

/**
 * Extract tool name from a JSON stdin string.
 * Returns "—" when the field is absent or parsing fails.
 */
function extractToolName(stdinJson: string): string {
  try {
    const parsed: unknown = JSON.parse(stdinJson);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'tool_name' in parsed &&
      typeof (parsed as Record<string, unknown>).tool_name === 'string'
    ) {
      return (parsed as Record<string, unknown>).tool_name as string;
    }
  } catch {
    // stdin is not valid JSON — return placeholder
  }
  return '\u2014';
}

/**
 * Format a numeric epoch-millisecond timestamp for display.
 */
function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

/**
 * Return inline style object for the event type cell.
 * Wrapped events use solid/filled appearance; bare events use outline style.
 */
function eventTypeBadgeStyle(isWrapped: boolean): Record<string, string> {
  if (isWrapped) {
    return {
      display: 'inline-block',
      padding: '0.1em 0.5em',
      borderRadius: '0.25em',
      background: 'var(--pico-primary)',
      color: 'var(--pico-primary-inverse, #fff)',
      fontWeight: '600',
      fontSize: '0.85em',
    };
  }
  return {
    display: 'inline-block',
    padding: '0.1em 0.5em',
    borderRadius: '0.25em',
    background: 'transparent',
    color: 'var(--pico-primary)',
    border: '1px solid var(--pico-primary)',
    fontWeight: '600',
    fontSize: '0.85em',
  };
}

export function EventList({ eventList, activeSession }: EventListProps) {
  // Track which row IDs are currently expanded. A Set allows multiple open rows.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  // Re-fetch whenever activeSession changes
  useEffect(() => {
    void fetchEvents(eventList, activeSession.value);
  }, [activeSession.value]);

  function toggleRow(id: number): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const events = eventList.value;

  if (events.length === 0) {
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
            ${events.map((event) => {
              const expanded = expandedIds.has(event.id);
              const isWrapped =
                event.wrapped_command !== null && event.wrapped_command !== undefined;
              return html`
                <tr
                  key=${event.id}
                  onClick=${() => toggleRow(event.id)}
                  style=${{ cursor: 'pointer' }}
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
                  <td>${extractToolName(event.stdin)}</td>
                </tr>
                ${
                  expanded &&
                  html`
                  <tr key=${`detail-${event.id}`} data-detail-for=${event.id}>
                    <td colspan="4">
                      <${EventDetail} event=${event} />
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

async function fetchEvents(eventList: Signal<EventRow[]>, sessionId: string | null): Promise<void> {
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
      console.error('hookwatch: /api/query returned', res.status);
      return;
    }

    const rows: unknown = await res.json();
    if (Array.isArray(rows)) {
      eventList.value = rows as EventRow[];
    }
  } catch (err) {
    console.error('hookwatch: failed to fetch events', err);
  }
}
