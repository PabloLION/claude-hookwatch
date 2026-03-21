# Claude Code Probes

Empirical tests that run against a real Claude Code instance to verify
hook behavior assumptions.

## Prerequisites

- `claude` CLI on PATH
- `ANTHROPIC_API_KEY` set
- Run from a plain terminal (not inside a Claude Code session)

## Scripts

### probe-launcher

Determines which shell interpreter Claude Code uses for inline hook commands.

```sh
bun scripts/claude-code-probes/probe-launcher.ts
```

### probe-non-interactive

Tests hook behavior in non-interactive (`-p`) mode.

```sh
bun scripts/claude-code-probes/probe-non-interactive.ts
```

### probe-output-strictness

Tests how Claude Code handles hook stdout JSON at different exit codes.

```sh
bun scripts/claude-code-probes/probe-output-strictness.ts
```

## Adding probes

1. Create a new `.ts` file in this directory
2. Follow the probe-launcher pattern: register a hook, run `claude --print`,
   inspect output
3. Document the probe in AGENTS.md under Scripts → Probes
