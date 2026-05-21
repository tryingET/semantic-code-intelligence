#!/usr/bin/env bash
set -euo pipefail

# Dedicated coverage entrypoint.
# Normal correctness uses the sliced runner (`bun run test`). Coverage remains a
# separate single-process Bun coverage pass so LCOV output is generated once.
# Keep this command centralized so workflows do not drift back to ad-hoc broad
# `bun test --coverage` invocations.

TIMEOUT=${TIMEOUT:-300000}
BUN_JOBS=${BUN_JOBS:-1}
COVERAGE_TARGETS=${COVERAGE_TARGETS:-tests/}

# shellcheck disable=SC2086 # COVERAGE_TARGETS intentionally accepts a space-separated focused target list.
BUN_JOBS="$BUN_JOBS" bun test --coverage $COVERAGE_TARGETS --timeout "$TIMEOUT"
