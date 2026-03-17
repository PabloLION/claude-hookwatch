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
 * Query values flow through queryEvents() parameterized helpers only —
 * no SQL string concatenation in this handler.
 */

import { openDb } from '@/db/connection.ts';
import { getDistinctSessions, queryEvents } from '@/db/queries.ts';
import { type QueryFilter, queryFilterSchema } from '@/schemas/query.ts';
import { dbErrorResponse, parseRequestJson, zodErrorResponse } from '@/server/errors.ts';
import { HTTP_OK } from '@/server/http-status.ts';

export async function handleQuery(req: Request): Promise<Response> {
  // Parse JSON body
  const parsed = await parseRequestJson(req);
  if (!parsed.ok) return parsed.response;

  // Validate with Zod (applies defaults for limit/offset)
  let filter: QueryFilter;
  try {
    filter = queryFilterSchema.parse(parsed.data);
  } catch (err) {
    return zodErrorResponse(err);
  }

  // Query the database — route on queryType discriminator
  try {
    const db = openDb();
    switch (filter.queryType) {
      case 'sessions': {
        const sessions = getDistinctSessions(db);
        return Response.json(sessions, { status: HTTP_OK });
      }
      case 'events': {
        const events = queryEvents(db, filter);
        return Response.json(events, { status: HTTP_OK });
      }
      default: {
        const _exhaustive: never = filter.queryType;
        return Response.json({ error: `Unknown queryType: ${_exhaustive}` }, { status: HTTP_OK });
      }
    }
  } catch (err) {
    return dbErrorResponse(err);
  }
}
