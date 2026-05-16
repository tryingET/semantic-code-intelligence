#!/usr/bin/env bash
echo "[test-progress-batch] starting" 1>&2
set -ueo pipefail

# Batch progressive test runner
# Runs test files in batches and prints per-batch timing and status.
#
# Env vars:
#  - BATCH_SIZE: number of files per batch (default: 10)
#  - TIMEOUT: per-bun invocation timeout (ms) (default: 300000)
#  - MAX_FILES: limit number of test files (optional)
#  - PERF: when set (e.g., PERF=1), you can include perf suites in FILE_GLOB below
#  - BUN_JOBS: recommended 1 for stable sequential behavior

BATCH_SIZE=${BATCH_SIZE:-10}
TIMEOUT_MS=${TIMEOUT:-300000}
BAIL=${BAIL:-}
MAX_FILES=${MAX_FILES:-}

# Collect test files. Prefer explicit list via FILE_LIST; otherwise discover.
if [[ -n "${FILE_LIST:-}" && -f "${FILE_LIST}" ]]; then
  mapfile -t FILES < "${FILE_LIST}"
else
  # Discover tests from the tree (tolerate missing dirs)
  TMP_LIST=$(mktemp)
  if [ -d tests ]; then find tests -type f \( -name "*.test.ts" -o -name "*.test.js" \) >> "$TMP_LIST"; fi
  if [ -d test ]; then find test -type f \( -name "*.test.ts" -o -name "*.test.js" \) >> "$TMP_LIST"; fi
  sort "$TMP_LIST" -o "$TMP_LIST"
  mapfile -t FILES < "$TMP_LIST"
  rm -f "$TMP_LIST"
fi

if [[ -n "${MAX_FILES}" ]]; then
  FILES=("${FILES[@]:0:${MAX_FILES}}")
fi

TOTAL=${#FILES[@]}
if [[ ${TOTAL} -eq 0 ]]; then
  echo "No test files found."
  exit 0
fi

echo "Running ${TOTAL} files in batches of ${BATCH_SIZE} (timeout ${TIMEOUT_MS}ms, BUN_JOBS=${BUN_JOBS:-1})"
REPORT_FILE_DEFAULT=".test-results/batch-report.jsonl"
REPORT_FILE="${REPORT_FILE:-$REPORT_FILE_DEFAULT}"
REPORT_DIR=$(dirname "$REPORT_FILE")
mkdir -p "$REPORT_DIR"
echo -n > "$REPORT_FILE"

passes=0
fails=0

batch_index=0
for ((i=0; i<TOTAL; i+=BATCH_SIZE)); do
  batch_index=$((batch_index+1))
  end=$(( i + BATCH_SIZE ))
  if [[ ${end} -gt ${TOTAL} ]]; then end=${TOTAL}; fi
  batch=("${FILES[@]:i:end-i}")

  ts=$(date -Is)
  echo "=== BATCH START ${ts} :: [${batch_index}] files ${i}-${end}/${TOTAL}"
  printf "Files: %s\n" "${batch[*]}"
  START=$(date +%s%3N)
  # Build command with optional stdbuf (line-buffering) and hard timeout
  CMD=(bun test)
  for f in "${batch[@]}"; do CMD+=("$f"); done
  CMD+=(--timeout "${TIMEOUT_MS}")
  if [[ -n "${BAIL}" && "${BAIL}" != "0" ]]; then
    CMD+=(--bail=1)
  fi
  PREFIX=()
  if command -v stdbuf >/dev/null 2>&1; then
    PREFIX+=(stdbuf -oL -eL)
  fi
  if [[ -n "${BATCH_HARD_TIMEOUT_SEC:-}" && "${BATCH_HARD_TIMEOUT_SEC}" -gt 0 ]] && command -v timeout >/dev/null 2>&1; then
    PREFIX=(timeout "${BATCH_HARD_TIMEOUT_SEC}s" "${PREFIX[@]}")
  fi

HEARTBEAT_SEC=${HEARTBEAT_SEC:-15}
# Keep-alive heartbeat while tests run (configurable via HEARTBEAT_SEC)
(
  while :; do
      echo "[test-batch ${batch_index}] still running... $(date -Is)" 1>&2
      sleep "${HEARTBEAT_SEC}" || exit 0
  done
) &
  KA_PID=$!

  # Execute
  BUN_JOBS=${BUN_JOBS:-1} "${PREFIX[@]}" "${CMD[@]}"
  code=$?
  kill "$KA_PID" >/dev/null 2>&1 || true
  END=$(date +%s%3N)
  DUR=$((END-START))

  # Persist batch metrics (JSONL)
  FILES_JSON="["
  for f in "${batch[@]}"; do
    FILES_JSON="${FILES_JSON}\"${f}\",";
  done
  FILES_JSON="${FILES_JSON%,}]"
  printf '{"batch":%d,"start":%d,"end":%d,"duration_ms":%d,"exit_code":%d,"files":%s}\n' \
    "$batch_index" "$i" "$end" "$DUR" "$code" "$FILES_JSON" >> "$REPORT_FILE"

  if [[ $code -eq 0 ]]; then
    passes=$((passes+1))
    echo "=== BATCH PASS  $(date -Is) :: [${batch_index}] duration ${DUR}ms"
  else
    fails=$((fails+1))
    echo "=== BATCH FAIL  $(date -Is) :: [${batch_index}] duration ${DUR}ms (exit ${code})"
  fi
  echo
done

total=$((passes + fails))
echo "Batches summary: ${passes} passed, ${fails} failed, total ${total}"
if [[ ${fails} -eq 0 ]]; then
  exit 0
else
  exit 1
fi
