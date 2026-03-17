/**
 * hookwatch UI entry point.
 *
 * Owns cross-component signals and mounts the root component.
 * All rendering via htm template literals — no innerHTML.
 */

import { signal } from '@preact/signals';
import { render } from 'preact';
import { EventList, type RowEntry } from './events/event-list.ts';
import { SessionFilter } from './sessions/session-filter.ts';
import { html } from './shared/html.ts';
import { startSseClient } from './shared/sse-client.ts';

// Cross-component signal — owns the current event list.
// Entries may be valid (parsed EventRow) or invalid (validation failure with raw data).
export const eventList = signal<RowEntry[]>([]);

// Cross-component signal — null means "all sessions", a string means filter
// to that specific session ID.
export const activeSession = signal<string | null>(null);

// Start the SSE client immediately on page load.
// It runs for the lifetime of the page — no teardown needed.
startSseClient(eventList, activeSession);

function App() {
  return html`
    <main class="container">
      <h1>hookwatch</h1>
      <${SessionFilter} activeSession=${activeSession} />
      <${EventList} eventList=${eventList} activeSession=${activeSession} />
    </main>
  `;
}

const appEl = document.getElementById('app');
if (appEl) {
  render(html`<${App} />`, appEl);
} else {
  console.error('[hookwatch] #app element not found — cannot render UI');
}
