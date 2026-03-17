/**
 * Zod schema for EventRow — the DB row shape returned by the server and
 * broadcast over SSE.
 *
 * Design decisions:
 * - No .loose() — this schema validates data hookwatch itself writes.
 *   Unknown columns are stripped (safe default). .loose() would add
 *   [key: string]: unknown to the inferred type, making the bidirectional
 *   alignment check below vacuously true and defeating its purpose.
 * - Nullable fields use z.string().nullable() / z.number().nullable() to
 *   match the SQLite column definitions exactly.
 * - exit_code is z.number() (NOT NULL DEFAULT 0 in the DB schema).
 * - parseEventRow() is the validated factory for object input (fetch path).
 * - parseSseEvent() is the validated factory for string input (SSE path).
 *
 * Source: @/types.ts (EventRow interface — authoritative DB row definition).
 * Naming: camelCase + Schema suffix (e.g. eventRowSchema), PascalCase inferred types.
 */

import { z } from 'zod';
import { type EventRow, toKnownEventName } from '@/types.ts';
import { parseJsonWithPreview } from './parse-json.ts';

// ---------------------------------------------------------------------------
// EventRow schema
// ---------------------------------------------------------------------------

/**
 * Zod schema mirroring the EventRow interface from src/types.ts.
 * Used to validate data received over SSE and from the /api/query endpoint.
 *
 * The `event` field is modelled as z.string() so that future event names don't
 * cause validation failures. A .transform() normalises unrecognised names to
 * 'unknown' via toKnownEventName(), making z.infer<typeof eventRowSchema>
 * return KnownEventName for the event field — matching EventRow exactly.
 * parseEventRow()/parseSseEvent() no longer need to call toKnownEventName()
 * manually after parse.
 */
export const eventRowSchema = z.object({
  id: z.number(),
  timestamp: z.number(),
  event: z.string().transform(toKnownEventName),
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
});

// ---------------------------------------------------------------------------
// Compile-time alignment check
// ---------------------------------------------------------------------------

// Ensure eventRowSchema output matches EventRow in both directions.
// If either line fails to compile, the Zod schema and TypeScript interface
// have diverged (e.g. a field was added to EventRow but not to eventRowSchema).
type _SchemaOutputMatchesEventRow = z.output<typeof eventRowSchema> extends EventRow ? true : never;
type _EventRowMatchesSchemaOutput = EventRow extends z.output<typeof eventRowSchema> ? true : never;
const _alignCheck1: _SchemaOutputMatchesEventRow = true;
const _alignCheck2: _EventRowMatchesSchemaOutput = true;

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
 * Unknown event names are normalised to 'unknown' by the eventRowSchema
 * .transform() on the event field — no manual call needed here.
 *
 * Throws:
 *   ZodError — if the object does not satisfy eventRowSchema
 */
export function parseEventRow(obj: unknown): EventRow {
  return eventRowSchema.parse(obj);
}

/**
 * Parses and validates a raw SSE message string as an EventRow.
 *
 * Boundary #4: SSE/fetch event data (string) → typed EventRow.
 *
 * Unknown event names are normalised to 'unknown' by the eventRowSchema
 * .transform() on the event field — no manual call needed here.
 *
 * Throws:
 *   SyntaxError  — if data is not valid JSON
 *   ZodError     — if the parsed JSON does not satisfy eventRowSchema
 */
export function parseSseEvent(data: string): EventRow {
  const parsed = parseJsonWithPreview(data, 'SSE data');
  return eventRowSchema.parse(parsed);
}
