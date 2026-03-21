# Quick Start

Get from zero to seeing events in under 2 minutes.

## Prerequisites

- [Bun](https://bun.sh/) runtime installed
- [Claude Code](https://code.claude.com/) CLI installed

## Install

```sh
# Clone and install
git clone https://github.com/PabloLION/claude-hookwatch.git
cd claude-hookwatch
bun install
```

## Run

```sh
# Start Claude Code with hookwatch
claude --plugin-dir "$PWD"
```

Use Claude normally — every hook event is captured automatically.

## Browse Events

```sh
# Open the web UI
hookwatch ui
```

The web UI opens at `http://localhost:6004` with a live-updating event timeline.

## What You'll See

Once Claude Code starts with hookwatch active, you'll see events captured for
every action: tool calls, permission requests, session lifecycle, and more. The
web UI shows:

- **Event timeline** — chronological list of all captured events
- **Session filter** — narrow down to a specific Claude Code session
- **Event detail** — full stdin payload for any event
- **Wrap viewer** — stdout/stderr/exit code for wrapped commands

## Plugin Install (Alternative)

Instead of `--plugin-dir`, you can register hookwatch as a permanent plugin:

```sh
hookwatch install
```

This generates the plugin manifest and hooks configuration. To remove:

```sh
hookwatch uninstall
```

::: info Plugin System
The Claude Code plugin system has [known issues](https://github.com/anthropics/claude-code/issues/28540)
that may affect installation. If `claude plugin install` fails, use `--plugin-dir`
as shown above.
:::

## Next Steps

- [Features](/guide/features) — explore what hookwatch can do
- [Hook Events Reference](/reference/hook-events) — all 18 event types explained
- [Use Cases](/guide/use-cases) — real-world patterns for using hookwatch
