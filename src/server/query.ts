/**
 * POST /api/query — flexible event query endpoint.
 *
 * Accepts a JSON body matching queryFilterSchema, queries the events table
 * with the provided filters, and returns a JSON array of matching rows.
 *
 * Error handling:
 *   - 400 INVALID_QUERY  — malformed JSON or Zod validation failure
 *   - 503 DB_LOCKED      — SQLite SQLITE_BUSY/SQLITE_LOCKED
 *   - 500 INTERNAL       — any other unexpected error
 *
 * ch-lar: query values flow through queryEvents() parameterized helpers only —
 * no SQL string concatenation in this handler.
 */

import { ZodError } from 'zod';
import { openDb } from '@/db/connection.ts';
import { isSqliteBusy } from '@/db/errors.ts';
import { getDistinctSessions, queryEvents } from '@/db/queries.ts';
import { queryFilterSchema } from '@/schemas/query.ts';
import { errorResponse } from '@/server/errors.ts';

export async function handleQuery(req: Request): Promise<Response> {
  // Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('INVALID_QUERY', 'Request body is not valid JSON', 400);
  }

  // Validate with Zod (applies defaults for limit/offset)
  let filter: ReturnType<typeof queryFilterSchema.parse>;
  try {
    filter = queryFilterSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse(
        'INVALID_QUERY',
        `Validation failed: ${err.issues.map((i) => i.message).join('; ')}`,
        400,
      );
    }
    return errorResponse('INVALID_QUERY', 'Payload validation failed', 400);
  }

  // Query the database — route on queryType discriminator
  try {
    const db = openDb();
    if (filter.queryType === 'sessions') {
      const sessions = getDistinctSessions(db);
      return Response.json(sessions, { status: 200 });
    }
    const events = queryEvents(db, filter);
    return Response.json(events, { status: 200 });
  } catch (err) {
    if (isSqliteBusy(err)) {
      return errorResponse('DB_LOCKED', 'Database is busy, retry shortly', 503);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse('INTERNAL', message, 500);
  }
}
