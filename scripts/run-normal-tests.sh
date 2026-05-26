#!/usr/bin/env bash
set -euo pipefail

# Normal local/agent test entrypoint.
# Runs the broad non-perf, non-e2e suite through the same sliced + batched
# runner used by `just test` so package-script users do not accidentally invoke
# one huge `bun test` process with default per-test timeouts.

SLICES=${SLICES:-4}
# File-level batches are the stable default for local/agent validation. Larger
# batches can be requested explicitly, but mixed HTTP/CLI tests contend heavily
# when several files share one Bun process.
BATCH_SIZE=${BATCH_SIZE:-1}
TIMEOUT=${TIMEOUT:-180000}
BUN_JOBS=${BUN_JOBS:-1}

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]]; then
    echo "Invalid ${name}: ${value}" >&2
    exit 2
  fi
}

git_tree_fingerprint() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf 'not-a-git-worktree\n'
    return 0
  fi
  {
    printf 'status\0'
    git status --porcelain=v1 -z --untracked-files=normal || true
    printf 'diff\0'
    git diff --binary || true
    printf 'cached-diff\0'
    git diff --cached --binary || true
    printf 'untracked\0'
    git ls-files --others --exclude-standard -z | python3 -c 'import hashlib, os, sys
paths = sorted(p for p in sys.stdin.buffer.read().split(b"\0") if p)
for raw in paths:
    path = os.fsdecode(raw)
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1024 * 1024), b""):
                digest.update(chunk)
        print(f"{digest.hexdigest()}  {path}")
    except OSError as exc:
        print(f"ERROR {path}: {exc}")'
  } | sha256sum | awk '{print $1}'
}

require_positive_int SLICES "$SLICES"
require_positive_int BATCH_SIZE "$BATCH_SIZE"
require_positive_int TIMEOUT "$TIMEOUT"
require_positive_int BUN_JOBS "$BUN_JOBS"

BASE_GIT_FINGERPRINT="$(git_tree_fingerprint)"

for ((i = 1; i <= SLICES; i++)); do
  echo "================ SLICE ${i}/${SLICES} ================"
  SLICES="$SLICES" \
    SLICE="$i" \
    BATCH_SIZE="$BATCH_SIZE" \
    TIMEOUT="$TIMEOUT" \
    BUN_JOBS="$BUN_JOBS" \
    bin/test-slicer.sh
done

AFTER_GIT_FINGERPRINT="$(git_tree_fingerprint)"
if [[ "$AFTER_GIT_FINGERPRINT" != "$BASE_GIT_FINGERPRINT" ]]; then
  echo "Test run changed git working tree content; restore or commit intentional outputs." >&2
  echo "--- status ---" >&2
  git status --short --untracked-files=normal >&2 || true
  exit 1
fi
