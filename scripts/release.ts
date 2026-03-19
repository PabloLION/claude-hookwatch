#!/usr/bin/env bun
/**
 * release.ts — Pre-release validation and git tagging for hookwatch.
 *
 * Usage:
 *   bun scripts/release.ts <version>             # Validate and tag
 *   bun scripts/release.ts <version> --dry-run   # Validate only, no tag
 *
 * Version accepts "v" prefix or bare: v0.1.0, 0.1.0, v1.2.3-beta.1
 * Must be valid semver and match the version in package.json.
 *
 * Checklist:
 *   1. Argument validation (semver, matches package.json)
 *   2. Clean working tree
 *   3. Tests pass (bun run test)
 *   4. Lint passes (biome check .)
 *   5. Version consistency (package.json <-> plugin.json)
 *   6. Plugin structure valid
 *   7. Plugin files freshness
 *   8. Create annotated git tag vX.Y.Z
 *
 * After tagging, run: bun scripts/e2e-verify.ts <plugin-dir>
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT_ROOT = resolve(import.meta.dir, '..');

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BOLD = '\x1b[1m';
const NC = '\x1b[0m';

function pass(msg: string): void {
  console.log(`  ${GREEN}✓${NC} ${msg}`);
}
function fail(msg: string): never {
  console.error(`  ${RED}✗${NC} ${msg}`);
  process.exit(1);
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

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(cmd: string[], opts?: { cwd?: string }): Promise<RunResult> {
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? PROJECT_ROOT,
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

/** Run a command with stdout/stderr inherited (visible to user). */
async function runVisible(cmd: string[]): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: PROJECT_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

// ---------------------------------------------------------------------------
// Semver validation
// ---------------------------------------------------------------------------

const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(input: string): string | null {
  const bare = input.replace(/^[vV]/, '');
  return SEMVER_RE.test(bare) ? bare : null;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function usage(): never {
  console.log('Usage: bun scripts/release.ts <version> [--dry-run]');
  console.log('');
  console.log('  version    Semver with optional v prefix (e.g. v0.1.0, 0.1.0)');
  console.log('  --dry-run  Validate only, do not create git tag');
  process.exit(1);
}

let dryRun = false;
let versionArg: string | null = null;

for (const arg of process.argv.slice(2)) {
  if (arg === '--dry-run') {
    dryRun = true;
  } else if (arg === '--help' || arg === '-h') {
    usage();
  } else if (arg.startsWith('-')) {
    console.error(`Unknown flag: ${arg}`);
    usage();
  } else {
    if (versionArg !== null) {
      console.error(`Unexpected argument: ${arg} (version already set to ${versionArg})`);
      usage();
    }
    versionArg = arg;
  }
}

if (versionArg === null) {
  console.error('Error: version argument is required.\n');
  usage();
}

const semver = parseSemver(versionArg);
if (semver === null) {
  console.error(`Error: '${versionArg}' is not valid semver.`);
  console.error('');
  console.error('Expected format: [v]MAJOR.MINOR.PATCH[-prerelease][+build]');
  console.error('Examples: v0.1.0, 1.0.0, 0.2.0-beta.1');
  process.exit(1);
}

const tag = `v${semver}`;

// ---------------------------------------------------------------------------
// Read project files
// ---------------------------------------------------------------------------

const pkgJson = (await Bun.file(resolve(PROJECT_ROOT, 'package.json')).json()) as {
  name: string;
  version: string;
  description: string;
};

const pluginJsonPath = resolve(PROJECT_ROOT, '.claude-plugin/plugin.json');
const hooksJsonPath = resolve(PROJECT_ROOT, 'hooks/hooks.json');

console.log(`${BOLD}hookwatch release validation${NC}`);
console.log('============================');
console.log(`  Version: ${semver}  Tag: ${tag}`);

// ---------------------------------------------------------------------------
// 1. Version matches package.json
// ---------------------------------------------------------------------------
step('1. Version check');

if (!pkgJson.version) {
  fail('No version found in package.json');
}
if (semver !== pkgJson.version) {
  fail(`Version mismatch: argument=${semver}, package.json=${pkgJson.version}`);
}
pass(`Argument matches package.json (${pkgJson.version})`);

// ---------------------------------------------------------------------------
// 2. Clean working tree
// ---------------------------------------------------------------------------
step('2. Working tree');

const gitStatus = await run(['git', 'status', '--porcelain']);
if (gitStatus.stdout.length > 0) {
  console.log(gitStatus.stdout);
  fail('Working tree is not clean. Commit or stash changes first.');
}
pass('Clean working tree');

// ---------------------------------------------------------------------------
// 3. Tests
// ---------------------------------------------------------------------------
step('3. Test suite');

const testExit = await runVisible(['bun', 'run', 'test']);
if (testExit !== 0) {
  fail('Tests failed');
}
pass('All tests pass');

// ---------------------------------------------------------------------------
// 4. Lint
// ---------------------------------------------------------------------------
step('4. Lint');

const lintExit = await runVisible(['bun', 'run', 'lint']);
if (lintExit !== 0) {
  fail('Lint check failed');
}
pass('Biome check passes');

// ---------------------------------------------------------------------------
// 5. Version consistency (package.json <-> plugin.json)
// ---------------------------------------------------------------------------
step('5. Version consistency');

if (!existsSync(pluginJsonPath)) {
  fail('Missing .claude-plugin/plugin.json');
}
const pluginJson = (await Bun.file(pluginJsonPath).json()) as { version: string };
if (pkgJson.version !== pluginJson.version) {
  fail(
    `Version mismatch: package.json=${pkgJson.version}, plugin.json=${pluginJson.version} — run 'bun run generate'`,
  );
}
pass(`package.json = plugin.json (${pkgJson.version})`);

// ---------------------------------------------------------------------------
// 6. Plugin structure
// ---------------------------------------------------------------------------
step('6. Plugin structure');

if (!existsSync(hooksJsonPath)) {
  fail('Missing hooks/hooks.json');
}

const hooksJson = (await Bun.file(hooksJsonPath).json()) as { hooks: Record<string, unknown> };
const hookCount = Object.keys(hooksJson.hooks).length;
if (hookCount !== 18) {
  fail(`Expected 18 event types in hooks.json, found ${hookCount}`);
}
pass(`Plugin structure valid (manifest + ${hookCount} hook events)`);

// ---------------------------------------------------------------------------
// 7. Plugin files freshness
// ---------------------------------------------------------------------------
step('7. Plugin files freshness');

const expectedPluginJson = {
  name: pkgJson.name,
  version: pkgJson.version,
  description: pkgJson.description,
  author: { name: 'PabloLION' },
};

const actualPluginJsonFull = await Bun.file(pluginJsonPath).json();
const expectedStr = JSON.stringify(expectedPluginJson, Object.keys(expectedPluginJson).sort());
const actualStr = JSON.stringify(actualPluginJsonFull, Object.keys(expectedPluginJson).sort());

if (expectedStr !== actualStr) {
  warn("plugin.json may be stale — run 'bun run generate' to refresh");
  console.log(`    Expected: ${JSON.stringify(expectedPluginJson)}`);
  console.log(`    Actual:   ${JSON.stringify(actualPluginJsonFull)}`);
} else {
  pass('plugin.json content matches package.json');
}

// ---------------------------------------------------------------------------
// 8. Git tag
// ---------------------------------------------------------------------------
step('8. Git tag');

const tagCheck = await run(['git', 'tag', '-l', tag]);
if (tagCheck.stdout.includes(tag)) {
  fail(`Tag ${tag} already exists. Delete it first or bump version.`);
}

if (dryRun) {
  warn(`Dry run — would create tag ${tag}`);
} else {
  const tagResult = await run(['git', 'tag', '-a', tag, '-m', `Release ${tag}`]);
  if (tagResult.exitCode !== 0) {
    fail(`Failed to create tag: ${tagResult.stderr}`);
  }
  pass(`Created tag ${tag}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log('============================');
if (dryRun) {
  console.log('Dry run complete. No tag created.');
  console.log('Run without --dry-run to create the tag.');
} else {
  console.log(`${GREEN}Release ${tag} ready!${NC}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. E2e verify:  bun scripts/e2e-verify.ts ${PROJECT_ROOT}`);
  console.log(`  2. Push tag:    git push origin ${tag}`);
}
