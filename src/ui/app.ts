/**
 * hookwatch UI entry point.
 *
 * Owns cross-component signals and mounts the root component.
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import { signal } from "@preact/signals";
import htm from "htm";
import { h, render } from "preact";
import { EventList } from "./events/event-list.ts";
import { SessionFilter } from "./sessions/session-filter.ts";
import { startSseClient } from "./shared/sse-client.ts";

const html = htm.bind(h);

export interface EventRow {
  id: number;
  timestamp: number;
  session_id: string;
  event: string;
  stdin: string;
  stdout: string | null;
  stderr: string | null;
  exit_code: number | null;
  wrapped_command: string | null;
  hookwatch_error: string | null;
}

// Cross-component signal — owns the current event list
// TODO: configurable via config.toml (ch-1ex5.1) — default query limit
export const eventList = signal<EventRow[]>([]);

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

const appEl = document.getElementById("app");
if (appEl) {
  render(html`<${App} />`, appEl);
}
