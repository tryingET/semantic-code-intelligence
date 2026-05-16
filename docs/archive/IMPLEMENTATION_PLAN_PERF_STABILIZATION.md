# Implementation Plan — Performance Stabilization (Fix‑Bugs‑First)

## Objectives

- Restore green status for non‑perf and perf suites without widening
  scope.
- Fix concrete bugs surfaced by perf runs while preserving behavior.
- Align with VISION.md: layer SLOs, progressive enhancement, and
  observability-first.

## Scope & Non‑Goals

- In scope: L1–L4 fixes, perf test stabilization, metrics, small guards.
- Out of scope: New storage backends (Postgres/TripleStore production),
  new features beyond stabilization.
- Continue using SQLite for Layer 4; keep PG/Triple deferred.

## Known Issues (from recent perf runs)

- Pattern learning perf: TypeError in pattern-storage when
  `example.context.timestamp` is undefined.
- Ontology memory perf: TypeError in SQLite persistence when a
  representation is missing `location`.
- Perf thresholds flakiness on constrained hosts:
  - Large codebase p99 exceeded 200ms expectation.
  - Concurrency p95 exceeded 200ms expectation.

## Workstreams

### A. Core Bug Fixes (High Priority)

Status: COMPLETED (2025-09-01)

- Pattern storage robustness
  - Implemented guards in `src/patterns/pattern-storage.ts`:
    - `example.context` and `timestamp` are optional-safe; default timestamp to epoch (`new Date(0)`).
    - Serializer prunes undefined fields before JSON.
  - Tests: `tests/step4_pattern-learner.test.ts` includes missing-context promotion; suite passes.

- SQLite representation serialization
  - Centralized validation in `src/ontology/location-utils.ts` (`normalizeUri`, `sanitizeRange`, `isValidLocation`).
  - Builder/Engine use these guards (rename/move/import avoid creating invalid reps; import drops/normalizes bad reps).
  - Storage (`src/ontology/storage.ts`):
    - Save/Load skip malformed reps; aggregate one warning per concept and maintain skip counters.
    - Automatic DB cleanup on initialization removes legacy malformed rows (no CLI needed).
  - Metrics: `InstrumentedStoragePort.getMetrics().extras` surfaces `skippedRepresentationsSave/Load`.
  - Tests: added
    - `tests/layer4-representation-skip.test.ts` (skip behavior + warning)
    - `tests/layer4-engine-validation.test.ts` (rename/import/move guards)
    - `tests/layer4-db-cleanup.test.ts` (init-time cleanup)

### B. Async Search Reliability (L1/L2 Budgets)

Status: COMPLETED (2025-09-01)

- Timeouts and fallback noise
  - Implemented env override for async L1 default timeout:
    - `ENHANCED_GREP_DEFAULT_TIMEOUT_MS` (applied when no timeout passed).
  - Process pool aligns with CPU cores; optional override via `ENHANCED_GREP_MAX_PROCESSES`.
  - Added perf warm‑up in benchmarks to reduce cold‑start variance.

- Short‑seed AST escalations
  - Verified budget behavior remains bounded under env‑tuned timeouts; further L1/L2 tuning tracked under 2.1.

### C. Performance Test Stabilization & Determinism

Status: COMPLETED (2025-09-01)

- Environment‑aware thresholds
  - Perf tests consume env overrides:
    - `PERF_P95_TARGET_MS`, `PERF_P99_TARGET_MS`, `PERF_CONCURRENCY_P95_TARGET_MS`.
  - Tests assert against configured values to reduce host variance.

- Deterministic fixtures
  - Added synthetic large‑tree fixture for 10k‑files (`tests/performance/utils/large_tree.ts`) and gated test `tests/performance/large-tree.test.ts`.

- Async fallback accounting
  - L1 fallbacks/timeouts counted via metrics; can be asserted in gated perf runs if needed.

### D. Observability & SLOs (Layer‑Aligned)

Status: COMPLETED (2025-09-01)

- L1: count timeouts/fallbacks; exposed via `getMetrics()`, consolidated `/metrics`, and CLI stats.
- L2: tracked parse durations p50/p95/p99 and errors; surfaced in `getMetrics()` and `/metrics`.
- L4: reused instrumentation (p50/p95/p99, counts, errors); extras include skipped reps (A2).
- HTTP `/metrics`: JSON and Prometheus endpoints now include L1/L2/L4.

### E. Tests & Docs Hygiene

Status: COMPLETED (2025-09-01)

- Tests
  - Added tests for A (pattern‑storage, malformed representation).
  - Updated perf tests to read env thresholds and perform warm‑up.
  - Added `tests/http-metrics.test.ts` for consolidated metrics endpoint.

- Docs
  - `CONFIG.md`: documented perf envs, process pool override, `/metrics` surfaces, warm‑up guidance.
  - `PROJECT_STATUS.md`: tracks stabilization progress and gating choices.

## Acceptance Criteria

- Non‑perf suites: green (adapters, unified‑core, integration, L4 parity).
- Perf benchmarks:
  - No TypeErrors during pattern learning or ontology persistence. (Met with A1/A2 fixes.)
  - Large codebase and concurrency tests satisfy defaults on typical dev hosts; env overrides available for constrained CI.
  - Reduced async→sync fallback warnings; count below threshold.

## Risks & Mitigations

- Skipping malformed anchors could hide data issues.
  - Mitigate: warn and count skipped items; expose count in metrics.
- Perf thresholds flaky on shared runners.
  - Mitigate: env overrides + deterministic fixtures + warm‑up steps.

## Execution Plan (Sequenced)

1) Implement A: pattern‑storage guards + tests. (DONE)
2) Implement A: SQLite representation guard + tests. (DONE)
3) Implement B/C: perf env knobs + warm‑up + deterministic fixture.
4) Implement D: L1/L2 counters; log in perf context.
5) Run targeted suites (non‑perf → perf); tune thresholds only if
   needed.
6) Update docs/status and land changes.

## Verification Steps

- Run non‑perf:
  - `bun test tests/layer4-*.test.ts tests/unified-core.test.ts \
     tests/adapters.test.ts`
- Run perf selectively:
  - `PERF=1 bun test tests/performance/benchmark.test.ts`
  - `PERF=1 bun test tests/performance.test.ts`
- Observe CLI `stats` and HTTP `/metrics` counters after perf runs.

## Timeline

- Day 1: Workstream A, perf timeouts env + warm‑up.
- Day 2: Workstream C determinism + D counters + docs.
- Day 3: Stabilization reruns; minor threshold tuning if required.

## Non‑Goals (Reiterated)

- No productionization of Postgres/TripleStore in this cycle.
- No new features beyond guards, env knobs, and metrics needed for
  stabilization.
