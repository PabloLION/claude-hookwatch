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
bun run probe:launcher
```

Results are written to `<tmpdir>/hookwatch-probe-inline-report.txt` and printed
to the console.

## Adding probes

1. Create a new `.ts` file in this directory
2. Follow the probe-launcher pattern: register a hook, run `claude --print`,
   inspect output
3. Add a `probe:<name>` script entry in the root `package.json`
