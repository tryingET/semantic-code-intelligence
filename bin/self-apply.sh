#!/usr/bin/env bash
set -euo pipefail

# Self-apply helper: stage a unified diff (or apply_patch format) inside a snapshot and run checks.
# Usage:
#   # From a file
#   bin/self-apply.sh -f my.diff -- bun run build:tsc "bun test --bail=1"
#   # From stdin
#   git diff | bin/self-apply.sh -- bun run build:tsc

PATCH_FILE=""
CMDS=()
ONLY_TOUCHED=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file)
      PATCH_FILE="$2"; shift 2;;
    --)
      shift; CMDS=("$@"); break;;
    *)
      echo "Unknown arg: $1" >&2; exit 1;;
  esac
done

# Reuse existing snapshot when available for iterative runs
SNAP=$(semantic-code-intelligence get-snapshot --prefer-existing)

if [[ -z "$PATCH_FILE" ]]; then
  TMP=$(mktemp)
  cat > "$TMP"
  PATCH_FILE="$TMP"
fi

# Validate the patch looks like a diff before invoking tools
# Accept: apply_patch (*** Begin Patch), git diff (diff --git), or unified diff headers (---/+++ a/b)
if ! head -n 50 "$PATCH_FILE" | grep -Eq "^\*\*\* Begin Patch|^\*\*\* (Update|Add|Delete) File:|^diff --git |^---\s+[ab]/|^\+\+\+\s+[ab]/"; then
  echo "✗ Invalid patch: expected unified diff or apply_patch format." >&2
  echo "  Tip: Use apply_patch heredoc or pipe \`git diff\`/\`git diff --no-index\` output." >&2
  [[ -n "${TMP:-}" && -f "$TMP" ]] && rm -f "$TMP"
  exit 2
fi

export FAST_STDIO_CHECKS=touched

# If no explicit commands were provided, prefer quick checks for touched TS files
if [[ ${#CMDS[@]} -eq 0 ]]; then
  # Default to a no-op command; quick typecheck for touched files is prepended automatically
  CMDS=("true")
fi

# Prefer the workflow alias which reads the patch and runs checks inside the snapshot
ARGS=(patch-checks-in-snapshot --snapshot "$SNAP" --patch-file "$PATCH_FILE" --only-touched)
for CMD in "${CMDS[@]}"; do
  ARGS+=(--cmd "$CMD")
done
ARGS+=(--timeout 240)

if semantic-code-intelligence "${ARGS[@]}"; then
  :
else
  echo "✗ Patch checks failed (snapshot: $SNAP). See output above." >&2
fi

if [[ -n "${TMP:-}" && -f "$TMP" ]]; then rm -f "$TMP"; fi

echo "Snapshot: $SNAP"
