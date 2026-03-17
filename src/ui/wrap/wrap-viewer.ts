/**
 * WrapViewer component — renders the detail view for wrapped hook events.
 *
 * Displays when an event has a non-null wrapped_command. Shows:
 *   - The wrapped command string at the top
 *   - Collapsible stdout panel (<details> with <pre><code>)
 *   - Collapsible stderr panel (<details> with <pre><code>)
 *   - Exit code with color coding: green for 0, red for non-zero
 *
 * stdin (the raw JSON payload) is also shown in a collapsible panel so the
 * full event data remains accessible.
 *
 * stdin (the Claude Code event JSON) IS captured by the wrap handler —
 * src/handler/wrap.ts reads it, buffers it, and pipes it to the child process.
 *
 * All rendering via htm template literals — no innerHTML.
 */

import type { EventRow } from '@/types.ts';
import { html } from '../shared/html.ts';
import { formatJsonForDisplay, hasContent } from '../shared/utils.ts';

interface WrapViewerProps {
  readonly event: EventRow;
}

/**
 * Return inline style for the exit code badge.
 * Green for 0, red for non-zero.
 * exit_code is NOT NULL in the DB (INTEGER NOT NULL DEFAULT 0) and validated
 * as z.number() by eventRowSchema — null branches are not needed.
 */
function exitCodeStyle(exitCode: number): Record<string, string> {
  if (exitCode === 0) {
    return { color: 'var(--pico-ins-color, #2d9a2d)', fontWeight: '600' };
  }
  return { color: 'var(--pico-del-color, #c0392b)', fontWeight: '600' };
}

export function WrapViewer({ event }: WrapViewerProps): ReturnType<typeof html> {
  const exitStyle = exitCodeStyle(event.exit_code);
  const exitLabel = String(event.exit_code);
  const formattedStdin = formatJsonForDisplay(event.stdin);

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
          hasContent(event.stdout)
            ? html`<pre><code data-testid="stdout-content">${event.stdout}</code></pre>`
            : html`<p><em data-testid="stdout-empty">No stdout captured.</em></p>`
        }
      </details>

      <details open data-testid="stderr-panel">
        <summary>stderr</summary>
        ${
          hasContent(event.stderr)
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
