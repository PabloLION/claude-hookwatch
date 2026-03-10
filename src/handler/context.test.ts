/**
 * Tests for src/handler/context.ts
 *
 * Coverage:
 * - getEventSubtype(): returns correct subtype string per event type
 * - getEventSubtype(): returns null for event types with no subtype
 * - buildSystemMessage(): formats "hookwatch captured <EventType> (<subtype>)"
 * - buildSystemMessage(): formats "hookwatch captured <EventType>" with no subtype
 * - systemMessage format in hook stdout (subprocess integration tests)
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { HookEvent } from "@/schemas/events.ts";
import { BASE_SESSION_START, createHandlerTestContext, runHandler, writePortFile } from "@/test";
import { buildSystemMessage, getEventSubtype } from "./context.ts";

// ---------------------------------------------------------------------------
// Unit tests: getEventSubtype
// ---------------------------------------------------------------------------

describe("getEventSubtype", () => {
  test("SessionStart returns source field", () => {
    const event = { hook_event_name: "SessionStart", source: "startup" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("startup");
  });

  test("SessionEnd returns reason field", () => {
    const event = { hook_event_name: "SessionEnd", reason: "normal" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("normal");
  });

  test("PreToolUse returns tool_name", () => {
    const event = { hook_event_name: "PreToolUse", tool_name: "Bash" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("Bash");
  });

  test("PostToolUse returns tool_name", () => {
    const event = { hook_event_name: "PostToolUse", tool_name: "Read" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("Read");
  });

  test("PostToolUseFailure returns tool_name", () => {
    const event = {
      hook_event_name: "PostToolUseFailure",
      tool_name: "Write",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("Write");
  });

  test("PermissionRequest returns tool_name", () => {
    const event = {
      hook_event_name: "PermissionRequest",
      tool_name: "Bash",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("Bash");
  });

  test("Notification returns notification_type", () => {
    const event = {
      hook_event_name: "Notification",
      notification_type: "info",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("info");
  });

  test("SubagentStart returns agent_type", () => {
    const event = {
      hook_event_name: "SubagentStart",
      agent_type: "coder",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("coder");
  });

  test("SubagentStop returns agent_type", () => {
    const event = {
      hook_event_name: "SubagentStop",
      agent_type: "coder",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("coder");
  });

  test("PreCompact returns trigger", () => {
    const event = {
      hook_event_name: "PreCompact",
      trigger: "manual",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("manual");
  });

  test("ConfigChange returns source", () => {
    const event = { hook_event_name: "ConfigChange", source: "user" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("user");
  });

  test("InstructionsLoaded returns trigger", () => {
    const event = {
      hook_event_name: "InstructionsLoaded",
      trigger: "startup",
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBe("startup");
  });

  test("Stop returns null (no subtype)", () => {
    const event = { hook_event_name: "Stop" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("UserPromptSubmit returns null (no subtype)", () => {
    const event = { hook_event_name: "UserPromptSubmit" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("TeammateIdle returns null (no subtype)", () => {
    const event = { hook_event_name: "TeammateIdle" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("TaskCompleted returns null (no subtype)", () => {
    const event = { hook_event_name: "TaskCompleted" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("WorktreeCreate returns null (no subtype)", () => {
    const event = { hook_event_name: "WorktreeCreate" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("WorktreeRemove returns null (no subtype)", () => {
    const event = { hook_event_name: "WorktreeRemove" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  // Runtime guard tests: missing fields must return null, not "undefined"
  test("SessionStart with missing source returns null, not 'undefined'", () => {
    const event = { hook_event_name: "SessionStart" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("PreToolUse with missing tool_name returns null, not 'undefined'", () => {
    const event = { hook_event_name: "PreToolUse" } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });

  test("Notification with non-string notification_type returns null", () => {
    const event = {
      hook_event_name: "Notification",
      notification_type: 42,
    } as unknown as HookEvent;
    expect(getEventSubtype(event)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit tests: buildSystemMessage
// ---------------------------------------------------------------------------

describe("buildSystemMessage", () => {
  test("formats message with subtype when subtype is present", () => {
    const event = {
      hook_event_name: "SessionStart",
      source: "startup",
    } as unknown as HookEvent;
    expect(buildSystemMessage(event)).toBe("hookwatch captured SessionStart (startup)");
  });

  test("formats message without parenthetical when subtype is null", () => {
    const event = { hook_event_name: "Stop" } as unknown as HookEvent;
    expect(buildSystemMessage(event)).toBe("hookwatch captured Stop");
  });

  test("formats PreToolUse with tool_name as subtype", () => {
    const event = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
    } as unknown as HookEvent;
    expect(buildSystemMessage(event)).toBe("hookwatch captured PreToolUse (Bash)");
  });

  test("formats PostToolUse with tool_name as subtype", () => {
    const event = {
      hook_event_name: "PostToolUse",
      tool_name: "Read",
    } as unknown as HookEvent;
    expect(buildSystemMessage(event)).toBe("hookwatch captured PostToolUse (Read)");
  });
});

// ---------------------------------------------------------------------------
// Integration tests: systemMessage in hook stdout (subprocess)
// ---------------------------------------------------------------------------

const ctx = createHandlerTestContext("hookwatch-context-test-");

beforeAll(() => {
  ctx.setup();
});

afterAll(() => {
  ctx.cleanup();
});

afterEach(() => {
  ctx.reset();
});

describe("systemMessage in hook stdout", () => {
  test("successful POST writes valid JSON hook output to stdout", async () => {
    const xdgHome = join(ctx.tmpDir, "stdout-success");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe("string");
    expect(parsed.systemMessage.length).toBeGreaterThan(0);
  });

  test("systemMessage is 'hookwatch captured SessionStart (startup)'", async () => {
    const xdgHome = join(ctx.tmpDir, "system-message-session-start");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe("hookwatch captured SessionStart (startup)");
  });

  test("systemMessage contains tool_name for PreToolUse", async () => {
    const xdgHome = join(ctx.tmpDir, "system-message-pre-tool-use");
    writePortFile(xdgHome, ctx.server.port);

    const preToolUseEvent = {
      session_id: "test-session-001",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/home/user/project",
      permission_mode: "default",
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "toolu_01ABC123",
      tool_input: { command: "ls" },
    };

    const result = await runHandler(JSON.stringify(preToolUseEvent), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe("hookwatch captured PreToolUse (Bash)");
  });

  test("systemMessage has no subtype for Stop", async () => {
    const xdgHome = join(ctx.tmpDir, "system-message-stop");
    writePortFile(xdgHome, ctx.server.port);

    const stopEvent = {
      session_id: "test-session-001",
      transcript_path: "/tmp/transcript.jsonl",
      cwd: "/home/user/project",
      permission_mode: "default",
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Done.",
    };

    const result = await runHandler(JSON.stringify(stopEvent), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe("hookwatch captured Stop");
  });

  test("stdout output validates against hookOutputSchema", async () => {
    const xdgHome = join(ctx.tmpDir, "stdout-schema-validate");
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // hookOutputSchema: continue (bool), systemMessage (string)
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe("string");
    expect(parsed.systemMessage.length).toBeGreaterThan(0);
  });
});
