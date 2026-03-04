# Story 4.1: Hook Stdout Validation Schemas

Status: ready-for-dev

## Story

As a hookwatch developer,
I want Zod schemas for hook stdout output,
so that messages sent to Claude Code are validated before delivery.

## Acceptance Criteria

1. **Given** the hook stdout schema is defined, **when** a valid system message
   JSON is validated, **then** it passes with typed fields (message content,
   source hook name, event type).

2. **Given** a malformed stdout JSON is validated, **when** required fields are
   missing, **then** validation fails with a descriptive error, and the handler
   does not output invalid JSON to Claude Code.

## Tasks / Subtasks

- [ ] Create `src/schemas/output.ts` with base `hookOutputSchema` for generic hook output fields (AC: #1, #2)
- [ ] Define `preToolUseOutputSchema` extending base with `hookSpecificOutput` containing `permissionDecision`, `updatedInput`, `additionalContext` (AC: #1)
- [ ] Define `userPromptSubmitOutputSchema` extending base with `hookSpecificOutput` containing `additionalContext` (AC: #1)
- [ ] Apply `.strict()` on all output schemas — we control the output, no unknown fields allowed (AC: #1, #2)
- [ ] Add hookwatch-specific `systemMessage` field logic: message identifies source hook name and event type (AC: #1)
- [ ] Export inferred TypeScript types: `HookOutput`, `PreToolUseOutput`, `UserPromptSubmitOutput` (AC: #1)
- [ ] Create `src/schemas/output.test.ts` — tests for valid output passing, missing field rejection, strict mode rejecting unknown fields, systemMessage content validation (AC: #1, #2)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2)

## Dev Notes

### Schema Design

Bidirectional Zod validation pattern:

- **Stdin schemas** (Epic 1, Story 1.2): `src/schemas/events.ts` — validate incoming, use `.passthrough()` for forward compatibility
- **Stdout schemas** (this story): `src/schemas/output.ts` — validate outgoing, use `.strict()` because hookwatch controls the output

### Hook Output Format

Base output structure (any event):

```json
{
  "continue": true,
  "stopReason": "...",
  "suppressOutput": false,
  "systemMessage": "..."
}
```

- `continue` (boolean): whether Claude Code should continue processing
- `stopReason` (string, optional): reason for stopping if `continue` is false
- `suppressOutput` (boolean, optional): whether to suppress hook output display
- `systemMessage` (string, optional): injected system message — hookwatch uses this to identify source hook name and event type

### Event-Specific Output

PreToolUse decision output:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "...",
    "updatedInput": {},
    "additionalContext": "..."
  }
}
```

UserPromptSubmit output:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "..."
  }
}
```

### Exit Code Semantics

```csv
Code,Meaning,Stdout Behavior
0,Success,stdout parsed as JSON by Claude Code
2,Blocking error,stderr becomes error feedback (stdout ignored)
Other,Non-blocking error,stderr shown in verbose mode only (stdout ignored)
```

### Naming Conventions

- Schema names: camelCase + `Schema` suffix — `hookOutputSchema`, `preToolUseOutputSchema`, `userPromptSubmitOutputSchema`
- Inferred types: PascalCase — `type HookOutput = z.infer<typeof hookOutputSchema>`
- `.strict()` on all output schemas (contrast with `.passthrough()` on input schemas)

### hookwatch systemMessage Convention

The `systemMessage` field in hookwatch output identifies the source:

- Format: `"hookwatch: captured {EventType} event for {detail}"` (e.g., `"hookwatch: captured PreToolUse event for tool Bash"`)
- This enables Claude Code to attribute injected context to hookwatch

### Project Structure Notes

```text
src/
  schemas/
    events.ts        — stdin validation (18 event types) — Story 1.2
    output.ts        — stdout validation (hook → Claude Code) — this story
    output.test.ts   — co-located unit test
    query.ts         — query filter validation — Epic 2
```

- Path alias: `@/` maps to `./src/`
- File naming: kebab-case

### References

- [Source: ./docs/hook-stdin-schema.md#Hook Output Format]
- [Source: ./docs/hook-stdin-schema.md#PreToolUse Decision Output]
- [Source: ./docs/hook-stdin-schema.md#UserPromptSubmit Output]
- [Source: ./docs/hook-stdin-schema.md#Exit Codes]
- [Source: ./planning-artifacts/architecture.md#Data Architecture] — bidirectional validation
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules] — naming conventions
- [Source: ./planning-artifacts/epics.md#Story 4.1]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
