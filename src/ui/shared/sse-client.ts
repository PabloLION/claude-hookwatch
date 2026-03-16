/**
 * SSE client — connects to /api/events/stream and pushes live events into
 * the eventList signal.
 *
 * Insertion order: newest events go to the BEGINNING of the array so the
 * table stays in reverse-chronological order without re-sorting.
 *
 * Session filtering: when activeSession is set, events whose session_id does
 * not match are silently dropped. When activeSession is null (all sessions),
 * every event is accepted. Invalid events (parse failures) always bypass the
 * session filter — they indicate a system issue and must always be visible.
 *
 * EventSource reconnects automatically on network interruptions — no custom
 * reconnect logic is needed.
 *
 * ch-u88: no innerHTML — this module does not render HTML.
 */

import type { Signal } from '@preact/signals';
import { errorMsg } from '@/errors.ts';
import { parseSseEvent } from '@/schemas/rows.ts';
import type { EventRow } from '@/types.ts';
import { nextInvalidRowKey, type RowEntry } from '../events/event-list.ts';

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
  eventList: Signal<RowEntry[]>,
  activeSession: Signal<string | null>,
): EventSource {
  const source = new EventSource(SSE_ENDPOINT);

  source.onmessage = (ev: MessageEvent<string>) => {
    let parsed: EventRow;
    try {
      parsed = parseSseEvent(ev.data);
    } catch (err) {
      // Invalid SSE event — wrap as an invalid RowEntry and always show it.
      // Session filter is skipped: invalid rows indicate a system issue that
      // the operator needs to see regardless of the active session filter.
      const error = errorMsg(err);
      console.error('hookwatch: SSE event failed validation', err, ev.data);
      // Store raw string when JSON.parse itself failed (data is not an object).
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch (_parseErr) {
        raw = ev.data;
      }
      const entry: RowEntry = { valid: false, raw, error, key: nextInvalidRowKey() };
      eventList.value = [entry, ...eventList.value];
      return;
    }

    // Session filter: skip events that don't match the active session
    const session = activeSession.value;
    if (session !== null && parsed.session_id !== session) {
      return;
    }

    // Wrap in RowEntry and prepend so the list stays reverse-chronological
    const entry: RowEntry = { valid: true, row: parsed };
    eventList.value = [entry, ...eventList.value];
  };

  source.onerror = () => {
    // EventSource handles reconnection automatically — log only for debugging
    console.warn('hookwatch: SSE connection error, will reconnect automatically');
  };

  return source;
}
