/**
 * Zod schema for the query filter object used by POST /api/query.
 *
 * Design decisions:
 * - max limit is 1000: prevents unbounded queries from killing the server
 *   (a single request returning all rows would block the SQLite WAL writer).
 * - default limit is 100: reasonable page size for the UI event list — enough
 *   to fill a viewport without transferring unnecessary data.
 * - default offset is 0: start from the beginning of the result set
 *   (callers paginate by incrementing offset in steps of limit).
 * - .passthrough() for forward compatibility: same convention as event schemas
 *   (NFR12) — unknown filter fields added in future API versions are preserved,
 *   not stripped, so older server code does not reject newer client requests.
 *
 * Source: planning-artifacts/architecture.md (schema design decisions).
 * Naming: camelCase + Schema suffix (e.g. queryFilterSchema), PascalCase inferred types.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Query filter schema
// ---------------------------------------------------------------------------

export const queryFilterSchema = z
  .object({
    /**
     * Discriminator field: "events" returns filtered event rows (default);
     * "sessions" returns the list of distinct session IDs.
     */
    queryType: z.enum(['events', 'sessions']).optional().default('events'),
    session_id: z.string().optional(),
    hook_event_name: z.string().optional(),
    limit: z.number().int().positive().max(1000).optional().default(100),
    offset: z.number().int().nonnegative().optional().default(0),
  })
  .passthrough();

export type QueryFilter = z.infer<typeof queryFilterSchema>;
