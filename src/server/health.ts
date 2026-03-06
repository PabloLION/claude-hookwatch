/**
 * GET /health — health check endpoint.
 * Returns 200 OK with a JSON body. Used by the hook handler spawn probe
 * to confirm the server is running before forwarding events.
 */
export function handleHealth(_req: Request): Response {
  return Response.json({ status: "ok" }, { status: 200 });
}
