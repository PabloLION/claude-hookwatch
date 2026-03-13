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
 * - parseEventRow() is the validated factory for object input (fetch path).
 * - parseSseEvent() is the validated factory for string input (SSE path).
 *
 * Source: src/types.ts (EventRow interface — authoritative DB row definition).
 * Naming: camelCase + Schema suffix (e.g. eventRowSchema), PascalCase inferred types.
 */

import { z } from 'zod';
import type { EventRow } from '@/types.ts';
import { toKnownEventName } from '@/types.ts';

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
 * Validates a parsed object as an EventRow.
 *
 * Boundary #4: fetch response object → typed EventRow.
 * Unlike parseSseEvent (which takes a JSON string), this takes an already-parsed
 * object — for use after res.json() in the fetch path.
 *
 * Unknown event names are normalized to 'unknown' via toKnownEventName() to
 * ensure the return type accurately reflects EventRow.
 *
 * Throws:
 *   ZodError — if the object does not satisfy eventRowSchema
 */
export function parseEventRow(obj: unknown): EventRow {
  const validated = eventRowSchema.parse(obj);
  return { ...validated, event: toKnownEventName(validated.event) };
}

/**
 * Parses and validates a raw SSE message string as an EventRow.
 *
 * Boundary #4: SSE/fetch event data (string) → typed EventRow.
 *
 * Unknown event names are normalized to 'unknown' via toKnownEventName() to
 * ensure the return type accurately reflects EventRow.
 *
 * Throws:
 *   SyntaxError  — if data is not valid JSON
 *   ZodError     — if the parsed JSON does not satisfy eventRowSchema
 */
export function parseSseEvent(data: string): EventRow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    const preview = data.length > 200 ? `${data.slice(0, 200)}\u2026` : data;
    throw new SyntaxError(`SSE data is not valid JSON: ${preview}`, { cause: err });
  }
  return parseEventRow(parsed);
}
