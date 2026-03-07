#!/bin/sh
# probe-sh.sh — sh control group
# Uses only sh syntax — should work in any shell
# Writes to /tmp/hookwatch-probe-sh.txt on execution

OUT=/tmp/hookwatch-probe-sh.txt

echo "SHELL=$SHELL" > "$OUT"
echo "BASH_VERSION=${BASH_VERSION:-unset}" >> "$OUT"
echo "ZSH_VERSION=${ZSH_VERSION:-unset}" >> "$OUT"
echo "0=$0" >> "$OUT"
# POSIX-only: test command
test -n "$CLAUDE_PLUGIN_ROOT" && echo "CLAUDE_PLUGIN_ROOT=$CLAUDE_PLUGIN_ROOT" >> "$OUT"
test -n "$CLAUDE_PROJECT_DIR" && echo "CLAUDE_PROJECT_DIR=$CLAUDE_PROJECT_DIR" >> "$OUT"
# Capture PATH for env context
echo "PATH=$PATH" >> "$OUT"
# Capture HOME for user context
echo "HOME=$HOME" >> "$OUT"
# Capture USER for user context
echo "USER=$USER" >> "$OUT"
# Capture working directory
echo "PWD=$PWD" >> "$OUT"
# Capture all CLAUDE_ env vars
env | grep '^CLAUDE_' >> "$OUT" 2>/dev/null || true
echo "probe-sh:done" >> "$OUT"
