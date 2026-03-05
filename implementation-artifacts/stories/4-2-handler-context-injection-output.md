# Story 4.2: Handler Context Injection Output

Status: ready-for-dev

## Story

As a Claude Code developer,
I want hookwatch to output structured system messages to Claude Code,
so that the agent receives context about captured events.

## Acceptance Criteria

1. **Given** the handler successfully processes a hook event, **when** context
   injection is enabled, **then** the handler writes a valid JSON system message
   to stdout, and the message identifies the source hook name and event type.

2. **Given** the handler fails to deliver an event (server unreachable), **then**
   no stdout is written (exit 1 signals failure).

3. **Given** Claude Code reads the handler's stdout, **when** the JSON is parsed,
   **then** it conforms to the stdout validation schema from Story 4.1.

## Tasks / Subtasks

- [ ] Add context injection config option — opt-in via environment variable or config file (AC: #1)
- [ ] Modify `src/handler/index.ts` to build stdout output after successful POST to server (AC: #1, #3)
- [ ] Construct `systemMessage` identifying source hook name and event type from parsed stdin payload (AC: #1)
- [ ] Validate output against stdout schema (Story 4.1) before writing to stdout (AC: #3)
- [ ] Write validated JSON to stdout and exit 0 on success (AC: #1, #3)
- [ ] On POST failure (server unreachable after spawn+retry): exit 1, write nothing to stdout (AC: #2)
- [ ] Extend `src/handler/handler.test.ts` — test stdout output format, context injection enabled/disabled, failure path produces no stdout (AC: #1, #2, #3)
- [ ] Add integration test in `tests/handler-server.test.ts` — verify end-to-end stdout output conforms to schema (AC: #3)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2, #3)

## Dev Notes

### Handler Flow with Context Injection

Updated handler pipeline (extending Story 1.4):

1. Read stdin, validate with Zod (stdin schema from Story 1.2)
2. POST to `localhost:6004/api/events`
3. **If POST succeeds AND context injection enabled:**
   - Build output JSON with `systemMessage` identifying source hook + event type
   - Validate output against stdout schema (Story 4.1)
   - Write validated JSON to stdout
   - Exit 0
4. **If POST succeeds AND context injection disabled:**
   - Exit 0 (no stdout, same as current behavior)
5. **If POST fails** (server unreachable after spawn+retry):
   - Exit 1, NO stdout — prevents invalid JSON from reaching Claude Code

### Context Injection Toggle

Context injection is opt-in. Controlled by:

- Environment variable: `HOOKWATCH_CONTEXT_INJECTION=1` (or `true`)
- Config file: `~/.config/hookwatch/config.toml` with `context_injection = true`
- Environment variable takes precedence over config file
- Default: disabled (backward compatible — existing installations unaffected)

Config file parsing uses `smol-toml` (listed in `package.json` dependencies alongside Zod and citty — see Story 1.1 AC). Bun does not have built-in TOML support.

### systemMessage Content

Brief, structured summary using the `hook_event_name` field from the common stdin fields (present on every event):

- Format: `"hookwatch: captured {hook_event_name} event for {detail}"`
- Examples:
  - `"hookwatch: captured PreToolUse event for tool Bash"`
  - `"hookwatch: captured SessionStart event (source: startup)"`
  - `"hookwatch: captured UserPromptSubmit event"`

The detail varies by event type — tool name for tool events, source/reason for session events, event type alone for events without a natural detail field.

`systemMessage` is optional in the hook output schema (Zod: `z.optional(z.string())`). Not all hook invocations produce a `systemMessage` — when context injection is disabled or on failure, no `systemMessage` is present in stdout. The output JSON must still be structurally valid when `systemMessage` is omitted.

### Exit Code Contract

```csv
Scenario,Exit Code,Stdout,Behavior
POST success + injection enabled,0,Valid JSON,Claude Code parses stdout
POST success + injection disabled,0,None,Silent success
POST failure (server unreachable),1,None,Non-blocking error
Hook wants to block the action (PreToolUse / PreSubAgentStart),2,JSON with decision,Claude Code blocks the action
```

Exit code 2 is reserved for blocking actions (PreToolUse and PreSubAgentStart hooks that support blocking). hookwatch does not use exit 2 in its standard capture path — it is listed here for completeness and to avoid confusion with exit 1. If a future story adds blocking support, exit 2 is the correct mechanism.

### Error Safety

- The handler must NEVER write malformed JSON to stdout — Claude Code silently ignores it but the user gets no feedback
- Validate with Zod before writing: if validation fails, log error to stderr and exit 0 without stdout (graceful degradation)
- All errors caught — no exception propagates to Claude Code (NFR5)

### Project Structure Notes

```text
src/
  handler/
    index.ts         — modify to add stdout output (this story)
    spawn.ts         — server spawn logic (Story 1.5, unchanged)
    handler.test.ts  — extend with context injection tests
  schemas/
    events.ts        — stdin validation (Story 1.2)
    output.ts        — stdout validation (Story 4.1, dependency)
tests/
  handler-server.test.ts  — integration test for stdout output format
```

- Path alias: `@/` maps to `./src/` (tsconfig.json `paths`, Bun supports natively)
- File naming: kebab-case
- This story modifies existing files — no new files created except integration test additions
- Note: AGENTS.md shows an older file layout (`hooks/handler.ts`, `src/db.ts`, `src/server.ts`). That structure is outdated. The authoritative layout is `planning-artifacts/architecture.md#Complete Project Directory Structure`. Use the paths in this story, not AGENTS.md file structure.

### Dependencies

- **Story 4.1** (Hook Stdout Validation Schemas): must be completed first — this story imports and uses the output schemas
- **Story 1.4** (Hook Handler): the handler being modified must exist

### References

- [Source: ./docs/hook-stdin-schema.md#Hook Output Format]
- [Source: ./docs/hook-stdin-schema.md#Exit Codes]
- [Source: ./planning-artifacts/architecture.md#Process Patterns] — exit code contract
- [Source: ./planning-artifacts/architecture.md#Architectural Boundaries] — handler-server boundary
- [Source: ./planning-artifacts/architecture.md#FR → Directory Mapping] — FR27-28 in src/handler/
- [Source: ./planning-artifacts/architecture.md#Data Architecture] — bidirectional validation
- [Source: ./planning-artifacts/epics.md#Story 4.2]
- [Source: ./planning-artifacts/prd.md#Context Injection]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
