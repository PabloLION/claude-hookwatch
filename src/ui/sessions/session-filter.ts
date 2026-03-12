/**
 * SessionFilter component — dropdown for filtering events by session ID.
 *
 * Fetches distinct session IDs from the server on mount via
 * POST /api/query (queryType: "sessions"). Renders a <select> with an
 * "All sessions" default option plus one option per session.
 *
 * On selection change, updates the activeSession signal owned by app.ts.
 * Selecting "All sessions" sets the signal to null.
 *
 * Signal ownership: activeSession is owned by app.ts and passed as a prop —
 * this component only reads and writes it, never creates it.
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import type { Signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { html } from '../shared/html.ts';
import { fetchSessions, formatSessionId } from './session-list.ts';

interface SessionFilterProps {
  activeSession: Signal<string | null>;
}

export function SessionFilter({ activeSession }: SessionFilterProps) {
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const data = await fetchSessions();
      setSessions(data);
      setLoading(false);
    })();
  }, []);

  function handleChange(e: JSX.TargetedEvent<HTMLSelectElement>): void {
    const value = e.currentTarget.value;
    activeSession.value = value === '' ? null : value;
  }

  const selectValue = activeSession.value ?? '';

  return html`
    <div>
      <label for="session-filter">Session</label>
      <select
        id="session-filter"
        name="session-filter"
        value=${selectValue}
        onChange=${handleChange}
        aria-label="Filter by session"
        disabled=${loading}
      >
        <option value="">All sessions</option>
        ${sessions.map(
          (id) => html`
            <option key=${id} value=${id}>${formatSessionId(id)}</option>
          `,
        )}
      </select>
    </div>
  `;
}
