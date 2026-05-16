---
summary: "Ontology‑LSP — Project Status (Concise) for the Semantic Code Intelligence repo."
read_when:
  - "You need PROJECT STATUS information for Semantic Code Intelligence."
  - "You are changing PROJECT_STATUS.md or related behavior."
type: "reference"
---

# Ontology‑LSP — Project Status (Concise)

This is a condensed project status. Detailed historical updates have been moved to `docs/status/`.

Links
- Vision and roadmap: `VISION.md`, `NEXT_STEPS.md`
- Condensed monthly changes: `docs/status/CHANGES-2025-09.md`
- Workflows and tools: `docs/WORKFLOWS.md`, `CONFIG.md`

## Current Status

- Core: unified `CodeAnalyzer` + `LayerManager` orchestrate L1–L5; adapters remain thin.
- Adapters: HTTP, MCP (HTTP/stdio), CLI, and LSP share a unified tool surface (workflows + snapshot-safe editing) with standardized, protocol-shaped error envelopes (including MCP HTTP invalid JSON and CLI workflow JSON errors).
- Tests: MCP HTTP session init helpers, bind guards, and live-socket envelope assertions reduce server-start flake and tighten parity.
- Snapshot workflows: `get_snapshot` / `propose_patch` / `run_checks` / `patch_checks_in_snapshot` are stable for CLI + HTTP + MCP; SNAPSHOT_PARTIAL runs now materialize correctly even when checks execute from inside `.ontology/snapshots/<id>`.
- Dogfooding: `just dogfood_ci` exercises end-to-end HTTP tool flows and emits a JSON summary artifact (schema documented).
- Observability: `/metrics` exports bounded counters/histograms for tool calls and durations; graph expand has explicit primary/fallback/note incidence tracking.
- Learning: pipelines are dev-first but now include feature-gated in-process scheduling and persisted run history (see gaps).

## Recent Highlights

- **Snapshot checks stabilized under SNAPSHOT_PARTIAL (2025-12-31)**: checks now resolve workspace base correctly when invoked from inside materialized snapshots.
- **Learning pipelines scheduler gated + status improved (2025-12-31)**: scheduled pipelines can run in-process under `PIPELINES_ENABLE=1`; pipeline status/list now expose `lastRunAt`/`nextRunAt` and `scheduleNote` for unsupported schedules.
- **MCP HTTP tools/call params normalized (2025-12-31)**: missing JSON-RPC `params` now maps to InvalidParams (-32602) instead of surfacing as InternalError from schema validation; tests assert status/content-type expectations.
- **Cross-protocol perf variance signal improved (2025-12-31)**: validator now uses deterministic protocol ordering and a more robust variance metric (median/MAD) to reduce order bias.
- **Local cross-protocol consistency normalized (2025-12-30)**: suggest_refactoring/rename result counting normalized; local fixtures now hit 100% consistent cases and ~98% average similarity.
- **Cross-protocol similarity lifted locally (2025-12-30)**: Local E2E fixtures now average ~77% similarity after aligning symbol selection and maxResults across adapters; remaining low-consistency cases are suggest_refactoring + rename result counting.
- **MCP tool parity tightened (2025-12-30)**: MCP find_definition/find_references now honor per-call maxResults and references accept file context in cross-protocol validation for parity.
- **MCP HTTP missing-session GET validated (2025-12-30)**: Live-socket parity test added and validated for missing-session GET envelope.
- **CI/spec compliance docs and gating updated (2025-12-30)**: CI runs sqlite-only Layer 4 + adapters + core suites; LSP custom methods and MCP prompt docs expanded; storage adapter env gating documented.
- **MCP HTTP parity tests hardened (2025-12-30)**: SSE-safe body parsing, MCP protocol header/session helpers, and TCP bind guards added for HTTP server parity suites.
- **Cross-protocol edge-case parity extended (2025-12-30)**: MCP HTTP invalid JSON now normalizes to CoreError/JSON-RPC InvalidParams; CLI workflow JSON args/errors are strict and return structured envelopes; parity tests added for MCP HTTP + CLI workflows (live socket validation pending).
- **E2E determinism + local wiring hardened (2025-12-30)**: E2E seeding ensures ≥1 learned pattern, and in-process adapter wiring with env-aware thresholds reduces local flake.
- **CLI snapshot refactor regression fixed (2025-12-29)**: snapshot materialization no longer breaks when `.env` contains placeholder workspace roots (e.g. `/path/to/your/workspace`). Long-running tool operations use caller-provided timeouts (instead of a hard 30s) and avoid noisy retries.
- **Dogfood gated + documented (2025-12-29)**: `just dogfood_ci` is stdout-clean (JSON-only) with a documented schema and a CI validation step; this prevents “works locally, fails in tool-first snapshot CI” regressions.
- **Graph expand UX hardening (2025-12-29)**: callers/callees handling is more explicit (scoped in-file callers; callees can be scoped to a symbol body when file+symbol are provided) and `/metrics` tracks “note incidence” to quantify partial-result paths.
- **LSP custom methods un-stubbed (2025-12-29)**: `ontology/getStatistics` and `ontology/getConceptGraph` return real (budgeted) data instead of placeholder results.
- **Completion kind parity hardened (2025-12-29)**: completion items now normalize `kind` to LSP `CompletionItemKind` (1..25) across LSP/HTTP/MCP, and MCP exposes `get_completions` with the same wire shape.

## Known Gaps

- Cross-protocol parity: MCP HTTP + CLI edge-case envelopes are aligned in code; expand live-socket validation coverage as needed for additional edge cases.
- E2E consistency: local fixtures now hit 100% consistency, but performance variance across protocols remains high; revisit after reducing order bias and consider warmups/caching alignment.
- Test environment: server-start parity suites now skip when TCP bind is unavailable; full coverage still needs a bind-capable host.
- Mapping parity: remaining audits are mostly around non-completion surfaces (error envelopes, diagnostics, and other LSP/MCP field mappings).
- Learning pipelines: scheduling is in-process only (no external cron) and currently supports a bounded schedule subset; pipeline CRUD (enable/disable/update schedule) and metrics/drift tracking are not yet GA.
- CI/workflows: multiple overlapping workflows exist (`ci.yml`, `test.yml`, `ontology-check.yml`); unify/retire legacy ones to avoid inconsistent gating.

## Next Steps (Pointers)

- See `NEXT_STEPS.md` — recommended focus order:
  - 0.3 E2E Cross-Protocol Wiring (error shape + schema parity ≥80% consistency)
  - 0.36 Learning Pipelines Persistence (feature-gated, DB-backed schedules)
  - 0.35 Graph Expand Hardening (remaining)
  - 0.27 Test Slicer & Batch Observability tuning (stable gates + feedback)

## Changelog

- Condensed monthly changes are maintained in `docs/status/CHANGES-2025-09.md`.
