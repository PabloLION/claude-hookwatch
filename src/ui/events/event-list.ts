/**
 * EventList component — displays a paginated table of hook events.
 *
 * On mount, fetches events via POST /api/query and updates the eventList
 * signal. Renders a table with columns: timestamp, event type, session ID,
 * tool name. Shows an empty-state message when no events exist.
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import type { Signal } from "@preact/signals";
import htm from "htm";
import { h } from "preact";
import { useEffect } from "preact/hooks";
import type { EventRow } from "../app.ts";

const html = htm.bind(h);

// TODO: configurable via config.toml (ch-1ex5.1)
const DEFAULT_QUERY_LIMIT = 100;

interface EventListProps {
  eventList: Signal<EventRow[]>;
}

/**
 * Extract tool name from a JSON payload string.
 * Returns "—" when the field is absent or parsing fails.
 */
function extractToolName(payloadJson: string): string {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "tool_name" in parsed &&
      typeof (parsed as Record<string, unknown>).tool_name === "string"
    ) {
      return (parsed as Record<string, unknown>).tool_name as string;
    }
  } catch {
    // Payload is not valid JSON — return placeholder
  }
  return "\u2014";
}

/**
 * Format an ISO timestamp string for display.
 * Returns the original string on parse failure.
 */
function formatTimestamp(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export function EventList({ eventList }: EventListProps) {
  useEffect(() => {
    void fetchEvents(eventList);
  }, []);

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
      <div style=${{ overflowX: "auto" }}>
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
            ${events.map(
              (event) => html`
                <tr key=${event.id}>
                  <td>${formatTimestamp(event.ts)}</td>
                  <td>${event.event}</td>
                  <td>${event.session_id}</td>
                  <td>${extractToolName(event.payload)}</td>
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function fetchEvents(eventList: Signal<EventRow[]>): Promise<void> {
  try {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: DEFAULT_QUERY_LIMIT }),
    });

    if (!res.ok) {
      console.error("hookwatch: /api/query returned", res.status);
      return;
    }

    const rows: unknown = await res.json();
    if (Array.isArray(rows)) {
      eventList.value = rows as EventRow[];
    }
  } catch (err) {
    console.error("hookwatch: failed to fetch events", err);
  }
}
