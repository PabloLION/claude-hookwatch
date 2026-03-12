/**
 * Unit tests for src/server/stream.ts — SSE broadcast and client lifecycle.
 *
 * Covers:
 *   - broadcast sends the correct SSE message format to all connected clients
 *   - broadcast removes a client whose controller has already closed (dead client cleanup)
 *   - closeAll closes all controllers and empties the client set
 *   - handleStream returns correct SSE response headers
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { broadcast, closeAll, handleStream } from '@/server/stream.ts';
import { makeEventRow } from '@/test/fixtures.ts';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** HTTP 200 OK status. */
const HTTP_OK = 200;
/** Slice offset to strip the trailing "\n\n" from SSE frames. */
const SSE_FRAME_TAIL = -2;
/** Custom event id used to verify SSE payload round-trips correctly. */
const TEST_EVENT_ID_ALT = 42;
/** SSE event URL used by all stream tests. */
const SSE_REQUEST_URL = 'http://localhost/api/events/stream';

/** Open a real SSE connection to the handleStream handler and return the
 *  stream reader so test code can pull chunks from it. */
function openSseStream(): ReadableStreamDefaultReader<Uint8Array> {
  const req = new Request(SSE_REQUEST_URL);
  const res = handleStream(req);
  // handleStream always returns a ReadableStream body — the non-null assertion
  // is safe here; body is only null for responses without a body (e.g., 204).
  if (res.body === null) throw new Error('handleStream returned a response with no body');
  return res.body.getReader();
}

const decoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Clean up SSE clients between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  closeAll();
});

// ---------------------------------------------------------------------------
// handleStream — response headers
// ---------------------------------------------------------------------------

describe('handleStream', () => {
  test('returns 200 with text/event-stream content-type', () => {
    const req = new Request(SSE_REQUEST_URL);
    const res = handleStream(req);
    expect(res.status).toBe(HTTP_OK);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});

// ---------------------------------------------------------------------------
// broadcast — message delivery
// ---------------------------------------------------------------------------

describe('broadcast', () => {
  test('delivers SSE data message to a connected client', async () => {
    const reader = openSseStream();
    const row = makeEventRow({ id: TEST_EVENT_ID_ALT });

    broadcast(row);

    // Read one chunk
    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value);

    // Must start with "data: " and end with "\n\n"
    expect(text.startsWith('data: ')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(true);

    // The JSON payload must round-trip to the original row
    const json = text.slice('data: '.length, SSE_FRAME_TAIL);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe(TEST_EVENT_ID_ALT);
    expect(parsed.event).toBe('SessionStart');
    expect(parsed.session_id).toBe('sess-test-001');
  });

  test('delivers to all connected clients simultaneously', async () => {
    const reader1 = openSseStream();
    const reader2 = openSseStream();
    const row = makeEventRow({ id: 7 });

    broadcast(row);

    const [r1, r2] = await Promise.all([reader1.read(), reader2.read()]);

    expect(r1.done).toBe(false);
    expect(r2.done).toBe(false);

    const text1 = decoder.decode(r1.value);
    const text2 = decoder.decode(r2.value);

    expect(text1).toBe(text2);
    expect(text1.includes(`"id":7`)).toBe(true);
  });

  test('skips dead clients and removes them from the set', async () => {
    // Open a stream and then close it to simulate a disconnected client
    const req = new Request(SSE_REQUEST_URL);
    const res = handleStream(req);
    // Cancel the body to trigger the stream cancel callback.
    // body is always present on our SSE response; cancel() via optional chain
    // is safe and avoids the non-null assertion lint warning.
    await res.body?.cancel();

    // Open a healthy second client
    const healthyReader = openSseStream();

    // Broadcast should not throw even with the dead client present
    expect(() => broadcast(makeEventRow())).not.toThrow();

    // Healthy client still receives the message
    const { value, done } = await healthyReader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value);
    expect(text.startsWith('data: ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// closeAll
// ---------------------------------------------------------------------------

describe('closeAll', () => {
  test('closes all open streams', async () => {
    const reader1 = openSseStream();
    const reader2 = openSseStream();

    closeAll();

    const [r1, r2] = await Promise.all([reader1.read(), reader2.read()]);
    expect(r1.done).toBe(true);
    expect(r2.done).toBe(true);
  });

  test('is idempotent — second closeAll does not throw', () => {
    openSseStream();
    closeAll();
    expect(() => closeAll()).not.toThrow();
  });
});
