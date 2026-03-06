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

const html = htm.bind(h);

// Cross-component signal — owns the current event list
// TODO: configurable via config.toml (ch-1ex5.1) — default query limit
export const eventList = signal<EventRow[]>([]);

export interface EventRow {
  id: number;
  ts: string;
  session_id: string;
  hook_event_name: string;
  payload: string;
}

function App() {
  return html`
    <main class="container">
      <h1>hookwatch</h1>
      <${EventList} eventList=${eventList} />
    </main>
  `;
}

const appEl = document.getElementById("app");
if (appEl) {
  render(html`<${App} />`, appEl);
}
