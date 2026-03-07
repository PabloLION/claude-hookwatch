#!/bin/zsh
# probe-zsh.sh — zsh-specific syntax probe
# Uses zsh-only syntax — fails in bash/sh
# Writes to /tmp/hookwatch-probe-zsh.txt on execution

OUT=/tmp/hookwatch-probe-zsh.txt

echo "ZSH_PROBE=success" > "$OUT"
echo "ZSH_VERSION=$ZSH_VERSION" >> "$OUT"

# Zsh glob qualifier (zsh-only) — list regular files in /tmp matching pattern
print -l /tmp/hookwatch-probe-*(.) >> "$OUT" 2>/dev/null || echo "glob_qualifier=unavailable" >> "$OUT"

echo "probe-zsh:done" >> "$OUT"
