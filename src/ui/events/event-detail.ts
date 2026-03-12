/**
 * EventDetail component — renders the expanded detail view for a single event.
 *
 * Routing logic (Story 3.2):
 *   - Wrapped events (wrapped_command is non-null): delegates to WrapViewer
 *     which displays stdout, stderr, exit_code, and the wrapped_command.
 *   - Bare events (wrapped_command is null): renders the standard detail with
 *     tool info header (for PreToolUse/PostToolUse/PostToolUseFailure) and the
 *     full stdin as formatted JSON.
 *
 * Full stdin as JSON.stringify(parsed, null, 2) inside <pre><code>.
 *
 * ch-u88: all rendering via htm template literals — no innerHTML.
 */

import { isRecord } from '@/guards.ts';
import type { EventRow } from '@/types.ts';
import { html } from '../shared/html.ts';
import { WrapViewer } from '../wrap/wrap-viewer.ts';

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
 * Parse a JSON stdin string. Returns the parsed value or null on failure.
 */
function parseStdin(stdinJson: string): unknown {
  try {
    return JSON.parse(stdinJson);
  } catch {
    return null;
  }
}

/**
 * Extract a string field from a parsed stdin object.
 * Returns null when the field is absent or not a string.
 */
function extractStringField(parsed: unknown, field: string): string | null {
  if (isRecord(parsed) && field in parsed) {
    const value = parsed[field];
    if (typeof value === 'string') return value;
  }
  return null;
}

/**
 * Extract the tool_input field from a parsed stdin object.
 * Returns null when absent.
 */
function extractToolInput(parsed: unknown): unknown {
  if (isRecord(parsed) && 'tool_input' in parsed) {
    return parsed.tool_input;
  }
  return null;
}

/**
 * Check if a nullable string field has non-empty content.
 * Type guard: narrows null | undefined | string to string.
 */
function hasContent(value: string | null | undefined): value is string {
  return value != null && value.length > 0;
}

interface EventDetailProps {
  event: EventRow;
}

export function EventDetail({ event }: EventDetailProps): ReturnType<typeof html> {
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
