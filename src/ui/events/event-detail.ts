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

import type { EventRow } from "../app.ts";
import { html } from "../shared/html.ts";
import { WrapViewer } from "../wrap/wrap-viewer.ts";

/**
 * Event types that carry tool information and warrant the tool info header.
 * PermissionRequest is NOT included — it is not a tool-use event.
 */
const TOOL_EVENT_TYPES = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

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
  if (parsed !== null && typeof parsed === "object" && field in parsed) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
  }
  return null;
}

/**
 * Extract the tool_input field from a parsed stdin object.
 * Returns null when absent.
 */
function extractToolInput(parsed: unknown): unknown {
  if (parsed !== null && typeof parsed === "object" && "tool_input" in parsed) {
    return (parsed as Record<string, unknown>).tool_input;
  }
  return null;
}

interface EventDetailProps {
  event: EventRow;
}

export function EventDetail({ event }: EventDetailProps): ReturnType<typeof html> {
  // Wrapped events: delegate entirely to WrapViewer
  if (event.wrapped_command !== null && event.wrapped_command !== undefined) {
    return html`<${WrapViewer} event=${event} />`;
  }

  // Bare event: standard detail view
  const parsed = parseStdin(event.stdin);
  const formattedStdin = parsed !== null ? JSON.stringify(parsed, null, 2) : event.stdin; // Fallback: display raw string if not valid JSON

  const showToolInfo = isToolEvent(event.event);
  const toolName = showToolInfo ? extractStringField(parsed, "tool_name") : null;
  const toolInput = showToolInfo ? extractToolInput(parsed) : null;
  const formattedToolInput =
    toolInput !== null && toolInput !== undefined ? JSON.stringify(toolInput, null, 2) : null;

  return html`
    <div class="event-detail">
      ${
        showToolInfo &&
        html`
        <dl>
          <dt>Tool name</dt>
          <dd>${toolName ?? "\u2014"}</dd>
          ${
            formattedToolInput !== null &&
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
        event.stdout !== null &&
        event.stdout !== undefined &&
        event.stdout.length > 0 &&
        html`
        <details>
          <summary>stdout</summary>
          <pre><code>${event.stdout}</code></pre>
        </details>
      `
      }
      ${
        event.stderr !== null &&
        event.stderr !== undefined &&
        event.stderr.length > 0 &&
        html`
        <details>
          <summary>stderr</summary>
          <pre><code>${event.stderr}</code></pre>
        </details>
      `
      }
      ${
        event.wrapped_command !== null &&
        html`
        <details>
          <summary>Exit code</summary>
          <p>
            <strong
              style=${{
                color:
                  event.exit_code === 0
                    ? "var(--pico-ins-color, #2d9a2d)"
                    : "var(--pico-del-color, #c0392b)",
              }}
            >${event.exit_code}</strong>
          </p>
        </details>
      `
      }
    </div>
  `;
}
