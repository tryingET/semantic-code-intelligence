#!/usr/bin/env bash
set -euo pipefail

# Normal local/agent test entrypoint.
# Runs the broad non-perf, non-e2e suite through the same sliced + batched
# runner used by `just test` so package-script users do not accidentally invoke
# one huge `bun test` process with default per-test timeouts.

SLICES=${SLICES:-4}
REQUESTED_SLICE=
# File-level batches are the stable default for local/agent validation. Larger
# batches can be requested explicitly, but mixed HTTP/CLI tests contend heavily
# when several files share one Bun process.
BATCH_SIZE=${BATCH_SIZE:-1}
TIMEOUT=${TIMEOUT:-180000}
BUN_JOBS=${BUN_JOBS:-1}
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat >&2 <<'USAGE'
Usage: scripts/run-normal-tests.sh [--slice K/N]

Runs the normal non-perf, non-e2e suite through the canonical sliced+batched
runner. Without --slice it runs all slices sequentially. With --slice it runs
one matrix slice using the same defaults and guards.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slice)
      if [[ $# -lt 2 ]]; then
        usage
        exit 2
      fi
      if [[ "$2" =~ ^([0-9]+)/([0-9]+)$ ]]; then
        REQUESTED_SLICE="${BASH_REMATCH[1]}"
        SLICES="${BASH_REMATCH[2]}"
      else
        echo "Invalid --slice value: $2 (expected K/N)" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

require_positive_int() {
  local name="$1"
  local value="$2"
  if ! [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" -lt 1 ]]; then
    echo "Invalid ${name}: ${value}" >&2
    exit 2
  fi
}

require_positive_int SLICES "$SLICES"
if [[ -n "$REQUESTED_SLICE" ]]; then
  require_positive_int SLICE "$REQUESTED_SLICE"
  if [[ "$REQUESTED_SLICE" -gt "$SLICES" ]]; then
    echo "Invalid SLICE: ${REQUESTED_SLICE}; expected 1 <= SLICE <= SLICES (${SLICES})" >&2
    exit 2
  fi
fi
require_positive_int BATCH_SIZE "$BATCH_SIZE"
require_positive_int TIMEOUT "$TIMEOUT"
require_positive_int BUN_JOBS "$BUN_JOBS"

run_slice() {
  local i="$1"
  echo "================ SLICE ${i}/${SLICES} ================"
  (
    cd "$REPO_ROOT"
    SLICES="$SLICES" \
      SLICE="$i" \
      BATCH_SIZE="$BATCH_SIZE" \
      TIMEOUT="$TIMEOUT" \
      BUN_JOBS="$BUN_JOBS" \
      "$REPO_ROOT/bin/test-slicer.sh"
  )
}

if [[ -n "$REQUESTED_SLICE" ]]; then
  run_slice "$REQUESTED_SLICE"
else
  BASE_GIT_FINGERPRINT="$($REPO_ROOT/scripts/git-tree-fingerprint.sh)"

  for ((i = 1; i <= SLICES; i++)); do
    run_slice "$i"
  done

  AFTER_GIT_FINGERPRINT="$($REPO_ROOT/scripts/git-tree-fingerprint.sh)"
  if [[ "$AFTER_GIT_FINGERPRINT" != "$BASE_GIT_FINGERPRINT" ]]; then
    echo "Test run changed git working tree content; restore or commit intentional outputs." >&2
    echo "--- status ---" >&2
    git status --short --untracked-files=normal >&2 || true
    exit 1
  fi
fi
