#!/usr/bin/env bun
/**
 * e2e-verify.ts — End-to-end verification with Claude Code.
 *
 * Tests that hookwatch captures events when used as a plugin with Claude Code.
 * Run this manually — Claude Code cannot invoke itself.
 *
 * Usage:
 *   bun scripts/e2e-verify.ts <plugin-dir>
 *   bun scripts/e2e-verify.ts /Users/pablo/LocalDocs/repo/PabloLION/claude-hookwatch
 *
 * The plugin-dir argument must be an absolute path to the hookwatch plugin
 * directory (the directory containing .claude-plugin/ and hooks/).
 *
 * Prerequisites:
 *   - bun installed and hookwatch linked (bun install && bun link)
 *   - Claude Code installed (claude CLI on PATH)
 *
 * What it does:
 *   1. Validates prerequisites and plugin directory structure
 *   2. Records current event count in SQLite (via bun:sqlite)
 *   3. Runs `claude -p --plugin-dir <path>` with a simple prompt
 *   4. Queries SQLite to verify new events were captured
 *   5. Checks web UI accessibility
 *   6. Reports results
 *
 * Known limitations:
 *   - SessionStart does not fire in print mode (upstream Claude Code behavior)
 *   - Expected events: PreToolUse, PostToolUse, Stop (at minimum)
 */

import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

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
// Subprocess helper
// ---------------------------------------------------------------------------

async function which(name: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['which', name], { stdout: 'pipe', stderr: 'pipe' });
    const exitCode = await proc.exited;
    if (exitCode !== 0) return null;
    return (await new Response(proc.stdout).text()).trim();
  } catch {
    return null;
  }
}

async function getVersion(cmd: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' });
    const stdout = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    return stdout.split('\n')[0] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? `${process.env.HOME}/.local/share`;
}

const DB_DIR = `${xdgDataHome()}/hookwatch`;
const DB_PATH = `${DB_DIR}/hookwatch.db`;
const PORT_FILE = `${DB_DIR}/hookwatch.port`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function usage(): never {
  console.log('Usage: bun scripts/e2e-verify.ts <plugin-dir>');
  console.log('');
  console.log('  plugin-dir  Absolute path to hookwatch plugin directory');
  console.log('');
  console.log('Example:');
  console.log('  bun scripts/e2e-verify.ts /Users/pablo/LocalDocs/repo/PabloLION/claude-hookwatch');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1 || args[0] === '--help' || args[0] === '-h') {
  if (args.length < 1) console.error('Error: plugin-dir argument is required.\n');
  usage();
}

const pluginDir = args[0]!;

if (!isAbsolute(pluginDir)) {
  console.error('Error: plugin-dir must be an absolute path.');
  console.error(`  Got: ${pluginDir}`);
  console.error('');
  console.error('Hint: use $(pwd) for current directory:');
  console.error(`  bun scripts/e2e-verify.ts $(pwd)`);
  process.exit(1);
}

if (!existsSync(pluginDir)) {
  console.error(`Error: plugin-dir does not exist: ${pluginDir}`);
  process.exit(1);
}

console.log(`${BOLD}hookwatch e2e verification${NC}`);
console.log('==========================');
console.log(`  Plugin dir: ${pluginDir}`);

// ---------------------------------------------------------------------------
// 1. Prerequisites
// ---------------------------------------------------------------------------
step('1. Prerequisites');

const bunPath = await which('bun');
const claudePath = await which('claude');
const hookwatchPath = await which('hookwatch');

if (!bunPath) {
  fail('bun not found');
  process.exit(1);
}
if (!claudePath) {
  fail('claude not found');
  process.exit(1);
}
if (!hookwatchPath) {
  fail('hookwatch not linked — run: bun install && bun link');
  process.exit(1);
}

pass(`bun ${await getVersion(['bun', '--version'])}`);
pass(`claude ${await getVersion(['claude', '--version'])}`);
pass('hookwatch linked');

// Validate plugin directory structure
if (!existsSync(resolve(pluginDir, '.claude-plugin/plugin.json'))) {
  fail(`Missing ${pluginDir}/.claude-plugin/plugin.json`);
  process.exit(1);
}
if (!existsSync(resolve(pluginDir, 'hooks/hooks.json'))) {
  fail(`Missing ${pluginDir}/hooks/hooks.json`);
  process.exit(1);
}
pass('Plugin structure valid');

// ---------------------------------------------------------------------------
// 2. Baseline event count
// ---------------------------------------------------------------------------
step('2. Baseline');

let beforeCount = 0;
if (existsSync(DB_PATH)) {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const row = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM events').get();
    beforeCount = row?.count ?? 0;
    db.close();
  } catch {
    // DB may not have events table yet
  }
}
console.log(`  Events before test: ${beforeCount}`);

// ---------------------------------------------------------------------------
// 3. Run Claude Code with hookwatch plugin
// ---------------------------------------------------------------------------
step('3. Claude Code invocation');

const prompt = `Read the file ${pluginDir}/package.json and reply with just the version number.`;
console.log(`  Prompt: ${prompt}`);
console.log('');

const proc = Bun.spawn(['claude', '-p', '--plugin-dir', pluginDir, prompt], {
  stdout: 'pipe',
  stderr: 'pipe',
});

const [claudeStdout, claudeStderr, claudeExit] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);

if (claudeExit !== 0) {
  warn(`claude exited with code ${claudeExit}`);
  if (claudeStderr.trim()) {
    console.log(`  ${DIM}stderr: ${claudeStderr.trim().split('\n')[0]}${NC}`);
  }
} else {
  pass('claude completed successfully');
}

if (claudeStdout.trim()) {
  console.log(`  Claude output: ${claudeStdout.trim()}`);
}

// Give the server a moment to flush writes
await Bun.sleep(2000);

// ---------------------------------------------------------------------------
// 4. Verify events captured
// ---------------------------------------------------------------------------
step('4. Event capture');

if (!existsSync(DB_PATH)) {
  fail(`Database not created at ${DB_PATH}`);
  console.log('');
  console.log('  Troubleshooting:');
  console.log('    1. Is hookwatch on PATH?  which hookwatch');
  console.log(`    2. Try with debug:  claude --debug hooks -p --plugin-dir ${pluginDir} "hello"`);
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

const afterRow = db.query<{ count: number }, []>('SELECT COUNT(*) as count FROM events').get();
const afterCount = afterRow?.count ?? 0;
const newEvents = afterCount - beforeCount;

console.log(`  Events after test: ${afterCount} (new: ${newEvents})`);

if (newEvents <= 0) {
  fail('No new events captured');
  console.log('');
  console.log('  Troubleshooting:');
  console.log('    1. Is hookwatch on PATH?       which hookwatch');
  console.log('    2. Claude Code version:        claude --version');
  console.log(`    3. Debug hook loading:         claude --debug hooks -p --plugin-dir ${pluginDir} "hello"`);
  console.log(`    4. Check server log:           cat ${DB_DIR}/server.log`);
  db.close();
  process.exit(1);
}

pass(`Captured ${newEvents} new events`);

// Event breakdown by type
interface EventBreakdown {
  event: string;
  count: number;
}

const breakdown = db
  .query<EventBreakdown, [number]>(
    `SELECT event, COUNT(*) as count
     FROM (SELECT event FROM events ORDER BY id DESC LIMIT ?)
     GROUP BY event ORDER BY count DESC`,
  )
  .all(newEvents);

console.log('');
console.log('  Event breakdown:');
for (const { event, count } of breakdown) {
  console.log(`    ${event}: ${count}`);
}

// Recent events table
interface RecentEvent {
  id: number;
  event: string;
  tool_name: string | null;
  hook_duration_ms: number | null;
}

const recentEvents = db
  .query<RecentEvent, [number]>(
    'SELECT id, event, tool_name, hook_duration_ms FROM events ORDER BY id DESC LIMIT ?',
  )
  .all(newEvents);

console.log('');
console.log('  Recent events:');

// Column widths
const idW = Math.max(2, ...recentEvents.map((e) => String(e.id).length));
const evW = Math.max(5, ...recentEvents.map((e) => e.event.length));
const tnW = Math.max(9, ...recentEvents.map((e) => (e.tool_name ?? '-').length));
const msW = Math.max(2, ...recentEvents.map((e) => String(e.hook_duration_ms ?? '-').length));

const header = `    ${'id'.padEnd(idW)}  ${'event'.padEnd(evW)}  ${'tool_name'.padEnd(tnW)}  ${'ms'.padStart(msW)}`;
const divider = `    ${'─'.repeat(idW)}  ${'─'.repeat(evW)}  ${'─'.repeat(tnW)}  ${'─'.repeat(msW)}`;
console.log(header);
console.log(divider);

for (const e of recentEvents) {
  const row = `    ${String(e.id).padEnd(idW)}  ${e.event.padEnd(evW)}  ${(e.tool_name ?? '-').padEnd(tnW)}  ${String(e.hook_duration_ms ?? '-').padStart(msW)}`;
  console.log(row);
}

db.close();

// ---------------------------------------------------------------------------
// 5. Web UI check
// ---------------------------------------------------------------------------
step('5. Web UI');

if (existsSync(PORT_FILE)) {
  const port = (await Bun.file(PORT_FILE).text()).trim();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const health = await res.text();
      pass(`Server running at http://127.0.0.1:${port}`);
      console.log(`  Health: ${health}`);
    } else {
      warn(`Port file exists (${port}) but server returned ${res.status}`);
      console.log('  Start manually: hookwatch ui');
    }
  } catch {
    warn(`Port file exists (${port}) but server not reachable`);
    console.log('  Start manually: hookwatch ui');
  }
} else {
  warn('No port file — server may have shut down (idle timeout)');
  console.log('  Start manually: hookwatch ui');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log('==========================');
if (newEvents > 0) {
  console.log(`${GREEN}E2e verification passed!${NC} (${newEvents} events captured)`);
} else {
  console.log(`${RED}E2e verification failed.${NC}`);
  process.exit(1);
}
