# Hook Stdin Schema Reference

Status: Draft
Created: 20260224, updated 20260225
Source: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks),
cross-verified against [hooks changelog](../changelog) 20260225.

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

### Environment Variables

These are passed to the hook process as env vars (not in stdin JSON):

```csv
Variable,Since,Description
CLAUDE_PLUGIN_ROOT,—,Absolute path to plugin root (plugin hooks only)
CLAUDE_PROJECT_DIR,1.0.58,Absolute path to the project directory
```

### Hook Config Options

Per-hook configuration in hooks.json:

```csv
Option,Type,Since,Description
matcher,string,—,Regex matched against event-specific field (see Matcher Target Summary)
type,string,—,"command (shell command) or prompt (LLM evaluation)"
command,string,—,Shell command to execute (type=command)
once,boolean,2.1.0,"If true, hook runs only once per session"
model,string,2.0.36,Model to use for prompt-based hooks (type=prompt)
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

### InstructionsLoaded

Present in [Agent SDK types](https://platform.claude.com/docs/en/agent-sdk/typescript)
(`InstructionsLoadedHookInput`) but not yet documented in the
[hooks reference](https://code.claude.com/docs/en/hooks).

```csv
Field,Type,Required,Values
trigger,string,yes,"init, maintenance"
```

- **Matcher target:** unknown (undocumented)

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

## Event Count

**18 events.** 17 are documented in the
[hooks reference](https://code.claude.com/docs/en/hooks). InstructionsLoaded is the 18th —
present in the
[Agent SDK types](https://platform.claude.com/docs/en/agent-sdk/typescript)
(`@anthropic-ai/claude-agent-sdk`) but not yet in the hooks reference.

```text
SessionStart    SessionEnd       UserPromptSubmit  PreToolUse
PostToolUse     PostToolUseFailure  PermissionRequest  Notification
SubagentStart   SubagentStop     Stop              PreCompact
TeammateIdle    TaskCompleted    ConfigChange      WorktreeCreate
WorktreeRemove  InstructionsLoaded*
```

\* SDK-only — not in hooks reference docs.

### Not events

`SlashCommand` and `SkillStart` appear in conclaude's source code but are NOT
Claude Code hook events. Claude Code 2.1.0 added "hooks support for skill and
slash command frontmatter" — this lets skills/commands define hooks using
existing events (PreToolUse, PostToolUse, Stop), not new event types. conclaude
implements them internally by parsing UserPromptSubmit prompts and SubagentStart
payloads.

hookwatch's unknown-event resilience (FR-1) handles any future events
gracefully if they appear.

## Sources

```csv
Source,URL,Content
Hooks reference,https://code.claude.com/docs/en/hooks,"17 events, narrative + JSON examples"
Agent SDK types,https://platform.claude.com/docs/en/agent-sdk/typescript,"18 events, TypeScript type definitions (authoritative)"
Hooks changelog,./changelog (local),"Version history of every hook-related change"
```
