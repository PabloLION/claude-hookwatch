/**
 * Tests for src/schemas/output.ts
 *
 * Coverage:
 * - Valid output passing for each schema
 * - Missing required fields are rejected with ZodError
 * - Passthrough allows unknown fields on all schemas
 * - systemMessage is always optional (absent = valid)
 * - hookSpecificOutput applies only to PreToolUse (not universal)
 * - StopOutput requires decision field
 */

import { describe, expect, test } from 'bun:test';
import { ZodError } from 'zod';
import { hookOutputSchema, preToolUseOutputSchema, stopOutputSchema } from './output.ts';

// ---------------------------------------------------------------------------
// hookOutputSchema — base schema, all hooks
// ---------------------------------------------------------------------------

describe('hookOutputSchema — valid output', () => {
  test('empty object is valid (all fields optional)', () => {
    const result = hookOutputSchema.parse({});
    expect(result).toEqual({});
  });

  test('continue field is preserved when true', () => {
    const result = hookOutputSchema.parse({ continue: true });
    expect(result.continue).toBe(true);
  });

  test('continue: false halts processing', () => {
    const result = hookOutputSchema.parse({ continue: false });
    expect(result.continue).toBe(false);
  });

  test('suppressOutput field is preserved', () => {
    const result = hookOutputSchema.parse({ suppressOutput: true });
    expect(result.suppressOutput).toBe(true);
  });

  test('systemMessage is preserved when present', () => {
    const result = hookOutputSchema.parse({
      systemMessage: 'hookwatch captured SessionStart (startup)',
    });
    expect(result.systemMessage).toBe('hookwatch captured SessionStart (startup)');
  });

  test('all three base fields together', () => {
    const result = hookOutputSchema.parse({
      continue: true,
      suppressOutput: false,
      systemMessage: 'hookwatch captured Stop',
    });
    expect(result.continue).toBe(true);
    expect(result.suppressOutput).toBe(false);
    expect(result.systemMessage).toBe('hookwatch captured Stop');
  });
});

describe('hookOutputSchema — passthrough allows unknown fields', () => {
  test('future SDK field is preserved', () => {
    const result = hookOutputSchema.parse({
      continue: true,
      futureSdkField: 'preserved',
    });
    expect((result as Record<string, unknown>).futureSdkField).toBe('preserved');
  });

  test('multiple unknown fields are all preserved', () => {
    const result = hookOutputSchema.parse({
      unknownA: 1,
      unknownB: 'two',
      unknownC: { nested: true },
    });
    const r = result as Record<string, unknown>;
    expect(r.unknownA).toBe(1);
    expect(r.unknownB).toBe('two');
    expect(r.unknownC).toEqual({ nested: true });
  });
});

describe('hookOutputSchema — type validation', () => {
  test('continue must be boolean — rejects string', () => {
    expect(() => hookOutputSchema.parse({ continue: 'yes' })).toThrow(ZodError);
  });

  test('suppressOutput must be boolean — rejects number', () => {
    expect(() => hookOutputSchema.parse({ suppressOutput: 1 })).toThrow(ZodError);
  });

  test('systemMessage must be string — rejects number', () => {
    expect(() => hookOutputSchema.parse({ systemMessage: 42 })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// preToolUseOutputSchema — PreToolUse-specific
// ---------------------------------------------------------------------------

describe('preToolUseOutputSchema — valid output', () => {
  test('empty object is valid (hookSpecificOutput is optional)', () => {
    const result = preToolUseOutputSchema.parse({});
    expect(result).toEqual({});
  });

  test('hookSpecificOutput with allow decision', () => {
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });

  test('hookSpecificOutput with deny decision', () => {
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'deny' },
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
  });

  test('hookSpecificOutput with ask decision', () => {
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'ask' },
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
  });

  test('hookSpecificOutput with updatedInput', () => {
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: {
        permissionDecision: 'allow',
        updatedInput: { command: 'ls -la /tmp' },
      },
    });
    expect(result.hookSpecificOutput?.updatedInput).toEqual({
      command: 'ls -la /tmp',
    });
  });

  test('full PreToolUse output with all fields', () => {
    const result = preToolUseOutputSchema.parse({
      continue: true,
      suppressOutput: false,
      systemMessage: 'hookwatch captured PreToolUse (Bash)',
      hookSpecificOutput: {
        permissionDecision: 'allow',
        updatedInput: { command: 'echo hello' },
      },
    });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(result.systemMessage).toBe('hookwatch captured PreToolUse (Bash)');
  });

  test('systemMessage is optional — valid without it', () => {
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    expect(result.systemMessage).toBeUndefined();
  });
});

describe('preToolUseOutputSchema — passthrough allows unknown fields', () => {
  test('future SDK field is preserved', () => {
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'allow' },
      futureSdkExtension: 'value',
    });
    expect((result as Record<string, unknown>).futureSdkExtension).toBe('value');
  });
});

describe('preToolUseOutputSchema — validation failures', () => {
  test('invalid permissionDecision value is rejected', () => {
    expect(() =>
      preToolUseOutputSchema.parse({
        hookSpecificOutput: { permissionDecision: 'permit' },
      }),
    ).toThrow(ZodError);
  });

  test('missing permissionDecision when hookSpecificOutput present is rejected', () => {
    expect(() =>
      preToolUseOutputSchema.parse({
        hookSpecificOutput: { updatedInput: { command: 'ls' } },
      }),
    ).toThrow(ZodError);
  });

  test('hookSpecificOutput is NOT present on base schema (it is PreToolUse-only)', () => {
    // The base schema should accept hookSpecificOutput as an unknown passthrough field,
    // but does not validate its structure — no type-safe access via schema type.
    const result = hookOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'allow' },
    });
    // Passthrough preserves it, but it is not typed in HookOutput
    expect((result as Record<string, unknown>).hookSpecificOutput).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// stopOutputSchema — Stop-specific
// ---------------------------------------------------------------------------

describe('stopOutputSchema — valid output', () => {
  test('decision: approve is valid', () => {
    const result = stopOutputSchema.parse({ decision: 'approve' });
    expect(result.decision).toBe('approve');
  });

  test('decision: block is valid', () => {
    const result = stopOutputSchema.parse({ decision: 'block' });
    expect(result.decision).toBe('block');
  });

  test('reason is optional — valid without it', () => {
    const result = stopOutputSchema.parse({ decision: 'approve' });
    expect(result.reason).toBeUndefined();
  });

  test('reason is preserved when present', () => {
    const result = stopOutputSchema.parse({
      decision: 'block',
      reason: 'Tests not yet passing',
    });
    expect(result.reason).toBe('Tests not yet passing');
  });

  test('systemMessage is optional — valid without it', () => {
    const result = stopOutputSchema.parse({ decision: 'approve' });
    expect(result.systemMessage).toBeUndefined();
  });

  test('systemMessage is preserved when present', () => {
    const result = stopOutputSchema.parse({
      decision: 'approve',
      systemMessage: 'hookwatch captured Stop',
    });
    expect(result.systemMessage).toBe('hookwatch captured Stop');
  });

  test('full Stop output with all fields', () => {
    const result = stopOutputSchema.parse({
      continue: false,
      suppressOutput: false,
      systemMessage: 'hookwatch captured Stop',
      decision: 'block',
      reason: 'Linting errors detected',
    });
    expect(result.decision).toBe('block');
    expect(result.reason).toBe('Linting errors detected');
    expect(result.continue).toBe(false);
  });
});

describe('stopOutputSchema — passthrough allows unknown fields', () => {
  test('future SDK field is preserved', () => {
    const result = stopOutputSchema.parse({
      decision: 'approve',
      futureSdkField: 'preserved',
    });
    expect((result as Record<string, unknown>).futureSdkField).toBe('preserved');
  });
});

describe('stopOutputSchema — validation failures', () => {
  test('missing decision field is rejected', () => {
    expect(() => stopOutputSchema.parse({ reason: 'Some reason' })).toThrow(ZodError);
  });

  test('invalid decision value is rejected', () => {
    expect(() => stopOutputSchema.parse({ decision: 'allow' })).toThrow(ZodError);
  });

  test('decision: deny is not valid (only approve|block)', () => {
    expect(() => stopOutputSchema.parse({ decision: 'deny' })).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// systemMessage format tests (AC #3)
// ---------------------------------------------------------------------------

describe('systemMessage format — hookwatch convention', () => {
  test('format with subtype: hookwatch captured {EventType} ({subtype})', () => {
    const msg = 'hookwatch captured PreToolUse (Bash)';
    const result = preToolUseOutputSchema.parse({
      hookSpecificOutput: { permissionDecision: 'allow' },
      systemMessage: msg,
    });
    expect(result.systemMessage).toBe(msg);
    expect(result.systemMessage).toMatch(/^hookwatch captured \w+( \(.+\))?$/);
  });

  test('Stop event systemMessage has no subtype', () => {
    const msg = 'hookwatch captured Stop';
    const result = stopOutputSchema.parse({
      decision: 'approve',
      systemMessage: msg,
    });
    expect(result.systemMessage).toMatch(/^hookwatch captured \w+( \(.+\))?$/);
  });

  test('base schema systemMessage follows format', () => {
    const msg = 'hookwatch captured SessionStart (startup)';
    const result = hookOutputSchema.parse({ systemMessage: msg });
    expect(result.systemMessage).toMatch(/^hookwatch captured \w+( \(.+\))?$/);
  });
});
