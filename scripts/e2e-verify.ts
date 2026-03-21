#!/usr/bin/env bun
/**
 * e2e-verify.ts — End-to-end verification of hookwatch with Claude Code.
 *
 * Tests the full user flow: install → capture events via Claude Code → verify
 * events in SQLite → uninstall. Uses EVENT_NAMES from src/types.ts as the
 * single source of truth for event coverage tracking.
 *
 * Usage:
 *   bun scripts/e2e-verify.ts [workspace-dir]
 *
 * workspace-dir defaults to .git-ignored/e2e-test/ inside the hookwatch repo.
 * This is where Claude Code runs — isolated from the repo's session history.
 *
 * Design: .git-ignored/devlog/20260320-e2e-verify-redesign.md
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { EVENT_NAMES } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HOOKWATCH_ROOT = resolve(import.meta.dir, '..');
const DEFAULT_WORKSPACE = resolve(HOOKWATCH_ROOT, '.git-ignored/e2e-test');

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`;
}

const DB_PATH = `${xdgDataHome()}/hookwatch/hookwatch.db`;
const PORT_FILE = `${xdgDataHome()}/hookwatch/hookwatch.port`;

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const NC = '\x1b[0m';

function pass(msg: string): void {
  console.log(`  ${GREEN}✓${NC} ${msg}`);
}
function fail(msg: string): void {
  console.error(`  ${RED}✗${NC} ${msg}`);
}
function warn(msg: string): void {
  console.log(`  ${YELLOW}⚠${NC} ${msg}`);
}
function step(msg: string): void {
  console.log(`\n${BOLD}${msg}${NC}`);
}

// ---------------------------------------------------------------------------
// Coverage tracker
// ---------------------------------------------------------------------------

interface CoverageEntry {
  covered: boolean;
  reason: string;
}

const coverage: Record<string, CoverageEntry> = Object.fromEntries(
  EVENT_NAMES.map((name) => [name, { covered: false, reason: '' }]),
);

// Mark events known to be untestable in -p mode
const UNTESTABLE: Record<string, string> = {
  PermissionRequest: 'pre-authorized via --allowedTools — does not fire in -p mode',
  TeammateIdle: 'interactive-only (agent teams feature)',
  SessionStart: 'does not fire in -p mode (confirmed Claude Code 2.1.81, ch-mhx)',
  SessionEnd: 'does not fire in -p mode (confirmed Claude Code 2.1.81)',
  InstructionsLoaded: 'does not fire in -p mode (confirmed Claude Code 2.1.81)',
  ConfigChange: 'no programmatic trigger in -p mode',
  Notification: 'no programmatic trigger in -p mode',
  PreCompact: 'requires long context — not reachable in short e2e test',
  WorktreeCreate: 'requires git worktree operations — not triggered via --plugin-dir',
  WorktreeRemove: 'requires git worktree operations — not triggered via --plugin-dir',
};

for (const [event, reason] of Object.entries(UNTESTABLE)) {
  coverage[event] = { covered: false, reason: `untestable: ${reason}` };
}

function markCovered(event: string, reason: string): void {
  if (coverage[event] && !coverage[event].covered) {
    coverage[event] = { covered: true, reason };
  }
}

function markUncovered(event: string, reason: string): void {
  if (coverage[event] && !coverage[event].covered) {
    coverage[event] = { covered: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(cmd: string[], opts?: { cwd?: string }): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? HOOKWATCH_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function runVisible(cmd: string[], opts?: { cwd?: string }): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? HOOKWATCH_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

async function which(name: string): Promise<string | null> {
  try {
    const result = await run(['which', name]);
    return result.exitCode === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

async function getVersion(cmd: string[]): Promise<string> {
  try {
    const result = await run(cmd);
    return result.stdout.split('\n')[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// SQLite helpers
// ---------------------------------------------------------------------------

function getEventCount(): number {
  if (!existsSync(DB_PATH)) return 0;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM events').get();
    db.close();
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

interface CapturedEvent {
  id: number;
  event: string;
  tool_name: string | null;
  session_id: string;
  cwd: string;
}

function getEventsSince(minId: number): CapturedEvent[] {
  if (!existsSync(DB_PATH)) return [];
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const events = db
      .query<CapturedEvent, [number]>(
        'SELECT id, event, tool_name, session_id, cwd FROM events WHERE id > ? ORDER BY id',
      )
      .all(minId);
    db.close();
    return events;
  } catch {
    return [];
  }
}

function getMaxEventId(): number {
  if (!existsSync(DB_PATH)) return 0;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db
      .query<{ max_id: number | null }, []>('SELECT MAX(id) as max_id FROM events')
      .get();
    db.close();
    return row?.max_id ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Claude invocation helper
// ---------------------------------------------------------------------------

interface ClaudeResult {
  sessionId: string;
  result: string;
  exitCode: number;
}

async function runClaude(
  prompt: string,
  opts: {
    workspace: string;
    allowedTools: string;
    maxTurns: number;
    sessionId?: string;
  },
): Promise<ClaudeResult> {
  const args = [
    'claude',
    '-p',
    '--plugin-dir',
    HOOKWATCH_ROOT,
    '--output-format',
    'json',
    '--allowedTools',
    opts.allowedTools,
    '--max-turns',
    String(opts.maxTurns),
  ];

  if (opts.sessionId) {
    args.push('--resume', opts.sessionId);
  }

  args.push(prompt);

  const result = await run(args, { cwd: opts.workspace });

  let sessionId = '';
  let textResult = '';

  if (result.stdout) {
    try {
      // claude -p --output-format json returns a JSON array of events:
      //   [{"type":"system",...}, {"type":"assistant",...}, {"type":"result",...}]
      // The "result" entry has session_id and the final text result.
      const parsed = JSON.parse(result.stdout) as Array<{
        type?: string;
        session_id?: string;
        result?: string;
      }>;

      if (Array.isArray(parsed)) {
        const resultEntry = parsed.find((e) => e.type === 'result');
        sessionId = resultEntry?.session_id ?? '';
        textResult = resultEntry?.result ?? '';
      }
    } catch {
      // stdout may not be valid JSON if Claude failed
      textResult = result.stdout;
    }
  }

  return { sessionId, result: textResult, exitCode: result.exitCode };
}

// ---------------------------------------------------------------------------
// Round definitions
// ---------------------------------------------------------------------------

interface Round {
  name: string;
  prompt: string;
  allowedTools: string;
  maxTurns: number;
  expectedEvents: string[];
  expectedToolNames?: string[];
  empirical: boolean;
}

const ROUNDS: Round[] = [
  {
    name: 'Read',
    prompt: 'Read the file test-fixture.txt and reply with its exact contents, nothing else.',
    allowedTools: 'Read',
    maxTurns: 2,
    expectedEvents: ['PreToolUse', 'PostToolUse'],
    expectedToolNames: ['Read'],
    empirical: false,
  },
  {
    name: 'Bash',
    prompt: 'Run this exact bash command and reply with the output: ls -1',
    allowedTools: 'Bash',
    maxTurns: 2,
    expectedEvents: ['PreToolUse', 'PostToolUse'],
    expectedToolNames: ['Bash'],
    empirical: false,
  },
  {
    name: 'Write',
    prompt:
      'Write a file called e2e-output.txt with the exact content "hookwatch e2e test". Reply with "done".',
    allowedTools: 'Write',
    maxTurns: 2,
    expectedEvents: ['PreToolUse', 'PostToolUse'],
    expectedToolNames: ['Write'],
    empirical: false,
  },
  {
    name: 'Failure',
    prompt:
      'Read the file nonexistent-file-abc123.txt. If it fails, just reply with "file not found".',
    allowedTools: 'Read',
    maxTurns: 2,
    expectedEvents: ['PostToolUseFailure'],
    empirical: false,
  },
  {
    name: 'Subagent',
    prompt:
      'Use the Agent tool to search for files matching "*.txt" in the current directory. Reply with what you find.',
    allowedTools: 'Agent,Read,Glob,Bash',
    maxTurns: 4,
    expectedEvents: ['SubagentStart', 'SubagentStop'],
    empirical: true,
  },
  {
    name: 'Task',
    prompt:
      'Create a task called "e2e test task" and then immediately mark it as completed. Reply with "done".',
    allowedTools: 'Task,TaskOutput,TaskStop',
    maxTurns: 4,
    expectedEvents: ['TaskCompleted'],
    empirical: true,
  },
];

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let workspace = DEFAULT_WORKSPACE;

for (const arg of args) {
  if (arg === '--help' || arg === '-h') {
    console.log('Usage: bun scripts/e2e-verify.ts [workspace-dir]');
    console.log('');
    console.log(
      `  workspace-dir  Directory for Claude Code sessions (default: ${DEFAULT_WORKSPACE})`,
    );
    process.exit(0);
  }
  workspace = resolve(arg);
}

// =========================================================================
// Phase 1: Prerequisites
// =========================================================================

step('Phase 1: Prerequisites');

const bunPath = await which('bun');
const claudePath = await which('claude');
const hookwatchPath = await which('hookwatch');

if (!bunPath) {
  fail('bun not found — install from https://bun.sh');
  process.exit(1);
}
if (!claudePath) {
  fail('claude not found — install Claude Code CLI');
  process.exit(1);
}
if (!hookwatchPath) {
  fail('hookwatch not linked — run: bun install && bun link');
  process.exit(1);
}

pass(`bun ${await getVersion(['bun', '--version'])}`);
pass(`claude ${await getVersion(['claude', '--version'])}`);
pass('hookwatch linked');

// Validate plugin structure
if (!existsSync(resolve(HOOKWATCH_ROOT, '.claude-plugin/plugin.json'))) {
  fail('Missing .claude-plugin/plugin.json — run: hookwatch install');
  process.exit(1);
}
if (!existsSync(resolve(HOOKWATCH_ROOT, 'hooks/hooks.json'))) {
  fail('Missing hooks/hooks.json — run: hookwatch install');
  process.exit(1);
}
pass('Plugin structure valid');

// =========================================================================
// Phase 2: Setup
// =========================================================================

step('Phase 2: Setup');

// Create workspace
mkdirSync(workspace, { recursive: true });
pass(`E2E_WORKSPACE: ${workspace}`);

// Create test fixtures
await Bun.write(resolve(workspace, 'test-fixture.txt'), 'hookwatch e2e test fixture content\n');
await Bun.write(
  resolve(workspace, 'CLAUDE.md'),
  '# E2E Test Workspace\n\nThis is a hookwatch e2e test workspace.\n',
);
pass('Test fixtures created');

// Initialize git repo (needed for worktree tests if added later)
if (!existsSync(resolve(workspace, '.git'))) {
  await run(['git', 'init'], { cwd: workspace });
  await run(['git', 'add', '.'], { cwd: workspace });
  await run(['git', 'commit', '-m', 'e2e test init'], { cwd: workspace });
  pass('Git repo initialized in workspace');
} else {
  pass('Git repo already exists in workspace');
}

// Test hookwatch install (idempotent)
console.log('');
console.log(`  ${DIM}Running hookwatch install...${NC}`);
const installExit = await runVisible(['hookwatch', 'install']);
if (installExit !== 0) {
  fail('hookwatch install failed');
  process.exit(1);
}
pass('hookwatch install succeeded');

// Baseline
const baselineId = getMaxEventId();
const baselineCount = getEventCount();
console.log(`  Events before test: ${baselineCount} (cursor: id > ${baselineId})`);

// =========================================================================
// Phase 3: Multi-round capture + per-round verification
// =========================================================================

step('Phase 3: Multi-round event capture');

let sessionId = '';
let totalNewEvents = 0;
let allFailed = false;

for (let i = 0; i < ROUNDS.length; i++) {
  const round = ROUNDS[i] as Round;
  const roundNum = i + 1;
  const cursorBefore = getMaxEventId();

  console.log(`\n  ${BOLD}Round ${roundNum}: ${round.name}${NC}`);
  console.log(`  ${DIM}Prompt: ${round.prompt.slice(0, 80)}...${NC}`);

  const claudeResult = await runClaude(round.prompt, {
    workspace,
    allowedTools: round.allowedTools,
    maxTurns: round.maxTurns,
    sessionId: sessionId || undefined,
  });

  if (roundNum === 1) {
    sessionId = claudeResult.sessionId;
    if (sessionId) {
      pass(`Session ID: ${sessionId}`);
    } else {
      warn('No session ID captured from JSON output');
    }
  }

  if (claudeResult.exitCode !== 0) {
    if (round.empirical) {
      warn(`Claude exited with code ${claudeResult.exitCode} (empirical round — continuing)`);
    } else {
      fail(`Claude exited with code ${claudeResult.exitCode}`);
      allFailed = true;
      break;
    }
  }

  // Wait for server to flush
  await Bun.sleep(2000);

  // Query for new events since this round started
  const newEvents = getEventsSince(cursorBefore);
  totalNewEvents += newEvents.length;

  if (newEvents.length === 0 && !round.empirical) {
    fail(`Round ${roundNum} (${round.name}): no new events captured`);
    allFailed = true;
    break;
  }

  // Check expected events
  const eventTypes = new Set(newEvents.map((e) => e.event));

  for (const expected of round.expectedEvents) {
    if (eventTypes.has(expected)) {
      pass(`${expected} captured`);
      markCovered(expected, `Round ${roundNum}: ${round.name}`);
    } else if (round.empirical) {
      warn(`${expected} not captured (empirical — tool may not be available in -p mode)`);
      markUncovered(expected, `not triggered in -p mode (Round ${roundNum})`);
    } else {
      fail(`Expected ${expected} but not found in ${newEvents.length} events`);
      allFailed = true;
    }
  }

  // Check tool names if specified
  if (round.expectedToolNames) {
    const toolNames = new Set(newEvents.map((e) => e.tool_name).filter(Boolean));
    for (const expected of round.expectedToolNames) {
      if (toolNames.has(expected)) {
        pass(`tool_name=${expected} confirmed`);
      } else if (!round.empirical) {
        warn(`Expected tool_name=${expected} not found (tools seen: ${[...toolNames].join(', ')})`);
      }
    }
  }

  // Check for implicit events in every round
  for (const ev of newEvents) {
    if (ev.event === 'UserPromptSubmit') markCovered('UserPromptSubmit', `Round ${roundNum}`);
    if (ev.event === 'Stop') markCovered('Stop', `Round ${roundNum}`);
    if (ev.event === 'SessionStart') markCovered('SessionStart', `Round ${roundNum}`);
    if (ev.event === 'SessionEnd') markCovered('SessionEnd', `Round ${roundNum}`);
    if (ev.event === 'InstructionsLoaded') markCovered('InstructionsLoaded', `Round ${roundNum}`);
    if (ev.event === 'ConfigChange') markCovered('ConfigChange', `Round ${roundNum}`);
    if (ev.event === 'Notification') markCovered('Notification', `Round ${roundNum}`);
    if (ev.event === 'PreCompact') markCovered('PreCompact', `Round ${roundNum}`);
  }

  console.log(`  ${DIM}Events this round: ${newEvents.length}${NC}`);

  if (allFailed) break;
}

// =========================================================================
// Phase 4: Web UI health check
// =========================================================================

step('Phase 4: Web UI');

if (existsSync(PORT_FILE)) {
  const port = (await Bun.file(PORT_FILE).text()).trim();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      pass(`Server running at http://127.0.0.1:${port}`);
    } else {
      warn(`Port file exists (${port}) but server returned ${res.status}`);
    }
  } catch {
    warn(`Port file exists (${port}) but server not reachable`);
  }
} else {
  warn('No port file — server may have shut down (idle timeout)');
}

// =========================================================================
// Phase 5: Cleanup + Report
// =========================================================================

step('Phase 5: Cleanup');

// Test uninstall
console.log(`  ${DIM}Running hookwatch uninstall...${NC}`);
const uninstallExit = await runVisible(['hookwatch', 'uninstall']);
if (uninstallExit !== 0) {
  warn('hookwatch uninstall returned non-zero');
} else {
  pass('hookwatch uninstall succeeded');

  // Verify plugin files removed
  const pluginGone = !existsSync(resolve(HOOKWATCH_ROOT, '.claude-plugin/plugin.json'));
  const hooksGone = !existsSync(resolve(HOOKWATCH_ROOT, 'hooks/hooks.json'));
  if (pluginGone && hooksGone) {
    pass('Plugin files removed');
  } else {
    warn('Some plugin files still exist after uninstall');
  }
}

// Restore: reinstall so the repo is left in a working state
console.log(`  ${DIM}Restoring hookwatch install...${NC}`);
const restoreExit = await runVisible(['bun', 'run', 'generate'], { cwd: HOOKWATCH_ROOT });
if (restoreExit !== 0) {
  warn('Failed to regenerate plugin files — run: bun run generate && bun link');
} else {
  await run(['bun', 'link'], { cwd: HOOKWATCH_ROOT });
  pass('hookwatch restored');
}

// Clean up test artifacts from workspace (keep the folder itself)
for (const file of ['e2e-output.txt']) {
  const path = resolve(workspace, file);
  if (existsSync(path)) rmSync(path);
}

// =========================================================================
// Coverage report
// =========================================================================

step('Event Coverage Report');

// Mark remaining uncovered events with reasons
for (const name of EVENT_NAMES) {
  const entry = coverage[name];
  if (entry && !entry.covered && !entry.reason) {
    coverage[name] = { covered: false, reason: 'not triggered during test' };
  }
}

const coveredCount = Object.values(coverage).filter((c) => c.covered).length;
const untestableCount = Object.keys(UNTESTABLE).length;
const total = EVENT_NAMES.length;

console.log('');
for (const name of EVENT_NAMES) {
  const e = coverage[name];
  if (!e) continue;
  const icon = e.covered ? `${GREEN}✓${NC}` : `${RED}✗${NC}`;
  const reason = e.reason ? ` ${DIM}(${e.reason})${NC}` : '';
  console.log(`  ${icon} ${name}${reason}`);
}

console.log('');
console.log(
  `  Coverage: ${coveredCount}/${total} events (${Math.round((coveredCount / total) * 100)}%)`,
);
console.log(`  Untestable in -p mode: ${untestableCount}`);
console.log(`  Total events captured: ${totalNewEvents}`);

// =========================================================================
// Summary
// =========================================================================

console.log('');
console.log('==========================');
if (allFailed) {
  console.log(`${RED}E2E verification failed.${NC}`);
  process.exit(1);
} else if (coveredCount >= 5) {
  console.log(`${GREEN}E2E verification passed!${NC} (${coveredCount}/${total} events covered)`);
} else {
  console.log(
    `${YELLOW}E2E verification passed with low coverage.${NC} (${coveredCount}/${total})`,
  );
  console.log('Check that Claude Code hooks are firing correctly.');
}
