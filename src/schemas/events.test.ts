/**
 * Tests for src/schemas/events.ts
 *
 * Coverage:
 * - Each of the 18 event types parses a valid payload
 * - Unknown fields are preserved (passthrough)
 * - Unknown event types fall through to fallback schema
 * - Missing required fields produce a ZodError
 * - PermissionRequest has no tool_use_id
 */

import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import {
  commonFieldsSchema,
  parseHookEvent,
  postToolUseSchema,
  preToolUseSchema,
  sessionEndSchema,
  sessionStartSchema,
} from './events.ts';

// ---------------------------------------------------------------------------
// Shared base fields for test payloads
// ---------------------------------------------------------------------------

const base = {
  session_id: 'f8b0e97c-a19e-461a-8290-05a5c03d3d8f',
  transcript_path: '/home/user/.claude/transcript.jsonl',
  cwd: '/home/user/project',
  permission_mode: 'default',
};

// ---------------------------------------------------------------------------
// Acceptance criterion 1: parseHookEvent routes by hook_event_name
// and known fields are typed + validated
// ---------------------------------------------------------------------------

describe('parseHookEvent — SessionStart', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'claude-sonnet-4-6',
    });
    expect(result.hook_event_name).toBe('SessionStart');
    expect((result as { source: string }).source).toBe('startup');
  });

  test('optional agent_type field is preserved when present', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'resume',
      model: 'claude-sonnet-4-6',
      agent_type: 'Explore',
    });
    expect((result as { agent_type?: string }).agent_type).toBe('Explore');
  });
});

describe('parseHookEvent — SessionEnd', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionEnd',
      reason: 'logout',
    });
    expect((result as { reason: string }).reason).toBe('logout');
  });
});

describe('parseHookEvent — UserPromptSubmit', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'Hello Claude',
    });
    expect((result as { prompt: string }).prompt).toBe('Hello Claude');
  });
});

describe('parseHookEvent — PreToolUse', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'ls -la' },
    });
    expect((result as { tool_name: string }).tool_name).toBe('Bash');
  });
});

describe('parseHookEvent — PostToolUse', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { file_path: '/etc/hosts' },
      tool_response: { content: '127.0.0.1 localhost' },
    });
    expect((result as { tool_name: string }).tool_name).toBe('Read');
  });
});

describe('parseHookEvent — PostToolUseFailure', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'bad-cmd' },
      error: 'command not found',
    });
    expect((result as { error: string }).error).toBe('command not found');
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
    expect((result as { is_interrupt?: boolean }).is_interrupt).toBe(true);
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
    expect((result as { tool_name: string }).tool_name).toBe('Bash');
    // PermissionRequest has no tool_use_id — verify it is not set
    expect((result as { tool_use_id?: string }).tool_use_id).toBeUndefined();
  });

  test('optional permission_suggestions field is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /tmp/test' },
      permission_suggestions: [{ type: 'toolAlwaysAllow', tool: 'Bash' }],
    });
    expect((result as { permission_suggestions?: unknown[] }).permission_suggestions).toHaveLength(
      1,
    );
  });
});

describe('parseHookEvent — Notification', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'Notification',
      message: 'Permission required',
      notification_type: 'permission_prompt',
    });
    expect((result as { notification_type: string }).notification_type).toBe('permission_prompt');
  });

  test('optional title field is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'Notification',
      message: 'Info',
      title: 'My Title',
      notification_type: 'auth_success',
    });
    expect((result as { title?: string }).title).toBe('My Title');
  });
});

describe('parseHookEvent — SubagentStart', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SubagentStart',
      agent_id: 'agent-001',
      agent_type: 'Explore',
    });
    expect((result as { agent_id: string }).agent_id).toBe('agent-001');
  });
});

describe('parseHookEvent — SubagentStop', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SubagentStop',
      agent_id: 'agent-001',
      agent_type: 'Explore',
      stop_hook_active: false,
      agent_transcript_path: '/home/user/.claude/subagents/agent-001.jsonl',
      last_assistant_message: 'Done.',
    });
    expect((result as { stop_hook_active: boolean }).stop_hook_active).toBe(false);
  });
});

describe('parseHookEvent — Stop', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'Task complete.',
    });
    expect((result as { stop_hook_active: boolean }).stop_hook_active).toBe(true);
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
    expect((result as { trigger: string }).trigger).toBe('manual');
  });

  test('auto trigger with empty custom_instructions', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreCompact',
      trigger: 'auto',
      custom_instructions: '',
    });
    expect((result as { trigger: string }).trigger).toBe('auto');
  });
});

describe('parseHookEvent — TeammateIdle', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'TeammateIdle',
      teammate_name: 'Alice',
      team_name: 'dev-team',
    });
    expect((result as { teammate_name: string }).teammate_name).toBe('Alice');
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
    expect((result as { task_id: string }).task_id).toBe('task-42');
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
    expect((result as { teammate_name?: string }).teammate_name).toBe('Bob');
  });
});

describe('parseHookEvent — ConfigChange', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'ConfigChange',
      source: 'user_settings',
    });
    expect((result as { source: string }).source).toBe('user_settings');
  });

  test('optional file_path is preserved', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'ConfigChange',
      source: 'project_settings',
      file_path: '/home/user/project/.claude/settings.json',
    });
    expect((result as { file_path?: string }).file_path).toBe(
      '/home/user/project/.claude/settings.json',
    );
  });
});

describe('parseHookEvent — WorktreeCreate', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'WorktreeCreate',
      name: 'bold-oak-a3f2',
    });
    expect((result as { name: string }).name).toBe('bold-oak-a3f2');
  });
});

describe('parseHookEvent — WorktreeRemove', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'WorktreeRemove',
      worktree_path: '/home/user/project/.git/worktrees/bold-oak-a3f2',
    });
    expect((result as { worktree_path: string }).worktree_path).toBe(
      '/home/user/project/.git/worktrees/bold-oak-a3f2',
    );
  });
});

describe('parseHookEvent — InstructionsLoaded', () => {
  test('valid payload parses successfully', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'InstructionsLoaded',
      trigger: 'init',
    });
    expect((result as { trigger: string }).trigger).toBe('init');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1: unknown fields are preserved (passthrough)
// ---------------------------------------------------------------------------

describe('passthrough — unknown fields are preserved', () => {
  test('PreToolUse preserves unknown fields', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_use_id: 'toolu_01ABC123',
      tool_input: { command: 'echo hi' },
      future_sdk_field: 'preserved',
    });
    expect((result as Record<string, unknown>).future_sdk_field).toBe('preserved');
  });

  test('SessionStart preserves unknown fields', () => {
    const result = parseHookEvent({
      ...base,
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'claude-sonnet-4-6',
      extra: 42,
    });
    expect((result as Record<string, unknown>).extra).toBe(42);
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
    expect((result as Record<string, unknown>).some_new_field).toBe('new_value');
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
        transcript_path: '/home/user/.claude/transcript.jsonl',
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
        transcript_path: '/home/user/.claude/transcript.jsonl',
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
        model: 'claude-sonnet-4-6',
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
        model: 'claude-sonnet-4-6',
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
    expect((result.tool_response as { exit_code: number }).exit_code).toBe(0);
  });
});
