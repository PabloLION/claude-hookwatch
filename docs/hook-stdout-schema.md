# Hook Stdout Schema Reference

Status: Draft
Created: 20260306, updated 20260310
Source: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks),
retrieved 20260306. Exit code behavior verified empirically 20260308–20260310.

Complete reference for the JSON output a hook can return to Claude Code via
stdout. Used by hookwatch to define TypeScript interfaces and Zod validation
schemas for context injection (Epic 4).

## Exit Code Behavior

Exit code is the primary dispatch mechanism — Claude Code reads it before
deciding whether to parse stdout at all.

```csv
Exit Code,JSON Parsed?,Behavior
0,Yes,"stdout parsed for JSON output fields; normal execution continues"
2,No*,"JSON ignored; stderr only; may block depending on event (see per-event table)"
Other non-zero,No,"non-blocking; stderr shown in verbose mode only"
```

\* Upstream bug #30586: JSON is accidentally parsed at exit 2 in some Claude
Code versions — a regression that will be fixed. Do not rely on this behavior.

### Signal exit codes

When a hook process is killed by a signal, the exit code follows the Unix
128+N convention.

```csv
Exit Code,Signal,Description
129,SIGHUP,"likely terminal hangup"
130,SIGINT,"likely interrupted (Ctrl-C)"
131,SIGQUIT,"likely quit"
134,SIGABRT,"likely aborted"
137,SIGKILL,"likely forced termination"
139,SIGSEGV,"likely segmentation fault"
141,SIGPIPE,"likely broken pipe"
143,SIGTERM,"likely terminated"
```

Note: "likely" because the 128+N convention is widely followed but not
mandated. macOS and Linux differ on some signal numbers. Claude Code empirically
treats all signal exits as non-blocking (same behavior as other non-zero codes).

### Per-event blocking table (exit 2)

Exit 2 blocks or adds feedback depending on the event type.

```csv
Event,Blocks on exit 2?,Effect
PreToolUse,Yes,blocks the tool call
PermissionRequest,Yes,denies the permission
UserPromptSubmit,Yes,blocks the prompt
Stop,Yes,prevents Claude from stopping
PostToolUse,No,"stderr fed back to Claude as tool result error"
PostToolUseFailure,No,stderr shown in verbose mode
SessionStart,No,stderr shown to user only
SessionEnd,No,stderr shown in verbose mode
SubagentStart,No,stderr shown in verbose mode
SubagentStop,No,stderr shown in verbose mode
Notification,No,stderr shown in verbose mode
PreCompact,No,stderr shown in verbose mode
TeammateIdle,Yes,"exit 2 sends stderr as feedback, keeps teammate working"
TaskCompleted,Yes,"exit 2 prevents completion, sends stderr as feedback"
ConfigChange,No,stderr shown in verbose mode
WorktreeCreate,No,stderr shown in verbose mode
WorktreeRemove,No,stderr shown in verbose mode
InstructionsLoaded,No,stderr shown in verbose mode
```

TeammateIdle and TaskCompleted blocking behavior added in Claude Code 2.1.33.

## Standard Output (All Hooks)

These fields are parsed only at exit 0. Every hook can return:

```csv
Field,Type,Default,Description
continue,boolean,true,"false halts processing entirely; true proceeds"
suppressOutput,boolean,false,"true hides hook output from transcript"
systemMessage,string,—,"Message sent to Claude for context or explanation"
```

## Decision Control

Alternatives to exit 2 for blocking behavior, available via JSON at exit 0.

### Top-level decision field

For PostToolUse and Stop — return a `decision` field in JSON:

```json
{
  "decision": "block",
  "reason": "Explanation of why the action is blocked"
}
```

### hookSpecificOutput with permissionDecision

For PreToolUse — return inside `hookSpecificOutput`:

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "Reason shown to user"
  }
}
```

### continue: false

Stops Claude entirely — Claude will not continue processing after the hook
runs. Available in JSON at exit 0. More forceful than `decision: block`.

```json
{
  "continue": false,
  "systemMessage": "Explanation of why processing stopped"
}
```

## Event-Specific Output

### PreToolUse

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": {"field": "modified_value"},
    "additionalContext": "Text injected into context for the model"
  },
  "systemMessage": "Explanation for Claude"
}
```

```csv
Field,Since,Required,Description
hookSpecificOutput.permissionDecision,1.0.59,yes,"allow | deny | ask"
hookSpecificOutput.permissionDecisionReason,1.0.59,no,"Reason shown alongside the decision"
hookSpecificOutput.updatedInput,2.0.30,no,"Modified tool input fields — merged into original input before execution (works with ask decision since 2.1.0)"
hookSpecificOutput.additionalContext,2.1.9,no,"Text injected into context for the model"
systemMessage,—,no,"Explanation or feedback for Claude"
```

Note: top-level `decision` and `reason` fields are deprecated. Use
`hookSpecificOutput.permissionDecision` and
`hookSpecificOutput.permissionDecisionReason` instead.

### PostToolUse

No event-specific output fields. Uses standard output only (`continue`,
`suppressOutput`, `systemMessage`).

Exit code behavior:

```csv
Exit Code,Behavior
0,stdout parsed for JSON; normal continuation
2,stderr fed back to Claude as a tool result error (non-blocking)
Other non-zero,stderr shown in verbose mode only
```

### UserPromptSubmit

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "..."
  }
}
```

Since 1.0.59. The `additionalContext` field injects text alongside the user's
prompt. No other event-specific fields are documented.

Exit 2 blocks the prompt submission entirely.

### Stop

```json
{
  "decision": "approve|block",
  "reason": "Explanation",
  "systemMessage": "Additional context"
}
```

```csv
Field,Type,Required,Description
decision,string,yes,"approve (allow stop) | block (continue working)"
reason,string,no,"Explanation for the decision"
systemMessage,string,no,"Additional context for Claude"
```

Exit 2 prevents Claude from stopping (same effect as `decision: block`).

### Other Events

SessionStart, SessionEnd, SubagentStart, SubagentStop, Notification,
PreCompact, TeammateIdle, TaskCompleted, ConfigChange, WorktreeCreate,
WorktreeRemove, InstructionsLoaded — no event-specific output fields
documented. Use standard output only.

## Notes

- JSON is only parsed at exit 0 (except for the upstream bug #30586)
- Only PreToolUse and Stop have event-specific output schemas with decision fields
- UserPromptSubmit has `hookSpecificOutput.additionalContext` for context injection
- All other events use the 3 standard fields only
- The SDK source may add more event-specific outputs in future versions
- This document should be re-verified against the
  [official docs](https://code.claude.com/docs/en/hooks) periodically
