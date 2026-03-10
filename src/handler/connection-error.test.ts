/**
 * Unit tests for isConnectionError() in src/handler/post-event.ts.
 *
 * isConnectionError() classifies thrown values as connection-refusal errors
 * that should trigger the auto-start+retry path in postEvent(). It matches
 * 7 patterns across Bun and Node.js error shapes.
 *
 * Coverage:
 * - non-Error values (string, number, null, plain object) → false
 * - Bun code "ConnectionRefused" → true
 * - Node.js code "ECONNREFUSED" → true
 * - message "connection refused" (case-insensitive) → true
 * - message "econnrefused" (case-insensitive) → true
 * - message "unable to connect" (case-insensitive) → true
 * - message "failed to fetch" (case-insensitive) → true
 * - message "fetch failed" (case-insensitive) → true
 * - timeout / abort signal errors → false (non-matching code/message)
 * - generic Error with no relevant message → false
 */

import { describe, expect, test } from "bun:test";
import { isConnectionError } from "./post-event.ts";

// ---------------------------------------------------------------------------
// Helper to build an error with an optional .code property
// ---------------------------------------------------------------------------

function makeCodeError(message: string, code?: string): Error {
  const err = new Error(message);
  if (code !== undefined) {
    (err as NodeJS.ErrnoException).code = code;
  }
  return err;
}

// ---------------------------------------------------------------------------
// Non-Error values
// ---------------------------------------------------------------------------

describe("non-Error thrown values", () => {
  test("string thrown → false", () => {
    expect(isConnectionError("connection refused")).toBe(false);
  });

  test("number thrown → false", () => {
    expect(isConnectionError(42)).toBe(false);
  });

  test("null thrown → false", () => {
    expect(isConnectionError(null)).toBe(false);
  });

  test("plain object thrown → false", () => {
    expect(isConnectionError({ code: "ConnectionRefused" })).toBe(false);
  });

  test("undefined thrown → false", () => {
    expect(isConnectionError(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Code-based matches
// ---------------------------------------------------------------------------

describe("error code matching", () => {
  test('Bun code "ConnectionRefused" → true', () => {
    const err = makeCodeError(
      "Unable to connect. Is the computer able to access the url?",
      "ConnectionRefused",
    );
    expect(isConnectionError(err)).toBe(true);
  });

  test('Node code "ECONNREFUSED" → true', () => {
    const err = makeCodeError("connect ECONNREFUSED 127.0.0.1:6004", "ECONNREFUSED");
    expect(isConnectionError(err)).toBe(true);
  });

  test('unrelated OS code "ENOENT" → false', () => {
    const err = makeCodeError("no such file or directory", "ENOENT");
    expect(isConnectionError(err)).toBe(false);
  });

  test('unrelated OS code "EACCES" → false', () => {
    const err = makeCodeError("permission denied", "EACCES");
    expect(isConnectionError(err)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Message-based matches (case-insensitive)
// ---------------------------------------------------------------------------

describe("message matching — 'connection refused'", () => {
  test("lowercase message → true", () => {
    expect(isConnectionError(new Error("connection refused to 127.0.0.1:6004"))).toBe(true);
  });

  test("uppercase message → true", () => {
    expect(isConnectionError(new Error("CONNECTION REFUSED"))).toBe(true);
  });

  test("mixed-case message → true", () => {
    expect(isConnectionError(new Error("Connection Refused by remote host"))).toBe(true);
  });
});

describe("message matching — 'econnrefused'", () => {
  test("lowercase message → true", () => {
    expect(isConnectionError(new Error("econnrefused 127.0.0.1"))).toBe(true);
  });

  test("uppercase ECONNREFUSED in message (no code) → true", () => {
    expect(isConnectionError(new Error("Error: ECONNREFUSED"))).toBe(true);
  });
});

describe("message matching — 'unable to connect'", () => {
  test("Bun-style message → true", () => {
    expect(
      isConnectionError(new Error("Unable to connect. Is the computer able to access the url?")),
    ).toBe(true);
  });

  test("uppercase variant → true", () => {
    expect(isConnectionError(new Error("UNABLE TO CONNECT"))).toBe(true);
  });
});

describe("message matching — 'failed to fetch'", () => {
  test("browser-style message → true", () => {
    expect(isConnectionError(new Error("Failed to fetch"))).toBe(true);
  });

  test("lowercase → true", () => {
    expect(isConnectionError(new Error("failed to fetch resource"))).toBe(true);
  });
});

describe("message matching — 'fetch failed'", () => {
  test("Node-fetch-style message → true", () => {
    expect(isConnectionError(new Error("fetch failed"))).toBe(true);
  });

  test("uppercase → true", () => {
    expect(isConnectionError(new Error("FETCH FAILED"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Non-matching errors (should NOT trigger auto-start)
// ---------------------------------------------------------------------------

describe("non-matching errors", () => {
  test("generic Error with unrelated message → false", () => {
    expect(isConnectionError(new Error("Internal server error"))).toBe(false);
  });

  test("timeout / AbortError → false", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(isConnectionError(err)).toBe(false);
  });

  test("AbortError → false", () => {
    const err = new Error("signal is aborted without reason");
    err.name = "AbortError";
    expect(isConnectionError(err)).toBe(false);
  });

  test("plain Error with empty message → false", () => {
    expect(isConnectionError(new Error(""))).toBe(false);
  });

  test("Error with code but no message match → false (code must also not match)", () => {
    const err = makeCodeError("some other network issue", "ETIMEDOUT");
    expect(isConnectionError(err)).toBe(false);
  });
});
