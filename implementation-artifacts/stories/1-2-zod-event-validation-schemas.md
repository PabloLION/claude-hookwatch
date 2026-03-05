# Story 1.2: Zod Event Validation Schemas

Status: ready-for-dev

## Story

As a hookwatch handler,
I want Zod schemas for all 18 event types,
so that incoming stdin payloads are validated with strict known fields and permissive unknown fields.

## Acceptance Criteria

1. **Given** a valid `PreToolUse` stdin JSON payload, **when** parsed through the
   event schema, **then** known fields are typed and validated, and unknown fields
   are preserved in the output (not stripped).

2. **Given** a payload with an unknown event type (e.g., `"event": "FutureEvent"`),
   **when** parsed through the schema, **then** it passes validation using the
   fallback schema, and the full payload is preserved.

3. **Given** a payload missing required fields (e.g., no `session_id`), **when**
   parsed through the schema, **then** validation fails with a descriptive Zod
   error.

## Tasks / Subtasks

- [ ] Create `src/schemas/events.ts` with common fields schema shared by all events (AC: #1, #3)
- [ ] Define Zod schemas for all 18 event types with event-specific fields (AC: #1)
- [ ] Apply `.passthrough()` on all schemas to preserve unknown fields (AC: #1, #2)
- [ ] Create fallback schema for unknown event types — accepts any valid JSON with common fields (AC: #2)
- [ ] Create discriminated parse function that routes by `hook_event_name` to the correct schema (AC: #1, #2)
- [ ] Export inferred TypeScript types for all 18 event types (AC: #1)
- [ ] Create `src/schemas/events.test.ts` with tests for each event type, unknown event handling, and missing field rejection (AC: #1, #2, #3)
- [ ] Run Biome lint + `bun test` to verify (AC: #1, #2, #3)

## Dev Notes

### Schema Strategy

- Strict on known fields (typed and validated), permissive on unknown fields (`.passthrough()`)
- Every schema extends the common fields schema
- Fallback schema for unknown/future event types: validate common fields exist, accept everything else
- This is stdin-only (Claude Code -> hook). Stdout schemas (`src/schemas/output.ts`) are Epic 4

### Common Fields (All Events)

```csv
Field,Type,Zod Type,Required
session_id,string,z.string(),yes
transcript_path,string,z.string(),yes
cwd,string,z.string(),yes
permission_mode,z.enum(["default","plan","acceptEdits","dontAsk","bypassPermissions"]),z.enum([...]),yes
hook_event_name,string,z.string(),yes
```

Note: `permission_mode` has a documented fixed set of values — use `z.enum()` for type safety.

### 18 Event Types and Event-Specific Fields

```csv
Event,Key Fields,Matcher Target,Zod Notes
SessionStart,"source, model, agent_type?",source,"source: z.enum(['startup','resume','clear','compact']); model: z.string() (free-form model identifier — do not enum)"
SessionEnd,reason,reason,"reason: z.enum(['clear','logout','prompt_input_exit','bypass_permissions_disabled','other'])"
UserPromptSubmit,prompt,none,
PreToolUse,"tool_name, tool_use_id, tool_input",tool_name,"tool_input: z.record(z.unknown()) — arbitrary JSON object varying by tool"
PostToolUse,"tool_name, tool_use_id, tool_input, tool_response",tool_name,"tool_input: z.record(z.unknown()); tool_response: z.record(z.unknown()) — tool-specific result"
PostToolUseFailure,"tool_name, tool_use_id, tool_input, error, is_interrupt?",tool_name,"tool_input: z.record(z.unknown())"
PermissionRequest,"tool_name, tool_input, permission_suggestions?",tool_name,"NO tool_use_id — absent by design (unlike PreToolUse/PostToolUse); tool_input: z.record(z.unknown())"
Notification,"message, title?, notification_type",notification_type,"notification_type: z.enum(['permission_prompt','idle_prompt','auth_success','elicitation_dialog'])"
SubagentStart,"agent_id, agent_type",agent_type,
SubagentStop,"agent_id, agent_type, stop_hook_active, agent_transcript_path, last_assistant_message",agent_type,
Stop,"stop_hook_active, last_assistant_message",none,
PreCompact,"trigger, custom_instructions",trigger,"trigger: z.enum(['manual','auto'])"
TeammateIdle,"teammate_name, team_name",none,
TaskCompleted,"task_id, task_subject, task_description?, teammate_name?, team_name?",none,
ConfigChange,"source, file_path?",source,"source: z.enum(['user_settings','project_settings','local_settings','policy_settings','skills'])"
WorktreeCreate,name,none,
WorktreeRemove,worktree_path,none,
Setup,trigger,unknown,"trigger: z.enum(['init','maintenance']) — SDK-only event; matcher target undocumented"
```

Key Zod type decisions:

- Enum fields: use `z.enum([...])` for fields with a documented fixed set of values (source, reason, trigger, notification_type, permission_mode, ConfigChange source). Prefer `z.enum()` over `z.union(z.literal(...))` for readability.
- `model` in SessionStart: use `z.string()` — it is a free-form model identifier (e.g., `"claude-sonnet-4-6"`), not a closed enum. New models ship without schema changes.
- `tool_input` / `tool_response`: use `z.record(z.unknown())` — the object structure varies per tool. Do not attempt per-tool sub-schemas here; capture the raw shape and let callers narrow as needed.
- `PermissionRequest.tool_use_id`: this field is **absent** from PermissionRequest (confirmed in `docs/hook-stdin-schema.md`). Do not add it, not even as `z.optional()` — it is structurally different from PreToolUse/PostToolUse.

### Naming Conventions

- Schema names: camelCase + `Schema` suffix — `sessionStartSchema`, `preToolUseSchema`
- Inferred types: PascalCase — `type SessionStart = z.infer<typeof sessionStartSchema>`
- Discriminator: use `hook_event_name` field to route to the correct schema

### Parse Function Design

The parse function should:

1. Attempt to parse the raw JSON
2. Read `hook_event_name` from the parsed object
3. Look up the corresponding schema in a `Record<string, ZodSchema>` map
4. If found, parse with that schema (strict known + passthrough unknown)
5. If not found, parse with the fallback schema (common fields + passthrough)
6. Return a discriminated union or the parsed result with full type info

### Project Structure Notes

This story creates files under `src/schemas/`. The full project layout (for context) is:

```text
src/
  handler/           — hook entry point, spawn logic
  server/            — Bun.serve(), ingest, query, SSE, health, static
  db/                — schema, migrations, query helpers, connection
  schemas/
    events.ts        — Zod schemas for all 18 event types (stdin)  ← this story
    events.test.ts   — co-located unit test                        ← this story
    output.ts        — Zod schemas for hook stdout (Epic 4)
    query.ts         — Zod schema for POST /api/query filter (Story 1.3+)
  ui/                — Preact + htm components
  cli/               — citty subcommands (install, uninstall, open, wrap)
```

Import alias: `@/` maps to `./src/` (tsconfig paths). Use `@/schemas/events` not relative paths.

### References

- [Source: ./docs/hook-stdin-schema.md] — complete field definitions per event type
- [Source: ./planning-artifacts/architecture.md#Bidirectional validation]
- [Source: ./planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: ./planning-artifacts/epics.md#Story 1.2]
- [Source: ./planning-artifacts/prd.md#Event Capture]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
