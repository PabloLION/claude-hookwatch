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
import {
  HTTP_BAD_REQUEST,
  HTTP_INTERNAL_ERROR,
  HTTP_OK,
  HTTP_SERVICE_UNAVAILABLE,
} from '@/server/http-status.ts';

export async function handleQuery(req: Request): Promise<Response> {
  // Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('INVALID_QUERY', 'Request body is not valid JSON', HTTP_BAD_REQUEST);
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
        HTTP_BAD_REQUEST,
      );
    }
    return errorResponse('INVALID_QUERY', 'Payload validation failed', HTTP_BAD_REQUEST);
  }

  // Query the database — route on queryType discriminator
  try {
    const db = openDb();
    if (filter.queryType === 'sessions') {
      const sessions = getDistinctSessions(db);
      return Response.json(sessions, { status: HTTP_OK });
    }
    const events = queryEvents(db, filter);
    return Response.json(events, { status: HTTP_OK });
  } catch (err) {
    if (isSqliteBusy(err)) {
      return errorResponse(
        'DB_LOCKED',
        'Database is busy, retry shortly',
        HTTP_SERVICE_UNAVAILABLE,
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return errorResponse('INTERNAL', message, HTTP_INTERNAL_ERROR);
  }
}
