/**
 * SSE client — connects to /api/events/stream and pushes live events into
 * the eventList signal.
 *
 * Insertion order: newest events go to the BEGINNING of the array so the
 * table stays in reverse-chronological order without re-sorting.
 *
 * Session filtering: when activeSession is set, events whose session_id does
 * not match are silently dropped. When activeSession is null (all sessions),
 * every event is accepted.
 *
 * EventSource reconnects automatically on network interruptions — no custom
 * reconnect logic is needed.
 *
 * ch-u88: no innerHTML — this module does not render HTML.
 */

import type { Signal } from '@preact/signals';
import type { EventRow } from '@/types.ts';

const SSE_ENDPOINT = '/api/events/stream';

/**
 * Start the SSE client.
 *
 * Opens an EventSource connection to the server's stream endpoint. Incoming
 * events are parsed from JSON and prepended to eventList, subject to the
 * activeSession filter.
 *
 * Call once on page load. The returned EventSource can be closed if needed,
 * but in normal usage it runs for the lifetime of the page.
 */
export function startSseClient(
  eventList: Signal<EventRow[]>,
  activeSession: Signal<string | null>,
): EventSource {
  const source = new EventSource(SSE_ENDPOINT);

  source.onmessage = (ev: MessageEvent<string>) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(ev.data) as unknown;
    } catch {
      console.error('hookwatch: SSE received non-JSON data', ev.data);
      return;
    }

    if (!isEventRow(parsed)) {
      console.error('hookwatch: SSE event has unexpected shape', parsed);
      return;
    }

    // Session filter: skip events that don't match the active session
    const session = activeSession.value;
    if (session !== null && parsed.session_id !== session) {
      return;
    }

    // Prepend so the list stays reverse-chronological
    eventList.value = [parsed, ...eventList.value];
  };

  source.onerror = () => {
    // EventSource handles reconnection automatically — log only for debugging
    console.warn('hookwatch: SSE connection error, will reconnect automatically');
  };

  return source;
}

/**
 * Type guard for EventRow. Validates the minimal fields needed to display the
 * event in the list. Does not validate stdin contents.
 * Optional fields (stdout, stderr, exit_code, wrapped_command) are allowed
 * to be absent or null.
 */
function hasRequiredFields(obj: Record<string, unknown>): boolean {
  return (
    typeof obj.id === 'number' &&
    typeof obj.timestamp === 'number' &&
    typeof obj.session_id === 'string'
  );
}

function isEventRow(value: unknown): value is EventRow {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return hasRequiredFields(obj) && typeof obj.event === 'string' && typeof obj.stdin === 'string';
}
