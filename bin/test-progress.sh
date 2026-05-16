#!/usr/bin/env bash
set -u

# Progressive test runner: runs tests one file at a time and prints per-file timing.
# Env:
#  - TIMEOUT (ms) per file, default 300000
#  - MAX_FILES limit number of test files
#  - BUN_JOBS set to 1 for sequential runs (recommended)

TIMEOUT_MS=${TIMEOUT:-300000}
MAX_FILES=${MAX_FILES:-}

# Collect test files
mapfile -t FILES < <(find test tests -type f \( -name "*.test.ts" -o -name "*.test.js" \) | sort)

if [[ -n "${MAX_FILES}" ]]; then
  FILES=("${FILES[@]:0:${MAX_FILES}}")
fi

TOTAL=${#FILES[@]}
echo "Found ${TOTAL} test files"

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
  if [[ $code -eq 0 ]]; then
    passes=$((passes+1))
    echo "=== PASS  $(date -Is) :: [$idx/$TOTAL] $f :: ${DUR}ms"
  else
    fails=$((fails+1))
    echo "=== FAIL  $(date -Is) :: [$idx/$TOTAL] $f :: ${DUR}ms (exit ${code})"
  fi
  echo
done

echo "Summary: ${passes} passed, ${fails} failed, ${TOTAL} total"
exit $([[ ${fails} -eq 0 ]] && echo 0 || echo 1)

