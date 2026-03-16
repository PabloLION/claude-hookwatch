/**
 * GET /health — health check endpoint.
 * Returns 200 OK with a JSON body. Used by the hook handler spawn probe
 * to confirm the server is running before forwarding events.
 *
 * Response body: { status: "ok", app: "hookwatch", version: "<semver>" }
 */

import { VERSION } from '@/version.ts';
import { HTTP_OK } from './http-status.ts';

export function handleHealth(_req: Request): Response {
  return Response.json({ status: 'ok', app: 'hookwatch', version: VERSION }, { status: HTTP_OK });
}
