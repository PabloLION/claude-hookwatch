# Hook Events

hookwatch captures all 18 Claude Code hook event types. Each event is stored
with its full stdin payload in the SQLite database.

## Event Types

| Event | Description | Category |
|-------|-------------|----------|
| SessionStart | Session begins | Lifecycle |
| SessionEnd | Session ends | Lifecycle |
| Stop | Agent stops | Lifecycle |
| PreToolUse | Before a tool executes | Tool |
| PostToolUse | After a tool executes successfully | Tool |
| PostToolUseFailure | After a tool execution fails | Tool |
| UserPromptSubmit | User submits a prompt | Input |
| PermissionRequest | Permission is requested | Input |
| Notification | System notification | System |
| ConfigChange | Configuration changed | System |
| InstructionsLoaded | Instructions loaded | System |
| PreCompact | Before context compaction | System |
| SubagentStart | Sub-agent spawned | Agent |
| SubagentStop | Sub-agent finished | Agent |
| TaskCompleted | Task marked complete | Agent |
| TeammateIdle | Teammate becomes idle | Agent |
| WorktreeCreate | Git worktree created | Workspace |
| WorktreeRemove | Git worktree removed | Workspace |

## Event Categories

### Lifecycle Events

**SessionStart** — Fires when a Claude Code session begins. Contains the
session ID that links all subsequent events.

**SessionEnd** — Fires when the session ends normally.

**Stop** — Fires when the agent stops execution (may occur multiple times per
session if the agent pauses and resumes).

### Tool Events

**PreToolUse** — Fires before each tool call. Contains the tool name and input
parameters. This is the most frequent event type in a typical session.

**PostToolUse** — Fires after a successful tool call. Contains the tool output.

**PostToolUseFailure** — Fires after a tool call fails. Contains the error
information.

### Input Events

**UserPromptSubmit** — Fires when the user submits a prompt. Contains the
prompt text.

**PermissionRequest** — Fires when Claude Code requests permission to perform
an action. Contains the tool name and operation details.

### System Events

**Notification** — System notifications with subtypes: `permission_prompt`,
`idle_prompt`, `auth_success`, `elicitation_dialog`.

**ConfigChange** — Fires when the Claude Code configuration changes.

**InstructionsLoaded** — Fires when CLAUDE.md or other instruction files are
loaded. Present in the
[Agent SDK types](https://platform.claude.com/docs/en/agent-sdk/typescript)
but not yet in the hooks reference docs.

**PreCompact** — Fires before context compaction (when the conversation is
too long and needs to be summarized).

### Agent Events

**SubagentStart** / **SubagentStop** — Fire when sub-agents are spawned and
completed.

**TaskCompleted** — Fires when a task is marked as complete.

**TeammateIdle** — Fires when a teammate agent becomes idle (interactive
agent teams feature).

### Workspace Events

**WorktreeCreate** / **WorktreeRemove** — Fire when git worktrees are created
or removed.

## Common Fields

Every event includes these fields in its stdin payload:

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | Unique session identifier |
| `hook_event_name` | string | Event type name |
| `cwd` | string | Working directory |

Tool events additionally include:

| Field | Type | Description |
|-------|------|-------------|
| `tool_name` | string | Name of the tool |
| `tool_input` | object | Tool input parameters |

For the full stdin schema, see [Hook Input Schema](/reference/hook-stdin-schema).

## Source of Truth

hookwatch uses the `EVENT_NAMES` array in `src/types.ts` as the single source
of truth for all event types. If Claude Code adds new events, they are
automatically handled — unknown events are stored with event type `"unknown"`.

## Reference

- 17 events are documented in the [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- InstructionsLoaded is the 18th — present in the [Agent SDK](https://platform.claude.com/docs/en/agent-sdk/typescript)
