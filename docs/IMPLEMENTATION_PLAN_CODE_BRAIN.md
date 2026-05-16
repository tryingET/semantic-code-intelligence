# Implementation Plan — Hybrid Code Intelligence (AST + SCIP, optional LSP)

## Objective
Deliver a fast, reliable, and safe code‑intelligence core tailored for LLM workflows:
- Default to AST + graph for navigation/reads/planning.
- Add offline SCIP/LSIF for precise cross‑file nav when available.
- Use LSP only as a feature‑flagged booster for typed rename/impl.
- Expose snapshot‑aware, model‑friendly MCP HTTP tools.

## Success Metrics
- Latency: p95 < 100ms for read/nav ops (AST/SCIP path); boosted LSP ops p95 < 500ms.
- Accuracy: go‑to‑def ≥ 95% on goldens; rename safety ≥ 99.5%.
- Reliability: fallback rate to LSP ≤ 10% of queries; error budgets respected.
- Safety: 100% edits land as diffs gated by format/lint/typecheck/tests + CODEOWNERS.

## Scope (In / Out)
- In: AST indexer, graph queries, snapshot/overlay store, MCP HTTP tools, SCIP integration, minimal LSP booster for TS typed‑rename, metrics/flags.
- Out (initially): full IDE parity, broad LSP features, non‑essential adapters, non‑TS/Py boosters.

## Architecture (Target)
- Router: chooses AST → SCIP → LSP by policy, budgets, freshness.
- Core: incremental AST + symbol/xref graph, snapshot/overlay.
- Boosters: offline SCIP indices; on‑demand LSP pool (flagged).
- Adapters: MCP HTTP tool surface (OpenAPI) only exposes core types.
- Observability: p50/p95/p99, routing ratios, rename safety, index freshness.

## Phase A — Code Brain & MCP (1–2 weeks)
1) Contracts (OpenAPI)
- Tools: get_snapshot, read_file, list_symbols, ast_query, find_definition, find_references, propose_patch, run_checks.
- Require snapshot ID on subsequent calls; validate inputs and sizes.

2) Core indexer & graph
- Build incremental AST + symbol/xref index; gitignore‑aware; debounce.
- Graph queries: callers/callees, imports/exports, file/module symbols.

3) Snapshot/overlay
- Versioned overlays (commit + buffer version). Reject stale responses.
- propose_patch applies unified diffs to overlay; runs checks; accepts/rejects.

4) Observability & budgets
- Emit metrics per op/backend; expose /stats; add feature flags and kill‑switches.

5) Tests
- Golden suites for defs/refs/rename; mutation tests for rename safety; contract tests for MCP endpoints.

Deliverables: OpenAPI spec, MCP HTTP handlers, AST index + graph, snapshot store, metrics, tests.

## Phase B — Offline SCIP/LSIF (1–2 weeks)
1) Indexers
- Add optional `scip-typescript` and `scip-python` CI steps per package.
- Cache artifacts; measure time/CPU/RSS; store indices locally.

2) Router integration
- Prefer SCIP for defs/refs when fresh; mark stale results; fallback to AST.
- Overlay delta: reindex changed packages/files; merge baseline + overlay.

3) Metrics & tests
- Compare precision/latency vs AST on goldens; add freshness labels.

Deliverables: SCIP build steps, router integration, freshness policy, benchmarks.

## Phase C — Minimal LSP Booster (TS only) (1 week)
1) Scope: typed rename (TS)
- Routing predicates: generics/aliases/re‑exports/conditional types → LSP; else AST/SCIP.
- Pool 1 server per (lang, root, config); TTL idle 5–10m; strict timeouts.

2) Safety & validation
- Versioned overlays via didOpen/didChange; validate edits against AST/SCIP.
- Circuit breaker on latency/memory; auto‑fallback on mismatch.

3) Metrics
- Track p95, fallback rate, rename safety; flag default off.

Deliverables: LSP booster module, router rules, validation, metrics.

## Turborepo Packaging (supporting)
- apps/mcp-service (HTTP MCP server)
- packages/core (AST + snapshot + graph), packages/code-graph (queries)
- packages/boosters-scip, packages/boosters-lsp (flagged)
- packages/observability, packages/config, packages/tsconfig
- Keep moves incremental; start with shared configs before relocations.

## Kill/Keep Criteria
- Disable LSP path if p95>200ms for >20% boosted ops or RSS > budget, or if AST/SCIP hit accuracy thresholds on goldens.
- Keep SCIP if CI budget holds and precision ≥ AST; otherwise scope to hot packages.

## Risks & Mitigations
- Tail spikes: strict timeouts, queue caps, circuit‑breakers; fallback.
- Stale indices: baseline + overlay deltas; freshness flags; fallback.
- Overlay drift: versioned overlays; post‑validation; rollback.
- Repo churn (move to Turbo): stage config packages first; small diffs.

## Milestone Checklist
- [ ] OpenAPI defined; handlers implemented; tests passing.
- [ ] AST index + graph + overlay store; metrics exposed.
- [ ] SCIP indexing wired; router + freshness policy; benchmarks captured.
- [ ] TS typed‑rename booster behind flag; validation + metrics; kill‑switches.
- [ ] ADRs recorded; docs updated; CI updated; ignore generated artifacts.

