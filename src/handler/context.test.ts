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

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type {
  CommonFields,
  ConfigChange,
  InstructionsLoaded,
  Notification,
  PermissionRequest,
  PostToolUse,
  PostToolUseFailure,
  PreCompact,
  PreToolUse,
  SessionEnd,
  SessionStart,
  Stop,
  SubagentStart,
  SubagentStop,
  TaskCompleted,
  TeammateIdle,
  UserPromptSubmit,
  WorktreeCreate,
  WorktreeRemove,
} from '@/schemas/events.ts';
import { SCHEMA_MAP } from '@/schemas/events.ts';
import { BASE_SESSION_START, GENERIC_EVENT_BASE } from '@/test/fixtures.ts';
import { createHandlerTestContext } from '@/test/setup.ts';
import { runHandler } from '@/test/subprocess.ts';
import { writePortFile } from '@/test/test-server.ts';
import { buildSystemMessage, getEventSubtype, SUBTYPE_FIELD } from './context.ts';

// ---------------------------------------------------------------------------
// Unit tests: getEventSubtype
// ---------------------------------------------------------------------------

/** Common fields shared by every HookEvent — avoids repetition across fixtures. */
const TEST_COMMON = {
  session_id: 'test-session-apple',
  transcript_path: '/test/transcript.jsonl',
  cwd: '/test/cwd',
  permission_mode: 'default',
} as const;

describe('getEventSubtype', () => {
  test('SessionStart returns source field', () => {
    const event: SessionStart = {
      ...TEST_COMMON,
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'test-model',
    };
    expect(getEventSubtype(event)).toBe('startup');
  });

  test('SessionEnd returns reason field', () => {
    const event: SessionEnd = {
      ...TEST_COMMON,
      hook_event_name: 'SessionEnd',
      reason: 'other',
    };
    expect(getEventSubtype(event)).toBe('other');
  });

  test('PreToolUse returns tool_name', () => {
    const event: PreToolUse = {
      ...TEST_COMMON,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_test',
      tool_input: {},
    };
    expect(getEventSubtype(event)).toBe('Bash');
  });

  test('PostToolUse returns tool_name', () => {
    const event: PostToolUse = {
      ...TEST_COMMON,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: 'toolu_test',
      tool_input: {},
      tool_response: {},
    };
    expect(getEventSubtype(event)).toBe('Read');
  });

  test('PostToolUseFailure returns tool_name', () => {
    const event: PostToolUseFailure = {
      ...TEST_COMMON,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Write',
      tool_use_id: 'toolu_test',
      tool_input: {},
      error: 'test error',
    };
    expect(getEventSubtype(event)).toBe('Write');
  });

  test('PermissionRequest returns tool_name', () => {
    const event: PermissionRequest = {
      ...TEST_COMMON,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: {},
    };
    expect(getEventSubtype(event)).toBe('Bash');
  });

  test('Notification returns notification_type', () => {
    const event: Notification = {
      ...TEST_COMMON,
      hook_event_name: 'Notification',
      message: 'test',
      notification_type: 'permission_prompt',
    };
    expect(getEventSubtype(event)).toBe('permission_prompt');
  });

  test('SubagentStart returns agent_type', () => {
    const event: SubagentStart = {
      ...TEST_COMMON,
      hook_event_name: 'SubagentStart',
      agent_id: 'agent-test',
      agent_type: 'coder',
    };
    expect(getEventSubtype(event)).toBe('coder');
  });

  test('SubagentStop returns agent_type', () => {
    const event: SubagentStop = {
      ...TEST_COMMON,
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-test',
      agent_type: 'coder',
      stop_hook_active: false,
      agent_transcript_path: '/test/transcript.jsonl',
      last_assistant_message: 'Done.',
    };
    expect(getEventSubtype(event)).toBe('coder');
  });

  test('PreCompact returns trigger', () => {
    const event: PreCompact = {
      ...TEST_COMMON,
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      custom_instructions: '',
    };
    expect(getEventSubtype(event)).toBe('manual');
  });

  test('ConfigChange returns source', () => {
    const event: ConfigChange = {
      ...TEST_COMMON,
      hook_event_name: 'ConfigChange',
      source: 'user_settings',
    };
    expect(getEventSubtype(event)).toBe('user_settings');
  });

  test('InstructionsLoaded returns trigger', () => {
    const event: InstructionsLoaded = {
      ...TEST_COMMON,
      hook_event_name: 'InstructionsLoaded',
      trigger: 'init',
    };
    expect(getEventSubtype(event)).toBe('init');
  });

  test('Stop returns null (no subtype)', () => {
    const event: Stop = {
      ...TEST_COMMON,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done.',
    };
    expect(getEventSubtype(event)).toBeNull();
  });

  test('UserPromptSubmit returns null (no subtype)', () => {
    const event: UserPromptSubmit = {
      ...TEST_COMMON,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'test prompt',
    };
    expect(getEventSubtype(event)).toBeNull();
  });

  test('TeammateIdle returns null (no subtype)', () => {
    const event: TeammateIdle = {
      ...TEST_COMMON,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'Alice',
      team_name: 'dev-team',
    };
    expect(getEventSubtype(event)).toBeNull();
  });

  test('TaskCompleted returns null (no subtype)', () => {
    const event: TaskCompleted = {
      ...TEST_COMMON,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-1',
      task_subject: 'Test task',
    };
    expect(getEventSubtype(event)).toBeNull();
  });

  test('WorktreeCreate returns null (no subtype)', () => {
    const event: WorktreeCreate = {
      ...TEST_COMMON,
      hook_event_name: 'WorktreeCreate',
      name: 'test-worktree',
    };
    expect(getEventSubtype(event)).toBeNull();
  });

  test('WorktreeRemove returns null (no subtype)', () => {
    const event: WorktreeRemove = {
      ...TEST_COMMON,
      hook_event_name: 'WorktreeRemove',
      worktree_path: '/test/worktree',
    };
    expect(getEventSubtype(event)).toBeNull();
  });

  // Runtime guard tests: missing fields must return null, not "undefined".
  // These use CommonFields (which satisfies the UnknownEvent branch of HookEvent)
  // to represent malformed data that lacks event-specific required fields.
  test("SessionStart with missing source returns null, not 'undefined'", () => {
    const event: CommonFields = { ...TEST_COMMON, hook_event_name: 'SessionStart' };
    expect(getEventSubtype(event)).toBeNull();
  });

  test("PreToolUse with missing tool_name returns null, not 'undefined'", () => {
    const event: CommonFields = { ...TEST_COMMON, hook_event_name: 'PreToolUse' };
    expect(getEventSubtype(event)).toBeNull();
  });

  test('Notification with non-string notification_type returns null', () => {
    const event: CommonFields = {
      ...TEST_COMMON,
      hook_event_name: 'Notification',
      notification_type: 42,
    };
    expect(getEventSubtype(event)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SUBTYPE_FIELD schema validation
// ---------------------------------------------------------------------------

/**
 * Verifies that each value in SUBTYPE_FIELD (a field name string) exists as a
 * key in the corresponding Zod event schema from SCHEMA_MAP. Catches typos in
 * SUBTYPE_FIELD values at test time rather than at runtime.
 */
describe('SUBTYPE_FIELD schema validation', () => {
  test('each SUBTYPE_FIELD value is a valid key in the corresponding SCHEMA_MAP schema', () => {
    for (const [eventName, fieldName] of Object.entries(SUBTYPE_FIELD)) {
      const schema = SCHEMA_MAP[eventName as keyof typeof SCHEMA_MAP];
      // schema must exist (SUBTYPE_FIELD keys must be in SCHEMA_MAP)
      expect(schema, `SCHEMA_MAP missing entry for "${eventName}"`).toBeDefined();
      // Zod v4: shape is at schema.def.shape (not schema.shape)
      const def = (schema as unknown as { def?: { shape?: Record<string, unknown> } }).def;
      expect(def?.shape, `schema for "${eventName}" has no .def.shape`).toBeDefined();
      expect(
        def?.shape?.[fieldName],
        `SUBTYPE_FIELD["${eventName}"] = "${fieldName}" but that field is not in ${eventName} schema`,
      ).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests: buildSystemMessage
// ---------------------------------------------------------------------------

/** Expected systemMessage for Stop events (no subtype). */
const CAPTURED_STOP = 'hookwatch captured Stop';

describe('buildSystemMessage', () => {
  const sessionStartEvent: SessionStart = {
    ...TEST_COMMON,
    hook_event_name: 'SessionStart',
    source: 'startup',
    model: 'test-model',
  };

  const stopEvent: Stop = {
    ...TEST_COMMON,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: 'Done.',
  };

  const preToolUseEvent: PreToolUse = {
    ...TEST_COMMON,
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'toolu_test',
    tool_input: {},
  };

  const postToolUseEvent: PostToolUse = {
    ...TEST_COMMON,
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_use_id: 'toolu_test',
    tool_input: {},
    tool_response: {},
  };

  test('formats message with subtype when subtype is present', () => {
    expect(buildSystemMessage(sessionStartEvent)).toBe('hookwatch captured SessionStart (startup)');
  });

  test('formats message without parenthetical when subtype is null', () => {
    expect(buildSystemMessage(stopEvent)).toBe(CAPTURED_STOP);
  });

  test('formats PreToolUse with tool_name as subtype', () => {
    expect(buildSystemMessage(preToolUseEvent)).toBe('hookwatch captured PreToolUse (Bash)');
  });

  test('formats PostToolUse with tool_name as subtype', () => {
    expect(buildSystemMessage(postToolUseEvent)).toBe('hookwatch captured PostToolUse (Read)');
  });

  test('appends single log entry after em-dash when logEntries provided', () => {
    expect(buildSystemMessage(stopEvent, ['[error] Server returned HTTP 500'])).toBe(
      `${CAPTURED_STOP} — [error] Server returned HTTP 500`,
    );
  });

  test('appends multiple log entries joined by semicolon', () => {
    expect(buildSystemMessage(stopEvent, ['[error] first', '[warn] second'])).toBe(
      `${CAPTURED_STOP} — [error] first; [warn] second`,
    );
  });

  test('returns base message when logEntries is empty array', () => {
    expect(buildSystemMessage(stopEvent, [])).toBe(CAPTURED_STOP);
  });

  test('returns base message when logEntries is undefined', () => {
    expect(buildSystemMessage(stopEvent)).toBe(CAPTURED_STOP);
  });

  test('appends log entries to message that has a subtype', () => {
    expect(
      buildSystemMessage(sessionStartEvent, ['[error] Spawn failed — server did not start']),
    ).toBe(
      'hookwatch captured SessionStart (startup) — [error] Spawn failed — server did not start',
    );
  });
});

// ---------------------------------------------------------------------------
// Integration tests: systemMessage in hook stdout (subprocess)
// ---------------------------------------------------------------------------

const ctx = createHandlerTestContext('hookwatch-context-test-', beforeAll, afterAll);

afterEach(() => {
  ctx.reset();
});

describe('systemMessage in hook stdout', () => {
  test('successful POST writes valid JSON hook output to stdout', async () => {
    const xdgHome = join(ctx.tmpDir, 'stdout-success');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
    expect(parsed.systemMessage.length).toBeGreaterThan(0);
  });

  test("systemMessage is 'hookwatch captured SessionStart (startup)'", async () => {
    const xdgHome = join(ctx.tmpDir, 'system-message-session-start');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe('hookwatch captured SessionStart (startup)');
  });

  test('systemMessage contains tool_name for PreToolUse', async () => {
    const xdgHome = join(ctx.tmpDir, 'system-message-pre-tool-use');
    writePortFile(xdgHome, ctx.server.port);

    const preToolUseEvent = {
      ...GENERIC_EVENT_BASE,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'ls' },
    };

    const result = await runHandler(JSON.stringify(preToolUseEvent), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe('hookwatch captured PreToolUse (Bash)');
  });

  test('systemMessage has no subtype for Stop', async () => {
    const xdgHome = join(ctx.tmpDir, 'system-message-stop');
    writePortFile(xdgHome, ctx.server.port);

    const stopEvent = {
      ...GENERIC_EVENT_BASE,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Done.',
    };

    const result = await runHandler(JSON.stringify(stopEvent), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.systemMessage).toBe('hookwatch captured Stop');
  });

  test('stdout output validates against hookOutputSchema', async () => {
    const xdgHome = join(ctx.tmpDir, 'stdout-schema-validate');
    writePortFile(xdgHome, ctx.server.port);

    const result = await runHandler(JSON.stringify(BASE_SESSION_START), {
      XDG_DATA_HOME: xdgHome,
    });

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    // hookOutputSchema: continue (bool), systemMessage (string)
    expect(parsed.continue).toBe(true);
    expect(typeof parsed.systemMessage).toBe('string');
    expect(parsed.systemMessage.length).toBeGreaterThan(0);
  });
});
