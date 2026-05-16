#!/usr/bin/env bash
set -ueo pipefail

# Runs performance/benchmark tests only, per file, with post-run analytics.
# Env:
#  - TIMEOUT (ms) per file, default 300000
#  - MAX_FILES limit number of test files (optional)
#  - BUN_JOBS recommended 1 for stability
#  - OUT_DIR directory to store artifacts (default .test-results-perf)
#  - PERF should be set to 1 for enabling perf-gated tests

TIMEOUT_MS=${TIMEOUT:-300000}
MAX_FILES=${MAX_FILES:-}
OUT_DIR=${OUT_DIR:-.test-results-perf}
mkdir -p "${OUT_DIR}"

RESULTS_JSONL="${OUT_DIR}/test-durations.jsonl"
RESULTS_CSV="${OUT_DIR}/test-durations.csv"
SUMMARY_TXT="${OUT_DIR}/summary.txt"
rm -f "${RESULTS_JSONL}" "${RESULTS_CSV}" "${SUMMARY_TXT}"
echo "file,duration_ms,exit_code" > "${RESULTS_CSV}"

# Collect perf/benchmark test files
mapfile -t FILES < <(find tests/performance tests/benchmarks -type f \( -name "*.test.ts" -o -name "*.test.js" \) 2>/dev/null | sort || true)

TOTAL=${#FILES[@]}
if [[ ${TOTAL} -eq 0 ]]; then
  echo "No performance/benchmark test files found."
  exit 0
fi

if [[ -n "${MAX_FILES}" && ${MAX_FILES} -lt ${TOTAL} ]]; then
  FILES=("${FILES[@]:0:${MAX_FILES}}")
  TOTAL=${#FILES[@]}
fi

echo "Running ${TOTAL} perf/benchmark files (timeout ${TIMEOUT_MS}ms per file, BUN_JOBS=${BUN_JOBS:-1}, PERF=${PERF:-0})"

passes=0
fails=0
idx=0
for f in "${FILES[@]}"; do
  idx=$((idx+1))
  echo "=== START $(date -Is) :: [$idx/$TOTAL] $f"
  START=$(date +%s%3N)
  code=0
  if ! PERF=${PERF:-1} BUN_JOBS=${BUN_JOBS:-1} bun test "$f" --timeout ${TIMEOUT_MS} ; then
    code=$?
  fi
  END=$(date +%s%3N)
  DUR=$((END-START))

  printf '{"file":"%s","duration_ms":%d,"exit_code":%d}\n' "$f" "$DUR" "$code" >> "${RESULTS_JSONL}"
  printf '%s,%d,%d\n' "$f" "$DUR" "$code" >> "${RESULTS_CSV}"

  if [[ $code -eq 0 ]]; then
    passes=$((passes+1))
    echo "=== PASS  $(date -Is) :: [$idx/$TOTAL] $f :: ${DUR}ms"
  else
    fails=$((fails+1))
    echo "=== FAIL  $(date -Is) :: [$idx/$TOTAL] $f :: ${DUR}ms (exit ${code})"
  fi
  echo
done

echo "\n=== POST-RUN ANALYTICS (PERF) ===" | tee -a "${SUMMARY_TXT}"
echo "Total files: ${TOTAL}, Passed: ${passes}, Failed: ${fails}" | tee -a "${SUMMARY_TXT}"

total_ms=$(awk -F, 'NR>1{sum+=$2} END{print sum+0}' "${RESULTS_CSV}")
avg_ms=$(awk -F, 'NR>1{n++; sum+=$2} END{if(n>0) printf "%.0f", sum/n; else print 0}' "${RESULTS_CSV}")
echo "Total duration: ${total_ms}ms, Avg per file: ${avg_ms}ms" | tee -a "${SUMMARY_TXT}"

echo "\nTop slowest files:" | tee -a "${SUMMARY_TXT}"
sort -t, -k2,2nr "${RESULTS_CSV}" | awk -F, 'NR==1{next} NR<=11{printf "%6d ms  %s\n", $2, $1}' | tee -a "${SUMMARY_TXT}"

echo "\nFailures:" | tee -a "${SUMMARY_TXT}"
awk -F, 'NR>1 && $3!=0 {print $1}' "${RESULTS_CSV}" | sed 's/^/ - /' | tee -a "${SUMMARY_TXT}"

echo "\nArtifacts:"
echo " - ${RESULTS_JSONL} (JSONL)"
echo " - ${RESULTS_CSV} (CSV)"
echo " - ${SUMMARY_TXT} (Summary)"

exit $([[ ${fails} -eq 0 ]] && echo 0 || echo 1)
