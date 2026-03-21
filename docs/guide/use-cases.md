# Use Cases

## Permission Noise Reduction

Claude Code's permission system is binary per tool — `gh api` can both read and
write, so every invocation triggers a PermissionRequest the user must manually
approve. For read-heavy workflows, this creates significant approval fatigue
even though the operations are harmless.

### The Pattern

1. **Identify noisy permissions** — use hookwatch to monitor PermissionRequest
   events and surface which tools/commands trigger the most approval prompts
2. **Create read-only wrappers** — build constrained CLI aliases that only
   expose safe (read) operations from powerful tools
3. **Grant blanket permission** — the wrapper is safe by construction, so users
   can auto-approve it in Claude Code settings
4. **Direct Claude Code** — instruct Claude to use the wrapper for reads

### Why hookwatch

By querying the hookwatch database, you can:

- See which permissions are requested most frequently
- Identify patterns (e.g., 90% of `gh api` calls are reads)
- Measure approval fatigue reduction after deploying wrappers

### Generalization

This pattern applies to any powerful tool where reads vastly outnumber writes:

- `gh api` → `gh-read` (GitHub API reads only)
- File system tools → read-only variants
- Database CLIs → query-only wrappers
- Cloud provider CLIs → describe/list-only aliases

## Hook Debugging

When developing Claude Code hooks, hookwatch captures every event with its full
stdin payload. This lets you:

- Verify your hooks receive the expected data
- Debug hook failures by inspecting PostToolUseFailure events
- Compare event payloads across sessions
- Check hook execution timing via `hook_duration_ms`

## Session Analysis

Query the SQLite database to understand Claude Code behavior:

- Which tools are used most frequently?
- How long do sessions last?
- What triggers permission requests?
- Are there patterns in tool failures?

See [Querying](/reference/querying) for SQL examples.

---

*More use cases coming soon. Have a use case to share?
[Open an issue](https://github.com/PabloLION/claude-hookwatch/issues).*
