# Hook Stdout Schema Reference

Status: Draft
Created: 20260306
Source: [Claude Code plugin dev skill](https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md),
retrieved via Context7 API 20260306.

Complete reference for the JSON output a hook can return to Claude Code via
stdout. Used by hookwatch to define TypeScript interfaces and Zod validation
schemas for context injection (Epic 4).

## Standard Output (All Hooks)

Every hook can return these fields:

```csv
Field,Type,Default,Description
continue,boolean,true,"false halts processing; true proceeds"
suppressOutput,boolean,false,"true hides hook output from transcript"
systemMessage,string,—,"Message sent to Claude for context or explanation"
```

## Event-Specific Output

### PreToolUse

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "allow|deny|ask",
    "updatedInput": {"field": "modified_value"}
  },
  "systemMessage": "Explanation for Claude"
}
```

```csv
Field,Type,Required,Description
hookSpecificOutput.permissionDecision,string,yes,"allow | deny | ask"
hookSpecificOutput.updatedInput,object,no,"Modified tool input fields — merged into original input before execution"
systemMessage,string,no,"Explanation or feedback for Claude"
```

### PostToolUse

No event-specific output fields. Uses standard output only (`continue`,
`suppressOutput`, `systemMessage`). Exit code behavior:

```csv
Exit Code,Behavior
0,stdout shown in transcript
2,stderr fed back to Claude as error
```

### UserPromptSubmit

No event-specific output fields documented in the SDK. Uses standard output
only.

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

### Other Events

SessionStart, SessionPause, SessionResume, SessionStop, PreCompact,
PostCompact, Notification, SubagentStop, SubagentToolUse, ToolError,
PreMcpToolUse, PostMcpToolUse, McpServerStart, PreUserInputSubmit,
PostUserInputSubmit — no event-specific output fields documented in the SDK.
Uses standard output only.

## Notes

- Only PreToolUse and Stop have event-specific output schemas
- All other events use the 3 standard fields only
- The SDK source may add more event-specific outputs in future versions
- This document should be re-verified against the SDK periodically
