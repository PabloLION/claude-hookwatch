/**
 * Benchmark: Zod validation overhead for EventRow parsing.
 *
 * Scope: eventRowSchema only (14 fields, 7 nullable). Results do NOT
 * generalize to other schemas — overhead scales with field count and
 * constraint complexity.
 *
 * Measures the cost of adding Zod validation to JSON.parse at the SSE/fetch
 * boundary (ch-halr.4). Three measurements:
 *
 *   1. JSON.parse only          — baseline
 *   2. JSON.parse + Zod         — real-world cost (this is the one that matters)
 *   3. Zod validate only        — isolated Zod cost (pre-parsed object)
 *
 * The real overhead of adding Zod is (2) - (1), not (3) alone.
 * (3) is lower than (2)-(1) due to GC pressure and cache effects in the
 * combined loop.
 *
 * Usage: bun scripts/benchmark/zod-validation-overhead.ts
 */

import { eventRowSchema } from '../../src/schemas/rows.ts';

const WARMUP_ITERATIONS = 1_000;
const BENCH_ITERATIONS = 10_000;

const row = {
  id: 1,
  timestamp: Date.now(),
  event: 'PreToolUse',
  session_id: 'f8b0e97c-a19e-461a-8290-05a5c03d3d8f',
  cwd: '/home/user/project',
  tool_name: 'Bash',
  session_name: null,
  hook_duration_ms: 42,
  stdin: '{"hook_event_name":"PreToolUse","tool_name":"Bash"}',
  wrapped_command: null,
  stdout: null,
  stderr: null,
  exit_code: 0,
  hookwatch_log: null,
};

const json = JSON.stringify(row);

// Warm up JIT
for (let i = 0; i < WARMUP_ITERATIONS; i++) {
  eventRowSchema.parse(JSON.parse(json));
}

// 1. JSON.parse only
let t0 = performance.now();
for (let i = 0; i < BENCH_ITERATIONS; i++) {
  JSON.parse(json);
}
let t1 = performance.now();
const jsonParseUs = ((t1 - t0) / BENCH_ITERATIONS) * 1000;

// 2. JSON.parse + Zod
t0 = performance.now();
for (let i = 0; i < BENCH_ITERATIONS; i++) {
  eventRowSchema.parse(JSON.parse(json));
}
t1 = performance.now();
const jsonParseZodUs = ((t1 - t0) / BENCH_ITERATIONS) * 1000;

// 3. Zod validate only (pre-parsed)
const parsed = JSON.parse(json);
t0 = performance.now();
for (let i = 0; i < BENCH_ITERATIONS; i++) {
  eventRowSchema.parse(parsed);
}
t1 = performance.now();
const zodOnlyUs = ((t1 - t0) / BENCH_ITERATIONS) * 1000;

const overheadUs = jsonParseZodUs - jsonParseUs;

console.log(`JSON.parse only:      ${jsonParseUs.toFixed(1)} μs/call`);
console.log(`JSON.parse + Zod:     ${jsonParseZodUs.toFixed(1)} μs/call`);
console.log(`Zod validate only:    ${zodOnlyUs.toFixed(1)} μs/call`);
console.log(`---`);
console.log(`Real overhead (2)-(1): ${overheadUs.toFixed(1)} μs/call`);
console.log(`At 10 events/sec:      ${(overheadUs * 10).toFixed(1)} μs/sec`);
