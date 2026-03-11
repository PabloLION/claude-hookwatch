/**
 * Session list helper — fetches and formats distinct session IDs from the
 * server via POST /api/query with queryType "sessions".
 *
 * Keeps fetch logic separate from the SessionFilter component so it can be
 * tested and reused independently.
 *
 * ch-lar: no SQL in this layer — all querying goes through the server API.
 * ch-u88: no innerHTML — this module does not render HTML.
 */

/**
 * Fetch the list of distinct session IDs from POST /api/query.
 * Returns an empty array on error — callers display fallback UI.
 */
export async function fetchSessions(): Promise<string[]> {
  try {
    const res = await fetch('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queryType: 'sessions' }),
    });

    if (!res.ok) {
      console.error('hookwatch: /api/query (sessions) returned', res.status);
      return [];
    }

    const data: unknown = await res.json();
    if (Array.isArray(data) && data.every((item) => typeof item === 'string')) {
      return data as string[];
    }

    console.error('hookwatch: unexpected sessions response shape', data);
    return [];
  } catch (err) {
    console.error('hookwatch: failed to fetch sessions', err);
    return [];
  }
}

/**
 * Format a session ID for display in the dropdown.
 * Truncates long IDs to keep the UI compact.
 */
export function formatSessionId(id: string): string {
  // UUIDs and long hex strings are truncated to first 8 chars + ellipsis
  if (id.length > 16) {
    return `${id.slice(0, 8)}…`;
  }
  return id;
}
