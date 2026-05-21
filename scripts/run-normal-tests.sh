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

require_positive_int SLICES "$SLICES"
require_positive_int BATCH_SIZE "$BATCH_SIZE"
require_positive_int TIMEOUT "$TIMEOUT"
require_positive_int BUN_JOBS "$BUN_JOBS"

for ((i = 1; i <= SLICES; i++)); do
  echo "================ SLICE ${i}/${SLICES} ================"
  SLICES="$SLICES" \
    SLICE="$i" \
    BATCH_SIZE="$BATCH_SIZE" \
    TIMEOUT="$TIMEOUT" \
    BUN_JOBS="$BUN_JOBS" \
    bin/test-slicer.sh
done
