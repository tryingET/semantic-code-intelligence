#!/usr/bin/env bash
set -ueo pipefail

# Runs tests per-file, records durations and exit codes, and prints post-run analytics.
# Env:
#  - TIMEOUT (ms) per file, default 300000
#  - MAX_FILES limit number of test files (optional)
#  - BUN_JOBS recommended 1 for sequential runs
#  - OUT_DIR directory to store artifacts (default .test-results)

TIMEOUT_MS=${TIMEOUT:-300000}
MAX_FILES=${MAX_FILES:-}
OUT_DIR=${OUT_DIR:-.test-results}
mkdir -p "${OUT_DIR}"

RESULTS_JSONL="${OUT_DIR}/test-durations.jsonl"
RESULTS_CSV="${OUT_DIR}/test-durations.csv"
SUMMARY_TXT="${OUT_DIR}/summary.txt"
rm -f "${RESULTS_JSONL}" "${RESULTS_CSV}" "${SUMMARY_TXT}"
echo "file,duration_ms,exit_code" > "${RESULTS_CSV}"

mapfile -t FILES < <(find test tests -type f \( -name "*.test.ts" -o -name "*.test.js" \) | sort)
if [[ -n "${MAX_FILES}" ]]; then
  FILES=("${FILES[@]:0:${MAX_FILES}}")
fi

TOTAL=${#FILES[@]}
echo "Running ${TOTAL} test files (timeout ${TIMEOUT_MS}ms per file, BUN_JOBS=${BUN_JOBS:-1})"

passes=0
fails=0
idx=0
for f in "${FILES[@]}"; do
  idx=$((idx+1))
  echo "=== START $(date -Is) :: [$idx/$TOTAL] $f"
  START=$(date +%s%3N)
  BUN_JOBS=${BUN_JOBS:-1} bun test "$f" --timeout ${TIMEOUT_MS}
  code=$?
  END=$(date +%s%3N)
  DUR=$((END-START))

  # Record
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

# Post-run analytics
echo "\n=== POST-RUN ANALYTICS ===" | tee -a "${SUMMARY_TXT}"
echo "Total files: ${TOTAL}, Passed: ${passes}, Failed: ${fails}" | tee -a "${SUMMARY_TXT}"

total_ms=$(awk -F, 'NR>1{sum+=$2} END{print sum+0}' "${RESULTS_CSV}")
avg_ms=$(awk -F, 'NR>1{n++; sum+=$2} END{if(n>0) printf "%.0f", sum/n; else print 0}' "${RESULTS_CSV}")
echo "Total duration: ${total_ms}ms, Avg per file: ${avg_ms}ms" | tee -a "${SUMMARY_TXT}"

echo "\nTop 10 slowest files:" | tee -a "${SUMMARY_TXT}"
sort -t, -k2,2nr "${RESULTS_CSV}" | awk -F, 'NR==1{next} NR<=11{printf "%6d ms  %s\n", $2, $1}' | tee -a "${SUMMARY_TXT}"

echo "\nFailures:" | tee -a "${SUMMARY_TXT}"
awk -F, 'NR>1 && $3!=0 {print $1}' "${RESULTS_CSV}" | sed 's/^/ - /' | tee -a "${SUMMARY_TXT}"

echo "\nArtifacts:"
echo " - ${RESULTS_JSONL} (JSONL)"
echo " - ${RESULTS_CSV} (CSV)"
echo " - ${SUMMARY_TXT} (Summary)"

exit $([[ ${fails} -eq 0 ]] && echo 0 || echo 1)

