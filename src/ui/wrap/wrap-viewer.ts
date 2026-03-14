/**
 * WrapViewer component — renders the detail view for wrapped hook events.
 *
 * Displays when an event has a non-null wrapped_command. Shows:
 *   - The wrapped command string at the top
 *   - Collapsible stdout panel (<details> with <pre><code>)
 *   - Collapsible stderr panel (<details> with <pre><code>)
 *   - Exit code with color coding: green for 0, red for non-zero, grey for null
 *
 * stdin (the raw JSON payload) is also shown in a collapsible panel so the
 * full event data remains accessible.
 *
 * stdin (the Claude Code event JSON) IS captured by the wrap handler —
 * src/handler/wrap.ts reads it, buffers it, and pipes it to the child process.
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import type { EventRow } from '@/types.ts';
import { html } from '../shared/html.ts';

interface WrapViewerProps {
  event: EventRow;
}

/**
 * Return inline style for the exit code badge.
 * Green for 0, red for non-zero, grey when unavailable.
 */
function exitCodeStyle(exitCode: number | null): Record<string, string> {
  if (exitCode === null) {
    return { color: 'var(--pico-muted-color, #888)', fontWeight: '600' };
  }
  if (exitCode === 0) {
    return { color: 'var(--pico-ins-color, #2d9a2d)', fontWeight: '600' };
  }
  return { color: 'var(--pico-del-color, #c0392b)', fontWeight: '600' };
}

function formatExitCode(exitCode: number | null): string {
  if (exitCode === null) return 'N/A';
  return String(exitCode);
}

/**
 * Parse a JSON stdin string for display. Falls back to raw string on failure.
 */
function formatStdin(stdinJson: string): string {
  try {
    const parsed: unknown = JSON.parse(stdinJson);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return stdinJson;
  }
}

export function WrapViewer({ event }: WrapViewerProps): ReturnType<typeof html> {
  const exitStyle = exitCodeStyle(event.exit_code);
  const exitLabel = formatExitCode(event.exit_code);
  const formattedStdin = formatStdin(event.stdin);

  return html`
    <div class="event-detail wrap-viewer" data-testid="wrap-viewer">

      <dl>
        <dt>Wrapped command</dt>
        <dd>
          <code data-testid="wrapped-command">${event.wrapped_command}</code>
        </dd>
        <dt>Exit code</dt>
        <dd>
          <span style=${exitStyle} data-testid="exit-code">${exitLabel}</span>
        </dd>
      </dl>

      <details open data-testid="stdout-panel">
        <summary>stdout</summary>
        ${
          event.stdout !== null && event.stdout !== undefined && event.stdout.length > 0
            ? html`<pre><code data-testid="stdout-content">${event.stdout}</code></pre>`
            : html`<p><em data-testid="stdout-empty">No stdout captured.</em></p>`
        }
      </details>

      <details open data-testid="stderr-panel">
        <summary>stderr</summary>
        ${
          event.stderr !== null && event.stderr !== undefined && event.stderr.length > 0
            ? html`<pre><code data-testid="stderr-content">${event.stderr}</code></pre>`
            : html`<p><em data-testid="stderr-empty">No stderr captured.</em></p>`
        }
      </details>

      <details data-testid="stdin-panel">
        <summary>Full payload (stdin)</summary>
        <pre><code data-testid="stdin-content">${formattedStdin}</code></pre>
      </details>

    </div>
  `;
}
