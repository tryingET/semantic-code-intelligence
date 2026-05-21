#!/usr/bin/env bash
set -ueo pipefail

# Test Slicer Runner
# Splits the test suite into slices and runs one slice with batch progress.
#
# Env vars:
#  - SLICES: total number of slices (required)
#  - SLICE:  1-based index of which slice to run (required)
#  - BATCH_SIZE: number of files per bun invocation (default: 8)
#  - TIMEOUT: per-bun invocation timeout in ms (default: 180000)
#  - MAX_FILES: optional cap on total files considered (after slicing)
#  - WITH_PERF: include perf/benchmarks tests when set (default: off)
#  - BUN_JOBS: concurrency passed to bun (default: 1 for stability)

SLICES=${SLICES:-}
SLICE=${SLICE:-}
if [[ -z "${SLICES}" || -z "${SLICE}" ]]; then
  echo "Usage: SLICES=<total> SLICE=<index> bin/test-slicer.sh" 1>&2
  exit 2
fi

if ! [[ ${SLICES} =~ ^[0-9]+$ ]] || ! [[ ${SLICE} =~ ^[0-9]+$ ]] || [[ ${SLICES} -lt 1 ]] || [[ ${SLICE} -lt 1 ]] || [[ ${SLICE} -gt ${SLICES} ]]; then
  echo "Invalid SLICES/SLICE. Provide numeric values with 1 <= SLICE <= SLICES." 1>&2
  exit 2
fi

BATCH_SIZE=${BATCH_SIZE:-8}
TIMEOUT_MS=${TIMEOUT:-180000}
MAX_FILES=${MAX_FILES:-}
WITH_PERF=${WITH_PERF:-}
WITH_E2E=${WITH_E2E:-}

# Balanced slicing knobs (optional)
BALANCE_SLICES=${BALANCE_SLICES:-}
HOT_SLICE=${HOT_SLICE:-}
HOT_SLICE_TOP=${HOT_SLICE_TOP:-0}
HISTORY_DIRS=${HISTORY_DIRS:-.test-results:slices}

# Collect test files (default excludes perf/benchmarks unless WITH_PERF=1)
SUITE_DIR=${SUITE_DIR:-}
DISCOVERY_DIRS=()
if [[ -z "${SUITE_DIR}" ]]; then
  [[ -d tests ]] && DISCOVERY_DIRS+=(tests)
  [[ -d test ]] && DISCOVERY_DIRS+=(test)
  if [[ ${#DISCOVERY_DIRS[@]} -eq 0 ]]; then
    echo "No test directories found."
    exit 0
  fi
fi
if [[ -n "${WITH_PERF}" && "${WITH_PERF}" != "0" ]]; then
  if [[ -n "${SUITE_DIR}" ]]; then
    mapfile -t ALL < <(find "${SUITE_DIR}" -type f \( -name "*.test.ts" -o -name "*.test.js" \) | sort)
  else
    mapfile -t ALL < <(find "${DISCOVERY_DIRS[@]}" -type f \( -name "*.test.ts" -o -name "*.test.js" \) | sort)
  fi
else
  if [[ -n "${SUITE_DIR}" ]]; then
    if [[ -n "${WITH_E2E}" && "${WITH_E2E}" != "0" ]]; then
      mapfile -t ALL < <(find "${SUITE_DIR}" -type f \( -name "*.test.ts" -o -name "*.test.js" \) \
        ! -path "*/performance/*" ! -path "*/benchmarks/*" | sort)
    else
      mapfile -t ALL < <(find "${SUITE_DIR}" -type f \( -name "*.test.ts" -o -name "*.test.js" \) \
        ! -path "*/performance/*" ! -path "*/benchmarks/*" ! -path "*/e2e/*" | sort)
    fi
  else
    if [[ -n "${WITH_E2E}" && "${WITH_E2E}" != "0" ]]; then
      mapfile -t ALL < <(find "${DISCOVERY_DIRS[@]}" -type f \( -name "*.test.ts" -o -name "*.test.js" \) \
        ! -path "*/performance/*" ! -path "*/benchmarks/*" | sort)
    else
      mapfile -t ALL < <(find "${DISCOVERY_DIRS[@]}" -type f \( -name "*.test.ts" -o -name "*.test.js" \) \
        ! -path "*/performance/*" ! -path "*/benchmarks/*" ! -path "*/e2e/*" | sort)
    fi
  fi
fi

TOTAL=${#ALL[@]}
if [[ ${TOTAL} -eq 0 ]]; then
  echo "No test files found."
  exit 0
fi

# Build slice (optionally balanced using recent history)
slice_files=()
if [[ -n "${BALANCE_SLICES}" && "${BALANCE_SLICES}" != "0" ]]; then
  ALL_LIST=".test-results/all-tests.lst"
  mkdir -p .test-results
  printf "%s\n" "${ALL[@]}" > "${ALL_LIST}"
  mapfile -t HLIST < <(tr ':' '\n' <<<"${HISTORY_DIRS}")
  HARGS=()
  for d in "${HLIST[@]}"; do
    [[ -n "$d" ]] && HARGS+=(--history-dir "$d")
  done
  if output=$(bun run scripts/build-slice-order.ts --base-list "${ALL_LIST}" --slices "${SLICES}" --slice "${SLICE}" --hot-top "${HOT_SLICE_TOP}" ${HOT_SLICE:+--hot-slice} "${HARGS[@]}" 2>/dev/null); then
    if [[ -n "$output" ]]; then
      mapfile -t slice_files <<< "$output"
    fi
  fi
fi

# Fallback: discovery-order round-robin
if [[ ${#slice_files[@]} -eq 0 ]]; then
  index=0
  for f in "${ALL[@]}"; do
    # Use 0-based modulo on stable index to assign files to slices
    if (( (index % SLICES) == (SLICE - 1) )); then
      slice_files+=("$f")
    fi
    index=$((index+1))
  done
fi

if [[ -n "${MAX_FILES}" ]]; then
  slice_files=("${slice_files[@]:0:${MAX_FILES}}")
fi

COUNT=${#slice_files[@]}
if [[ ${COUNT} -eq 0 ]]; then
  echo "Slice ${SLICE}/${SLICES} is empty (no files matched)."
  exit 0
fi

echo "🏁 Running test slice ${SLICE}/${SLICES}: ${COUNT} files (of ${TOTAL})"
echo "   Batch size: ${BATCH_SIZE}, Timeout: ${TIMEOUT_MS}ms, BUN_JOBS=${BUN_JOBS:-1}"

# Write the slice list to a temp file for transparency
SLICE_DIR=".test-results/slice-${SLICE}-of-${SLICES}"
SLICE_LIST="${SLICE_DIR}/files.lst"
mkdir -p "${SLICE_DIR}"
printf "%s\n" "${slice_files[@]}" > "${SLICE_LIST}"
echo "   File list: ${SLICE_LIST}"

# DRY run: only produce the slice list and exit
if [[ "${DRY:-}" = "1" ]]; then
  echo "   (DRY) slice list generated only; no tests executed."
  exit 0
fi

# Run via batch runner for steady progress
REPORT_FILE="${SLICE_DIR}/batch-report.jsonl" FILE_LIST="${SLICE_LIST}" BATCH_SIZE=${BATCH_SIZE} TIMEOUT=${TIMEOUT_MS} MAX_FILES= bin/test-progress-batch.sh

echo "✅ Slice ${SLICE}/${SLICES} complete"
