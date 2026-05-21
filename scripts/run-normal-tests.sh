#!/usr/bin/env bash
set -euo pipefail

# Normal local/agent test entrypoint.
# Runs the broad non-perf, non-e2e suite through the same sliced + batched
# runner used by `just test` so package-script users do not accidentally invoke
# one huge `bun test` process with default per-test timeouts.

SLICES=${SLICES:-4}
BATCH_SIZE=${BATCH_SIZE:-8}
TIMEOUT=${TIMEOUT:-180000}
BUN_JOBS=${BUN_JOBS:-1}

if ! [[ "$SLICES" =~ ^[0-9]+$ ]] || [[ "$SLICES" -lt 1 ]]; then
  echo "Invalid SLICES: $SLICES" >&2
  exit 2
fi

for ((i = 1; i <= SLICES; i++)); do
  echo "================ SLICE ${i}/${SLICES} ================"
  SLICES="$SLICES" \
    SLICE="$i" \
    BATCH_SIZE="$BATCH_SIZE" \
    TIMEOUT="$TIMEOUT" \
    BUN_JOBS="$BUN_JOBS" \
    bin/test-slicer.sh
done
