#!/bin/bash
# probe-bash.sh — bash-specific syntax probe
# Uses bash-only syntax — fails in sh/zsh if associative arrays unavailable
# Writes to /tmp/hookwatch-probe-bash.txt on execution

OUT=/tmp/hookwatch-probe-bash.txt

# bash associative arrays — bash 4+ only, not available in sh
declare -A assoc_array
assoc_array[shell]="bash"

echo "BASH_PROBE=success" > "$OUT"
echo "BASH_VERSION=$BASH_VERSION" >> "$OUT"
echo "assoc_array[shell]=${assoc_array[shell]}" >> "$OUT"

# Process substitution (bash-specific form)
cat <(echo "process_sub=works") >> "$OUT"

# $PIPESTATUS (bash-only)
echo "probe-bash:done" >> "$OUT"
echo "PIPESTATUS_after_echo=${PIPESTATUS[0]}" >> "$OUT"
