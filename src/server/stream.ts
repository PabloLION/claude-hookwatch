/**
 * GET /api/events/stream — Server-Sent Events endpoint.
 *
 * Maintains a set of connected SSE clients and broadcasts new events to all
 * of them as they are ingested via POST /api/events.
 *
 * ch-u88: SSE data is JSON.stringify()'d — never interpolated into HTML.
 *
 * SSE message format (per spec):
 *   data: <json>\n\n
 *
 * Response headers:
 *   Content-Type: text/event-stream
 *   Cache-Control: no-cache
 *   Connection: keep-alive
 */

import { errorMsg } from '@/errors.ts';
import type { EventRow } from '@/types.ts';

// ---------------------------------------------------------------------------
// Client registry
// ---------------------------------------------------------------------------

const clients = new Set<ReadableStreamDefaultController>();

// ---------------------------------------------------------------------------
// SSE handler
// ---------------------------------------------------------------------------

/**
 * Handle GET /api/events/stream.
 * Opens a persistent SSE stream; registers the controller in clients.
 * On disconnect (stream cancel), removes the controller from clients.
 */
export function handleStream(_req: Request): Response {
  // Capture the controller from start() in a closure — cancel() receives the
  // cancel reason (not the controller), so we cannot use its parameter.
  let streamController: ReadableStreamDefaultController;
  const stream = new ReadableStream({
    start(controller) {
      streamController = controller;
      clients.add(controller);
    },
    cancel() {
      clients.delete(streamController);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Broadcast an event row to all connected SSE clients.
 * Dead clients (those that have already closed) are removed from the set.
 *
 * ch-u88: data is JSON.stringify()'d — never set via innerHTML.
 */
export function broadcast(event: EventRow): void {
  const message = encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
  for (const controller of clients) {
    try {
      controller.enqueue(message);
    } catch (err) {
      // TypeError with "closed" in the message is the normal case when the
      // client has disconnected. Any other error is unexpected — log it.
      const isClosedStream =
        err instanceof TypeError && err.message.toLowerCase().includes('close');
      if (!isClosedStream) {
        process.stderr.write(`[hookwatch] Unexpected SSE enqueue error: ${errorMsg(err)}\n`);
      }
      clients.delete(controller);
    }
  }
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/**
 * Close all connected SSE streams. Called during graceful server shutdown so
 * clients are not left hanging on a dead connection.
 * Exported for use by the server shutdown sequence.
 */
export function closeAll(): void {
  for (const controller of clients) {
    try {
      controller.close();
    } catch (err) {
      // TypeError with "closed" in the message means the stream is already
      // gone — expected during shutdown. Log anything else.
      const isAlreadyClosed =
        err instanceof TypeError && err.message.toLowerCase().includes('close');
      if (!isAlreadyClosed) {
        process.stderr.write(`[hookwatch] Unexpected SSE close error: ${errorMsg(err)}\n`);
      }
    }
  }
  clients.clear();
}
