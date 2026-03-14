#!/usr/bin/env bun
/**
 * hookwatch CLI entrypoint (citty).
 *
 * Subcommands:
 *   install    — install/upgrade plugin
 *   uninstall  — uninstall + cleanup
 *   ui         — start server + open browser
 *
 * Handler mode (PascalCase event families):
 *   hookwatch PreToolUse   — read stdin, delegate to handler
 *   hookwatch SessionStart — etc.
 *
 * Flags:
 *   --version / -v  — print version from src/version.ts (reads package.json)
 *   --help / -h     — help text
 */

import { defineCommand, runMain } from 'citty';
import { runHandler } from '@/handler/index.ts';
import { VERSION } from '@/version.ts';
import { name as pkgName } from '../../package.json';
import { EVENT_TYPE_SET, EVENT_TYPES, type EventType } from './events.ts';
import { installCommand } from './install.ts';
import { uiCommand } from './ui.ts';
import { uninstallCommand } from './uninstall.ts';

/**
 * Builds the handler subcommand for a given event type.
 *
 * Modes:
 *   - Bare:    `hookwatch PreToolUse`           — reads stdin, posts event
 *   - Wrapped: `hookwatch PreToolUse ./hook.sh` — spawns ./hook.sh, tees I/O,
 *               posts event with captured output (Story 3.1)
 *
 * All rawArgs after the event type subcommand are passed directly to
 * runHandler() as the wrapped command. No filtering — flags intended for
 * the wrapped command (e.g. --verbose) must be preserved.
 */
function makeEventCommand(eventType: EventType) {
  return defineCommand({
    meta: {
      name: eventType,
      description: `Handle ${eventType} hook events from Claude Code (reads stdin)`,
    },
    run(context) {
      // rawArgs contains everything after the subcommand name.
      // Pass all args as-is: non-empty = wrapped mode, empty = bare mode.
      const wrappedCommand = context.rawArgs.length > 0 ? context.rawArgs : undefined;
      return runHandler(wrappedCommand);
    },
  });
}

const main = defineCommand({
  meta: {
    name: pkgName,
    version: VERSION,
    description: 'Log all Claude Code hook events to local storage',
  },
  subCommands: {
    install: installCommand,
    uninstall: uninstallCommand,
    ui: uiCommand,
    // PascalCase event handler subcommands (one per EVENT_NAMES entry)
    SessionStart: makeEventCommand('SessionStart'),
    SessionEnd: makeEventCommand('SessionEnd'),
    UserPromptSubmit: makeEventCommand('UserPromptSubmit'),
    PreToolUse: makeEventCommand('PreToolUse'),
    PostToolUse: makeEventCommand('PostToolUse'),
    PostToolUseFailure: makeEventCommand('PostToolUseFailure'),
    PermissionRequest: makeEventCommand('PermissionRequest'),
    Notification: makeEventCommand('Notification'),
    SubagentStart: makeEventCommand('SubagentStart'),
    SubagentStop: makeEventCommand('SubagentStop'),
    Stop: makeEventCommand('Stop'),
    TeammateIdle: makeEventCommand('TeammateIdle'),
    TaskCompleted: makeEventCommand('TaskCompleted'),
    InstructionsLoaded: makeEventCommand('InstructionsLoaded'),
    ConfigChange: makeEventCommand('ConfigChange'),
    WorktreeCreate: makeEventCommand('WorktreeCreate'),
    WorktreeRemove: makeEventCommand('WorktreeRemove'),
    PreCompact: makeEventCommand('PreCompact'),
  },
});

/**
 * Returns true when the first CLI argument looks like an unknown PascalCase
 * event type — starts with an uppercase letter but is not a known event type
 * or a standard subcommand.
 */
function isUnknownEventType(arg: string | undefined): boolean {
  if (arg === undefined) return false;
  if (arg.startsWith('-')) return false;
  if (['install', 'uninstall', 'ui'].includes(arg)) return false;
  if (EVENT_TYPE_SET.has(arg)) return false;
  return /^[A-Z]/.test(arg);
}

// Handle unknown arguments: if the first arg looks like a PascalCase event
// type that is NOT in our list, exit 1 with guidance.
const firstArg = process.argv[2];
if (isUnknownEventType(firstArg)) {
  process.stderr.write(
    `[hookwatch] Unknown event type: "${firstArg}"\n` +
      `  Known event types: ${EVENT_TYPES.join(', ')}\n` +
      `  If this is a new Claude Code event type, please file an issue:\n` +
      `  https://github.com/PabloLION/claude-hookwatch/issues/new\n`,
  );
  process.exit(1);
}

runMain(main);
