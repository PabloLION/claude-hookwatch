/**
 * Zod schema for EventRow — the DB row shape returned by the server and
 * broadcast over SSE.
 *
 * Design decisions:
 * - .loose() — forward-compatible with future columns added to the DB schema.
 *   Unknown columns received from the server are preserved, not stripped.
 * - Nullable fields use z.string().nullable() / z.number().nullable() to
 *   match the SQLite column definitions exactly.
 * - exit_code is z.number() (NOT NULL DEFAULT 0 in the DB schema).
 * - parseSseEvent() is the validated factory for Boundary #4 (SSE/fetch event
 *   data). Replaces the ad-hoc isRecord() + manual field checks used in:
 *     src/ui/shared/sse-client.ts, src/ui/events/event-list.ts,
 *     src/ui/events/event-detail.ts, src/server/ingest.ts.
 *
 * Source: src/types.ts (EventRow interface — authoritative DB row definition).
 * Naming: camelCase + Schema suffix (e.g. eventRowSchema), PascalCase inferred types.
 */

import { z } from 'zod';
import type { EventRow } from '@/types.ts';

// ---------------------------------------------------------------------------
// EventRow schema
// ---------------------------------------------------------------------------

/**
 * Zod schema mirroring the EventRow interface from src/types.ts.
 * Used to validate data received over SSE and from the /api/query endpoint.
 *
 * The `event` column holds either a known event name or "unknown" — modelled
 * as z.string() rather than a z.enum() of the 18 known names so that future
 * event types don't cause validation failures before the schema is updated.
 */
export const eventRowSchema = z
  .object({
    id: z.number(),
    timestamp: z.number(),
    event: z.string(),
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string().nullable(),
    session_name: z.string().nullable(),
    hook_duration_ms: z.number().nullable(),
    stdin: z.string(),
    wrapped_command: z.string().nullable(),
    stdout: z.string().nullable(),
    stderr: z.string().nullable(),
    exit_code: z.number(),
    hookwatch_log: z.string().nullable(),
  })
  .loose();

/**
 * Inferred TypeScript type from eventRowSchema.
 *
 * Intentionally structurally compatible with (but not identical to) the
 * EventRow interface: eventRowSchema uses z.string() for the `event` column
 * rather than KnownEventName, and the inferred type reflects that. Callers
 * that need the KnownEventName union should use EventRow from src/types.ts
 * directly; callers that receive data from the wire and validate it here
 * should use ParsedEventRow.
 */
export type ParsedEventRow = z.infer<typeof eventRowSchema>;

// ---------------------------------------------------------------------------
// Parse factory — Boundary #4 (SSE / fetch event data)
// ---------------------------------------------------------------------------

/**
 * Parses and validates a raw SSE message string as an EventRow.
 *
 * Boundary #4: SSE/fetch event data (string) → typed EventRow.
 * Replaces the ad-hoc isRecord() + hasRequiredFields() pattern used in
 * sse-client.ts and other UI files.
 *
 * Throws:
 *   SyntaxError  — if data is not valid JSON
 *   ZodError     — if the parsed JSON does not satisfy eventRowSchema
 *
 * Note: returns ParsedEventRow rather than EventRow because the `event`
 * field is typed as string here (not KnownEventName). Use toKnownEventName()
 * from src/types.ts to narrow when needed.
 */
export function parseSseEvent(data: string): EventRow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    const preview = data.length > 200 ? `${data.slice(0, 200)}\u2026` : data;
    throw new SyntaxError(`SSE data is not valid JSON: ${preview}`, { cause: err });
  }
  return eventRowSchema.parse(parsed) as EventRow;
}
