# Hook Stdin Schema Reference

Status: Draft
Created: 20260224
Source: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks),
cross-verified 20260224.

Complete reference for the JSON payload Claude Code sends to hooks via stdin.
Used by hookwatch to define TypeScript interfaces and Zod validation schemas.

## Common Fields (All Events)

Every hook event includes these fields:

```csv
Field,Type,Description
session_id,string,"UUID v4 (e.g. f8b0e97c-a19e-461a-8290-05a5c03d3d8f). Stable across resume/clear/compact within a session."
transcript_path,string,Absolute path to conversation JSONL file
cwd,string,Working directory when hook fires
permission_mode,string,"One of: default, plan, acceptEdits, dontAsk, bypassPermissions"
hook_event_name,string,Event name that triggered this hook (matches the key in hooks.json)
```

## Event-Specific Fields

For each event: the fields on stdin, the matcher target (what Claude Code
matches against in hooks.json), and whether the matcher target is included in
stdin.

### SessionStart

```csv
Field,Type,Required,Values
source,string,yes,"startup, resume, clear, compact"
model,string,yes,"Model identifier (e.g. claude-sonnet-4-6)"
agent_type,string,no,Only present if --agent flag was used
```

- **Matcher target:** `source`
- **Matcher target in stdin:** yes

### SessionEnd

```csv
Field,Type,Required,Values
reason,string,yes,"clear, logout, prompt_input_exit, bypass_permissions_disabled, other"
```

- **Matcher target:** `reason`
- **Matcher target in stdin:** yes

### UserPromptSubmit

```csv
Field,Type,Required,Values
prompt,string,yes,The text the user submitted
```

- **Matcher target:** none (always fires)

### PreToolUse

```csv
Field,Type,Required,Description
tool_name,string,yes,"Bash, Edit, Write, Read, Glob, Grep, Task, WebFetch, WebSearch, AskUserQuestion, mcp__* (MCP tools)"
tool_use_id,string,yes,"e.g. toolu_01ABC123..."
tool_input,object,yes,Structure varies by tool (see Tool Input Schemas below)
```

- **Matcher target:** `tool_name`
- **Matcher target in stdin:** yes

### PostToolUse

```csv
Field,Type,Required,Description
tool_name,string,yes,Same values as PreToolUse
tool_use_id,string,yes,"e.g. toolu_01ABC123..."
tool_input,object,yes,Same structure as PreToolUse
tool_response,object,yes,Tool-specific result
```

- **Matcher target:** `tool_name`
- **Matcher target in stdin:** yes

### PostToolUseFailure

```csv
Field,Type,Required,Description
tool_name,string,yes,Same values as PreToolUse
tool_use_id,string,yes,"e.g. toolu_01ABC123..."
tool_input,object,yes,Same structure as PreToolUse
error,string,yes,Error description
is_interrupt,boolean,no,Whether failure was caused by user interruption
```

- **Matcher target:** `tool_name`
- **Matcher target in stdin:** yes

### PermissionRequest

```csv
Field,Type,Required,Description
tool_name,string,yes,Same values as PreToolUse
tool_input,object,yes,Same structure as PreToolUse
permission_suggestions,array,no,"e.g. [{ type: toolAlwaysAllow, tool: Bash }]"
```

- **Matcher target:** `tool_name`
- **Matcher target in stdin:** yes
- **Note:** no `tool_use_id` (unlike PreToolUse/PostToolUse)

### Notification

```csv
Field,Type,Required,Values
message,string,yes,Notification text
title,string,no,Optional title
notification_type,string,yes,"permission_prompt, idle_prompt, auth_success, elicitation_dialog"
```

- **Matcher target:** `notification_type`
- **Matcher target in stdin:** yes

### SubagentStart

```csv
Field,Type,Required,Description
agent_id,string,yes,Unique identifier for the subagent
agent_type,string,yes,"Bash, Explore, Plan, or custom agent names"
```

- **Matcher target:** `agent_type`
- **Matcher target in stdin:** yes

### SubagentStop

```csv
Field,Type,Required,Description
agent_id,string,yes,Unique identifier for the subagent
agent_type,string,yes,Same values as SubagentStart
stop_hook_active,boolean,yes,Whether a stop hook is already continuing
agent_transcript_path,string,yes,Path to subagent's transcript in subagents/ folder
last_assistant_message,string,yes,Text of the subagent's final response
```

- **Matcher target:** `agent_type`
- **Matcher target in stdin:** yes

### Stop

```csv
Field,Type,Required,Description
stop_hook_active,boolean,yes,true when Claude is already continuing due to a stop hook
last_assistant_message,string,yes,Text of Claude's final response
```

- **Matcher target:** none (always fires)

### PreCompact

```csv
Field,Type,Required,Values
trigger,string,yes,"manual, auto"
custom_instructions,string,yes,User's /compact argument for manual; empty for auto
```

- **Matcher target:** `trigger`
- **Matcher target in stdin:** yes

### TeammateIdle

```csv
Field,Type,Required,Description
teammate_name,string,yes,Name of the teammate about to go idle
team_name,string,yes,Name of the team
```

- **Matcher target:** none (always fires)

### TaskCompleted

```csv
Field,Type,Required,Description
task_id,string,yes,Task identifier
task_subject,string,yes,Task title
task_description,string,no,Detailed description (may be absent)
teammate_name,string,no,Name of the teammate (may be absent)
team_name,string,no,Name of the team (may be absent)
```

- **Matcher target:** none (always fires)

### ConfigChange

```csv
Field,Type,Required,Values
source,string,yes,"user_settings, project_settings, local_settings, policy_settings, skills"
file_path,string,no,Path to the changed file
```

- **Matcher target:** `source`
- **Matcher target in stdin:** yes

### WorktreeCreate

```csv
Field,Type,Required,Description
name,string,yes,"Slug identifier for the worktree (e.g. bold-oak-a3f2)"
```

- **Matcher target:** none (always fires)

### WorktreeRemove

```csv
Field,Type,Required,Description
worktree_path,string,yes,Absolute path to the worktree being removed
```

- **Matcher target:** none (always fires)

## Matcher Target Summary

Every matcher target field is included in the stdin payload. hookwatch uses
`".*"` for all matchers to capture everything.

```csv
Matcher Target,Events,In Stdin
tool_name,"PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest",yes
source,SessionStart,yes
reason,SessionEnd,yes
notification_type,Notification,yes
agent_type,"SubagentStart, SubagentStop",yes
trigger,PreCompact,yes
source (ConfigChange),ConfigChange,yes
(none — always fires),"UserPromptSubmit, Stop, TeammateIdle, TaskCompleted, WorktreeCreate, WorktreeRemove",n/a
```

**Conclusion:** No data is hidden behind the matcher. hookwatch receives the
full payload for every event.

## Tool Input Schemas (PreToolUse/PostToolUse/PostToolUseFailure)

The `tool_input` object varies by tool:

```csv
Tool,Fields
Bash,"command: string, description?: string, timeout?: number, run_in_background?: boolean"
Write,"file_path: string, content: string"
Edit,"file_path: string, old_string: string, new_string: string, replace_all?: boolean"
Read,"file_path: string, offset?: number, limit?: number"
Glob,"pattern: string, path?: string"
Grep,"pattern: string, path?: string, glob?: string, output_mode?: string"
WebFetch,"url: string, prompt: string"
WebSearch,"query: string, allowed_domains?: string[], blocked_domains?: string[]"
Task,"prompt: string, description?: string, subagent_type?: string, model?: string"
```

MCP tools (`mcp__<server>__<tool>`) have tool-specific input schemas defined by
the MCP server.

## Hook Output Format

### Exit Codes

```csv
Code,Meaning,Behavior
0,Success,stdout parsed for JSON
2,Blocking error,stderr becomes error feedback to the agent
Other,Non-blocking error,stderr shown in verbose mode only
```

### JSON Output (Any Event)

```json
{
  "continue": true,
  "stopReason": "...",
  "suppressOutput": false,
  "systemMessage": "..."
}
```

### PreToolUse Decision Output

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

Note: top-level `decision`/`reason` fields are deprecated in favor of
`hookSpecificOutput.permissionDecision`/`hookSpecificOutput.permissionDecisionReason`.

## Unconfirmed Events

The following event names appear in upstream tools (conclaude) but are NOT found
in official Claude Code documentation as of 20260224:

- `SlashCommand`
- `SkillStart`

These may be community inventions or undocumented. hookwatch's unknown-event
resilience (FR-1) handles them gracefully if they appear.

## Confirmed Event Count

**19 confirmed events:** SessionStart, SessionEnd, UserPromptSubmit, PreToolUse,
PostToolUse, PostToolUseFailure, PermissionRequest, Notification, SubagentStart,
SubagentStop, Stop, PreCompact, TeammateIdle, TaskCompleted, ConfigChange,
WorktreeCreate, WorktreeRemove, and 2 unconfirmed (SlashCommand, SkillStart).
