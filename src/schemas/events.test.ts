/**
 * Tests for src/schemas/events.ts
 *
 * Coverage:
 * - Each of the 18 event types parses a valid payload
 * - Unknown fields are preserved (.loose())
 * - Unknown event types fall through to fallback schema
 * - Missing required fields produce a ZodError
 * - PermissionRequest has no tool_use_id
 */

import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { expectEventType, type ParsedEventFields } from '@/test/types.ts';
import {
  type ConfigChange,
  commonFieldsSchema,
  type InstructionsLoaded,
  type Notification,
  type PermissionRequest,
  type PostToolUse,
  type PostToolUseFailure,
  type PreCompact,
  type PreToolUse,
  parseHookEvent,
  postToolUseSchema,
  preToolUseSchema,
  type SessionEnd,
  type SessionStart,
  type Stop,
  type SubagentStart,
  type SubagentStop,
  sessionEndSchema,
  sessionStartSchema,
  type TaskCompleted,
  type TeammateIdle,
  type UserPromptSubmit,
  type WorktreeCreate,
  type WorktreeRemove,
} from './events.ts';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

/** Standard test description for the happy-path parse test in every event type suite. */
const VALID_PAYLOAD_TEST_NAME = 'valid payload parses successfully';
/** Model string used in SessionStart / PreCompact / Stop tests. */
const TEST_MODEL = 'claude-sonnet-4-6';
/** Transcript path used in the base fixture and standalone validation tests. */
const TEST_TRANSCRIPT_PATH = '/home/user/.claude/transcript.jsonl';
/** Arbitrary numeric value used in .loose() tests — must not conflict with real field values. */
const PASSTHROUGH_EXTRA_NUMBER = 42;

// ---------------------------------------------------------------------------
// Shared base fields for test payloads
// ---------------------------------------------------------------------------

const base = {
  session_id: 'f8b0e97c-a19e-461a-8290-05a5c03d3d8f',
  transcript_path: TEST_TRANSCRIPT_PATH,
  cwd: '/home/user/project',
  permission_mode: 'default',
};

// ---------------------------------------------------------------------------
// Acceptance criterion 1: parseHookEvent routes by hook_event_name
// and known fields are typed + validated
// ---------------------------------------------------------------------------

describe('parseHookEvent — SessionStart', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: TEST_MODEL,
    });
    const typed = expectEventType<SessionStart>(result, 'SessionStart');
    expect(typed.source).toBe('startup');
  });

  test('optional agent_type field is preserved when present', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'resume',
      model: TEST_MODEL,
      agent_type: 'Explore',
    });
    const typed = expectEventType<SessionStart>(result, 'SessionStart');
    expect(typed.agent_type).toBe('Explore');
  });
});

describe('parseHookEvent — SessionEnd', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionEnd',
      reason: 'logout',
    });
    const typed = expectEventType<SessionEnd>(result, 'SessionEnd');
    expect(typed.reason).toBe('logout');
  });
});

describe('parseHookEvent — UserPromptSubmit', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Hello Claude',
    });
    const typed = expectEventType<UserPromptSubmit>(result, 'UserPromptSubmit');
    expect(typed.prompt).toBe('Hello Claude');
  });
});

describe('parseHookEvent — PreToolUse', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'ls -la' },
    });
    const typed = expectEventType<PreToolUse>(result, 'PreToolUse');
    expect(typed.tool_name).toBe('Bash');
  });
});

describe('parseHookEvent — PostToolUse', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { file_path: '/etc/hosts' },
      tool_response: { content: '127.0.0.1 localhost' },
    });
    const typed = expectEventType<PostToolUse>(result, 'PostToolUse');
    expect(typed.tool_name).toBe('Read');
  });
});

describe('parseHookEvent — PostToolUseFailure', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'bad-cmd' },
      error: 'command not found',
    });
    const typed = expectEventType<PostToolUseFailure>(result, 'PostToolUseFailure');
    expect(typed.error).toBe('command not found');
  });

  test('optional is_interrupt field is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'sleep 100' },
      error: 'interrupted',
      is_interrupt: true,
    });
    const typed = expectEventType<PostToolUseFailure>(result, 'PostToolUseFailure');
    expect(typed.is_interrupt).toBe(true);
  });
});

describe('parseHookEvent — PermissionRequest', () => {
  test('valid payload parses successfully without tool_use_id', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/test' },
    });
    const typed = expectEventType<PermissionRequest>(result, 'PermissionRequest');
    expect(typed.tool_name).toBe('Bash');
    // PermissionRequest has no tool_use_id — verify it is not set
    const fields = result as ParsedEventFields;
    expect(fields.tool_use_id).toBeUndefined();
  });

  test('optional permission_suggestions field is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/test' },
      permission_suggestions: [{ type: 'toolAlwaysAllow', tool: 'Bash' }],
    });
    const typed = expectEventType<PermissionRequest>(result, 'PermissionRequest');
    expect(typed.permission_suggestions).toHaveLength(1);
  });
});

describe('parseHookEvent — Notification', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'Notification',
      message: 'Permission required',
      notification_type: 'permission_prompt',
    });
    const typed = expectEventType<Notification>(result, 'Notification');
    expect(typed.notification_type).toBe('permission_prompt');
  });

  test('optional title field is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'Notification',
      message: 'Info',
      title: 'My Title',
      notification_type: 'auth_success',
    });
    const typed = expectEventType<Notification>(result, 'Notification');
    expect(typed.title).toBe('My Title');
  });
});

describe('parseHookEvent — SubagentStart', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SubagentStart',
      agent_id: 'agent-001',
      agent_type: 'Explore',
    });
    const typed = expectEventType<SubagentStart>(result, 'SubagentStart');
    expect(typed.agent_id).toBe('agent-001');
  });
});

describe('parseHookEvent — SubagentStop', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-001',
      agent_type: 'Explore',
      stop_hook_active: false,
      agent_transcript_path: '/home/user/.claude/subagents/agent-001.jsonl',
      last_assistant_message: 'Done.',
    });
    const typed = expectEventType<SubagentStop>(result, 'SubagentStop');
    expect(typed.stop_hook_active).toBe(false);
  });
});

describe('parseHookEvent — Stop', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'Task complete.',
    });
    const typed = expectEventType<Stop>(result, 'Stop');
    expect(typed.stop_hook_active).toBe(true);
  });
});

describe('parseHookEvent — PreCompact', () => {
  test('valid payload parses successfully for manual trigger', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreCompact',
      trigger: 'manual',
      custom_instructions: 'Focus on the last 10 messages',
    });
    const typed = expectEventType<PreCompact>(result, 'PreCompact');
    expect(typed.trigger).toBe('manual');
  });

  test('auto trigger with empty custom_instructions', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: '',
    });
    const typed = expectEventType<PreCompact>(result, 'PreCompact');
    expect(typed.trigger).toBe('auto');
  });
});

describe('parseHookEvent — TeammateIdle', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'Alice',
      team_name: 'dev-team',
    });
    const typed = expectEventType<TeammateIdle>(result, 'TeammateIdle');
    expect(typed.teammate_name).toBe('Alice');
  });
});

describe('parseHookEvent — TaskCompleted', () => {
  test('valid payload parses successfully with required fields only', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-42',
      task_subject: 'Deploy to staging',
    });
    const typed = expectEventType<TaskCompleted>(result, 'TaskCompleted');
    expect(typed.task_id).toBe('task-42');
  });

  test('optional fields are preserved when present', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'TaskCompleted',
      task_id: 'task-42',
      task_subject: 'Deploy to staging',
      task_description: 'Detailed description',
      teammate_name: 'Bob',
      team_name: 'ops-team',
    });
    const typed = expectEventType<TaskCompleted>(result, 'TaskCompleted');
    expect(typed.teammate_name).toBe('Bob');
  });
});

describe('parseHookEvent — ConfigChange', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'ConfigChange',
      source: 'user_settings',
    });
    const typed = expectEventType<ConfigChange>(result, 'ConfigChange');
    expect(typed.source).toBe('user_settings');
  });

  test('optional file_path is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'ConfigChange',
      source: 'project_settings',
      file_path: '/home/user/project/.claude/settings.json',
    });
    const typed = expectEventType<ConfigChange>(result, 'ConfigChange');
    expect(typed.file_path).toBe('/home/user/project/.claude/settings.json');
  });
});

describe('parseHookEvent — WorktreeCreate', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'WorktreeCreate',
      name: 'bold-oak-a3f2',
    });
    const typed = expectEventType<WorktreeCreate>(result, 'WorktreeCreate');
    expect(typed.name).toBe('bold-oak-a3f2');
  });
});

describe('parseHookEvent — WorktreeRemove', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'WorktreeRemove',
      worktree_path: '/home/user/project/.git/worktrees/bold-oak-a3f2',
    });
    const typed = expectEventType<WorktreeRemove>(result, 'WorktreeRemove');
    expect(typed.worktree_path).toBe('/home/user/project/.git/worktrees/bold-oak-a3f2');
  });
});

describe('parseHookEvent — InstructionsLoaded', () => {
  test(VALID_PAYLOAD_TEST_NAME, () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'InstructionsLoaded',
      trigger: 'init',
    });
    const typed = expectEventType<InstructionsLoaded>(result, 'InstructionsLoaded');
    expect(typed.trigger).toBe('init');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1: unknown fields are preserved (.loose())
// ---------------------------------------------------------------------------

describe('.loose() — unknown fields are preserved', () => {
  test('PreToolUse preserves unknown fields', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'echo hi' },
      future_sdk_field: 'preserved',
    });
    const fields = result as ParsedEventFields;
    expect(fields.future_sdk_field).toBe('preserved');
  });

  test('SessionStart preserves unknown fields', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: TEST_MODEL,
      extra: PASSTHROUGH_EXTRA_NUMBER,
    });
    const fields = result as ParsedEventFields;
    expect(fields.extra).toBe(PASSTHROUGH_EXTRA_NUMBER);
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 2: unknown event types pass using fallback schema
// ---------------------------------------------------------------------------

describe('fallback schema — unknown event types', () => {
  test('FutureEvent with common fields passes validation', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'FutureEvent',
      some_new_field: 'new_value',
    });
    expect(result.hook_event_name).toBe('FutureEvent');
    const fields = result as ParsedEventFields;
    expect(fields.some_new_field).toBe('new_value');
  });

  test('empty string hook_event_name uses fallback', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: '',
    });
    expect(result.hook_event_name).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 3: missing required fields fail with ZodError
// ---------------------------------------------------------------------------

describe('validation failure — missing required fields', () => {
  test('missing session_id fails', () => {
    expect(() =>
      parseHookEvent({
        transcript_path: TEST_TRANSCRIPT_PATH,
        cwd: '/home/user/project',
        permission_mode: 'default',
        hook_event_name: 'FutureEvent',
      }),
    ).toThrow(ZodError);
  });

  test('missing cwd fails', () => {
    expect(() =>
      parseHookEvent({
        session_id: 'f8b0e97c-a19e-461a-8290-05a5c03d3d8f',
        transcript_path: TEST_TRANSCRIPT_PATH,
        permission_mode: 'default',
        hook_event_name: 'FutureEvent',
      }),
    ).toThrow(ZodError);
  });

  test('missing required PreToolUse fields fails', () => {
    expect(() =>
      parseHookEvent({
        ...base,
        hook_event_name: 'PreToolUse',
        // tool_name, tool_use_id, tool_input all missing
      }),
    ).toThrow(ZodError);
  });

  test('missing required SessionStart source field fails', () => {
    expect(() =>
      parseHookEvent({
        ...base,
        hook_event_name: 'SessionStart',
        model: TEST_MODEL,
        // source is missing
      }),
    ).toThrow(ZodError);
  });

  test('invalid enum value for SessionStart source fails', () => {
    expect(() =>
      sessionStartSchema.parse({
        ...base,
        hook_event_name: 'SessionStart',
        source: 'invalid_source',
        model: TEST_MODEL,
      }),
    ).toThrow(ZodError);
  });

  test('invalid enum value for SessionEnd reason fails', () => {
    expect(() =>
      sessionEndSchema.parse({
        ...base,
        hook_event_name: 'SessionEnd',
        reason: 'unknown_reason',
      }),
    ).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// Schema-level direct parse tests (spot checks)
// ---------------------------------------------------------------------------

describe('commonFieldsSchema', () => {
  test('parses minimal common fields', () => {
    const result = commonFieldsSchema.parse({
      ...base,
      hook_event_name: 'SomeEvent',
    });
    expect(result.session_id).toBe(base.session_id);
  });
});

describe('preToolUseSchema direct parse', () => {
  test('valid payload parses with correct types', () => {
    const result = preToolUseSchema.parse({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 'toolu_XYZ',
      tool_input: { file_path: '/tmp/x.ts', content: 'hello' },
    });
    expect(result.tool_input).toEqual({ file_path: '/tmp/x.ts', content: 'hello' });
  });
});

describe('postToolUseSchema direct parse', () => {
  test('tool_response is preserved as record', () => {
    const result = postToolUseSchema.parse({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_ABC',
      tool_input: { command: 'echo hi' },
      tool_response: { output: 'hi\n', exit_code: 0 },
    });
    const response = result.tool_response as ParsedEventFields;
    expect(response.exit_code).toBe(0);
  });
});
