/**
 * Tests for CLI install/uninstall commands and plugin file generation.
 *
 * Covers:
 * - buildPluginJson shape and correctness
 * - buildHooksJson: all 18 event types, command format
 * - install --dry-run preview (no filesystem side effects)
 * - uninstall --dry-run preview (no filesystem side effects)
 * - EVENT_TYPES list completeness
 * - Unknown PascalCase event exit behavior
 */

import { describe, expect, it } from 'bun:test';
import { EXPECTED_EVENT_TYPE_COUNT } from '@/test/constants.ts';
import { EVENT_TYPES, type EventType } from './events.ts';
import { buildHooksJson, buildPluginJson } from './plugin-files.ts';

// ---------------------------------------------------------------------------
// EVENT_TYPES sanity checks
// ---------------------------------------------------------------------------

describe('EVENT_TYPES', () => {
  it('contains exactly 18 event types', () => {
    expect(EVENT_TYPES).toHaveLength(EXPECTED_EVENT_TYPE_COUNT);
  });

  it('starts with ConfigChange (alphabetical order from EVENT_NAMES)', () => {
    expect(EVENT_TYPES[0]).toBe('ConfigChange');
  });

  it('ends with WorktreeRemove (alphabetical order from EVENT_NAMES)', () => {
    expect(EVENT_TYPES.at(-1)).toBe('WorktreeRemove');
  });

  it('contains all documented event types', () => {
    const expected: EventType[] = [
      'ConfigChange',
      'InstructionsLoaded',
      'Notification',
      'PermissionRequest',
      'PostToolUse',
      'PostToolUseFailure',
      'PreCompact',
      'PreToolUse',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'SubagentStart',
      'SubagentStop',
      'TaskCompleted',
      'TeammateIdle',
      'UserPromptSubmit',
      'WorktreeCreate',
      'WorktreeRemove',
    ];
    expect([...EVENT_TYPES]).toEqual(expected);
  });

  it('has no duplicates', () => {
    const unique = new Set(EVENT_TYPES);
    expect(unique.size).toBe(EVENT_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// Plugin manifest JSON generation (shared module: src/cli/plugin-files.ts)
// ---------------------------------------------------------------------------

describe('buildPluginJson', () => {
  it('returns correct shape', () => {
    const pkg = {
      name: 'hookwatch',
      version: '0.1.0',
      description: 'test description',
    };
    const result = buildPluginJson(pkg);
    expect(result).toEqual({
      name: 'hookwatch',
      version: '0.1.0',
      description: 'test description',
      author: { name: 'PabloLION' },
    });
  });

  it('propagates version from package.json', () => {
    const pkg = { name: 'hookwatch', version: '9.9.9', description: 'd' };
    const result = buildPluginJson(pkg) as { version: string };
    expect(result.version).toBe('9.9.9');
  });
});

describe('buildHooksJson', () => {
  it('creates an entry for every event type', () => {
    const hooks = buildHooksJson();
    for (const eventType of EVENT_TYPES) {
      expect(hooks[eventType]).toBeDefined();
    }
  });

  it('each entry has exactly one hooks wrapper with one command', () => {
    const hooks = buildHooksJson();
    for (const eventType of EVENT_TYPES) {
      const entries = hooks[eventType];
      expect(entries).toHaveLength(1);
      if (entries === undefined) continue;
      const inner = entries[0]?.hooks;
      expect(inner).toHaveLength(1);
      expect(inner?.[0]?.type).toBe('command');
    }
  });

  it("command format is 'hookwatch <EventType>'", () => {
    const hooks = buildHooksJson(['PreToolUse']);
    expect(hooks.PreToolUse?.[0]?.hooks[0]?.command).toBe('hookwatch PreToolUse');
  });

  it('command format for all 18 types uses hookwatch prefix', () => {
    const hooks = buildHooksJson();
    for (const eventType of EVENT_TYPES) {
      const cmd = hooks[eventType]?.[0]?.hooks[0]?.command;
      expect(cmd).toBe(`hookwatch ${eventType}`);
    }
  });
});

// ---------------------------------------------------------------------------
// hooks/hooks.json file validation (the actual generated file)
// ---------------------------------------------------------------------------

describe('generated hooks/hooks.json', () => {
  it('exists and is valid JSON', async () => {
    const file = Bun.file(`${import.meta.dir}/../../hooks/hooks.json`);
    const exists = await file.exists();
    expect(exists).toBe(true);

    const content = await file.text();
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('has a hooks property with 18 event type keys', async () => {
    const file = Bun.file(`${import.meta.dir}/../../hooks/hooks.json`);
    const content = JSON.parse(await file.text()) as { hooks: Record<string, unknown> };
    expect(typeof content.hooks).toBe('object');
    expect(Object.keys(content.hooks)).toHaveLength(EXPECTED_EVENT_TYPE_COUNT);
  });

  it('all 18 event types are present in hooks', async () => {
    const file = Bun.file(`${import.meta.dir}/../../hooks/hooks.json`);
    const content = JSON.parse(await file.text()) as {
      hooks: Record<string, Array<{ hooks: Array<{ type: string; command: string }> }>>;
    };

    for (const eventType of EVENT_TYPES) {
      expect(content.hooks[eventType]).toBeDefined();
      const cmd = content.hooks[eventType]?.[0]?.hooks[0]?.command;
      expect(cmd).toBe(`hookwatch ${eventType}`);
    }
  });
});

// ---------------------------------------------------------------------------
// .claude-plugin/plugin.json file validation (the actual generated file)
// ---------------------------------------------------------------------------

describe('generated .claude-plugin/plugin.json', () => {
  it('exists and is valid JSON', async () => {
    const file = Bun.file(`${import.meta.dir}/../../.claude-plugin/plugin.json`);
    const exists = await file.exists();
    expect(exists).toBe(true);

    const content = await file.text();
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it('has required fields: name, version, description, author', async () => {
    const file = Bun.file(`${import.meta.dir}/../../.claude-plugin/plugin.json`);
    const content = JSON.parse(await file.text()) as {
      name: string;
      version: string;
      description: string;
      author: { name: string };
    };
    expect(content.name).toBe('hookwatch');
    expect(typeof content.version).toBe('string');
    expect(content.version.length).toBeGreaterThan(0);
    expect(typeof content.description).toBe('string');
    expect(content.author.name).toBe('PabloLION');
  });
});
