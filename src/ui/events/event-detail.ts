/**
 * EventDetail component — renders the expanded detail view for a single event.
 *
 * Routing logic (Story 3.2):
 *   - Wrapped events (wrapped_command is non-null): delegates to WrapViewer
 *     which displays stdout, stderr, exit_code, and the wrapped_command.
 *   - Bare events (wrapped_command is null): renders the standard detail with
 *     tool info header (for PreToolUse/PostToolUse/PostToolUseFailure) and the
 *     full stdin as formatted JSON.
 *   - Invalid entries (ch-lx8i): renders the validation error and raw data
 *     so operators can diagnose schema mismatches without losing the payload.
 *
 * Full stdin as JSON.stringify(parsed, null, 2) inside <pre><code>.
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import type { HookEvent } from '@/schemas/events.ts';
import { parseHookEvent } from '@/schemas/events.ts';
import type { EventRow } from '@/types.ts';
import { html } from '../shared/html.ts';
import { WrapViewer } from '../wrap/wrap-viewer.ts';
import type { RowEntry } from './event-list.ts';

// ---------------------------------------------------------------------------
// Module-level style constants — defined once, not recreated on every render
// ---------------------------------------------------------------------------

const ERROR_HEADING_STYLE = {
  color: 'var(--pico-del-color, #c0392b)',
  fontWeight: '600',
  margin: '0 0 0.5rem',
};

/**
 * Event types that carry tool information and warrant the tool info header.
 * PermissionRequest is NOT included — it is not a tool-use event.
 */
const TOOL_EVENT_TYPES = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);

/**
 * Check whether an event type is a tool-related event.
 */
function isToolEvent(eventType: string): boolean {
  return TOOL_EVENT_TYPES.has(eventType);
}

/**
 * Parse and validate a JSON stdin string as a HookEvent.
 * Returns the validated HookEvent or null on failure.
 */
function parseStdin(stdinJson: string): HookEvent | null {
  try {
    return parseHookEvent(JSON.parse(stdinJson));
  } catch (err) {
    console.warn('hookwatch: failed to parse event stdin', err);
    return null;
  }
}

/**
 * Extract a string field from a parsed HookEvent.
 * Returns null when the field is absent or not a string.
 */
function extractStringField(parsed: HookEvent | null, field: string): string | null {
  if (parsed === null) return null;
  const value = parsed[field];
  return typeof value === 'string' ? value : null;
}

/**
 * Extract the tool_input field from a parsed HookEvent.
 * Returns null when absent.
 */
function extractToolInput(parsed: HookEvent | null): unknown {
  if (parsed === null) return null;
  return parsed.tool_input ?? null;
}

/**
 * Check if a nullable string field has non-empty content.
 * Type guard: narrows null | undefined | string to string.
 */
function hasContent(value: string | null | undefined): value is string {
  return value != null && value.length > 0;
}

interface EventDetailProps {
  entry: RowEntry;
}

export function EventDetail({ entry }: EventDetailProps): ReturnType<typeof html> {
  // Invalid entry: show validation error and raw payload
  if (!entry.valid) {
    let rawFormatted: string;
    try {
      rawFormatted = JSON.stringify(entry.raw, null, 2);
    } catch (e) {
      console.warn('hookwatch: JSON.stringify failed on raw entry, falling back to String()', e);
      rawFormatted = String(entry.raw);
    }
    return html`
      <div class="event-detail event-detail--invalid">
        <p style=${ERROR_HEADING_STYLE}>
          Validation error
        </p>
        <details open>
          <summary>Error details</summary>
          <pre><code>${entry.error}</code></pre>
        </details>
        <details open>
          <summary>Raw server payload</summary>
          <pre><code>${rawFormatted}</code></pre>
        </details>
      </div>
    `;
  }

  const event: EventRow = entry.row;

  // Wrapped events: delegate entirely to WrapViewer
  if (event.wrapped_command != null) {
    return html`<${WrapViewer} event=${event} />`;
  }

  // Bare event: standard detail view
  const parsed = parseStdin(event.stdin);
  const formattedStdin = parsed === null ? event.stdin : JSON.stringify(parsed, null, 2);

  const showToolInfo = isToolEvent(event.event);
  const toolName = extractStringField(parsed, 'tool_name');
  const toolInput = extractToolInput(parsed);
  const formattedToolInput =
    toolInput === null || toolInput === undefined ? null : JSON.stringify(toolInput, null, 2);

  return html`
    <div class="event-detail">
      ${
        showToolInfo &&
        html`
        <dl>
          <dt>Tool name</dt>
          <dd>${toolName ?? '\u2014'}</dd>
          ${
            formattedToolInput &&
            html`
            <dt>Tool input</dt>
            <dd>
              <pre><code>${formattedToolInput}</code></pre>
            </dd>
          `
          }
        </dl>
      `
      }
      <details open>
        <summary>Full stdin</summary>
        <pre><code>${formattedStdin}</code></pre>
      </details>
      ${
        hasContent(event.stdout) &&
        html`
        <details>
          <summary>stdout</summary>
          <pre><code>${event.stdout}</code></pre>
        </details>
      `
      }
      ${
        hasContent(event.stderr) &&
        html`
        <details>
          <summary>stderr</summary>
          <pre><code>${event.stderr}</code></pre>
        </details>
      `
      }
    </div>
  `;
}
