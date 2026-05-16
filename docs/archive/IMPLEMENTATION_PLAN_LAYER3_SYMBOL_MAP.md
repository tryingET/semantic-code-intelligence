# [ARCHIVED] Implementation Plan — Layer 3 (Symbol Map + Rename Planner) and Universal Tool Registry

Purpose: Capture everything needed to start from zero context and implement a targeted Symbol Map + Rename Planner (Layer 3) and a universal core tool registry, wired to all adapters (MCP/HTTP/LSP/CLI). This document is self-contained and serves as the kickoff plan.

## Context and Rationale

- Layers (renumbered for clarity):
  - Layer 1: Fast Search (rg/fd; async; filename + content)
  - Layer 2: AST Analysis (tree-sitter validation/narrowing)
  - Layer 3: Symbol Map + Rename Planner (new)
  - Layer 4: Ontology/Semantic Graph (concepts/relations)
  - Layer 5: Pattern Mining/Learning (pattern discovery/feedback)
  - Layer 6: Knowledge Propagation (safe propagation/rollouts)

- Problem: L1/L2 provide token ranges but safe rename/refactor requires resolving bindings/imports/aliases and scopes per file. We need a targeted symbol map for just the candidate files/symbols—fast, precise, and bounded—then a planner to produce safe WorkspaceEdits.

- Direction: Add Layer 3 (Symbol Map + Rename Planner) as a universal capability in the core (not MCP-only), and introduce a core tool registry so MCP/HTTP/CLI/LSP expose the same capabilities.

## Architecture Decision Brief

- Reasons to split into distinct layers (for):
  1. Separation of concerns: I/O (L1), parsing (L2), mapping/planning (L3), higher semantics (L4-L6).
  2. Performance isolation: long-running layers (L4-L6) won’t affect L1-L3 responsiveness.
  3. Testability/metrics: unit/integration per layer; clear budgets and health.
  4. Extensibility: layer-specific improvements without cross-impact.

- Reasons against splitting (cons):
  1. Orchestration complexity: more budgets/fallbacks.
  2. Latency compounding: small overheads accumulate.
  3. Cognitive load for contributors.
  4. Duplicated cross-cutting concerns (cache, telemetry) unless centralized.

- Reasons to combine L2+L3:
  1. Single parsing pass reduces overhead.
  2. Simpler control plane, fewer toggles.
  3. Better cache locality and hit rate.
  4. Aligns with typical LSP server “semantic pass”.

- 80/20 Recommendation:
  - Keep six logical layers, but implement L2 and L3 on a shared parsing pipeline/cache.
  - L4–L6 remain optional plug-ins with strict budgets/opt-in.
  - Prioritize deterministic, bounded behavior and stable outputs; document environment overrides.

## Interop with Native Language Servers (Type-Aware Providers)

We will optionally consult native language servers (e.g., tsserver) during Layer 3 planning for type‑aware disambiguation, without coupling core to any single provider.

Design:
- Provider interface (pluggable):
  - `SymbolProvider` with methods like `prepareRename(uri, position)`, `rename(uri, position, newName)`, `findDefinition(uri, position)`, `findReferences(uri, position)`; all bounded with timeouts and cancellable.
  - Minimal mapping layer converts provider responses into our SymbolMap inputs (locations/ranges) and confidence hints.
- Detection & control:
  - Detect tsserver availability (local process or language SDK).
  - Config/env toggles: `PROVIDERS_TS_ENABLE=1`, budget `PROVIDERS_TS_BUDGET_MS`, and per‑call timeouts.
  - Default: off in CI; opt‑in locally.
- Flow in Layer 3:
  - Build candidate set from L1/L2.
  - If provider enabled and budget available, consult provider for the current file/position(s) to refine binding resolution.
  - Merge provider hits into SymbolMap with provenance (provider vs AST), and prefer provider ranges when confidence is higher.
- Budgets & cancellation:
  - Hard timeouts; immediate cancellation if budget exceeded.
  - Always produce a plan from our AST map even if provider is unavailable or times out.
- Security/trust:
  - Provider runs locally; no network calls.
  - Inputs/outputs sanitized; never apply edits without our planner validating ranges.

Benefits:
- Higher precision on complex TypeScript rename cases (union types, overloads, inferred names).
- Keeps our bounded, repo‑aware planner while leveraging native semantics when present.

Risks/Mitigations:
- Provider latency: strictly budgeted; fallback to AST map.
- Divergence: provenance tracked; unit tests ensure identical behavior when provider is off.


## Goals (Deliverables)

1) Layer 3 (Symbol Map + Rename Planner) for TS/JS
- Parse candidate files once via tree-sitter (shared with L2); extract:
  - Bindings (function/class/const/var), import/export specifiers, call identifiers, member uses.
- Resolve bindings → usages (follow imports/aliases; scope-aware; avoid shadowing).
- Generate WorkspaceEdit (non-overlapping, ordered token edits), plus impact summary (files/edits/exported API changes, risky contexts).

2) Core Tool Registry (universal)
- Canonical list of tools (≥ 12, target 16+), with schemas + metadata.
- MCP/HTTP/CLI expose same registry; LSP maps to standard methods but calls core APIs.

3) Adapters Wiring
- MCP: add plan_rename/apply_rename, list tools from registry.
- HTTP: /api/v1/{symbol-map, plan-rename, apply-rename}.
- CLI: add `plan-rename` preview; `rename` to apply; stable JSON outputs.
- LSP: prepareRename/rename use Layer 3 planner; return precise ranges and WorkspaceEdits.

4) Docs + Tests + Telemetry
- README/API_SPECIFICATION: Tool list, endpoints, examples.
- PROJECT_STATUS/NEXT_STEPS/VISION updated.
- Unit/integration/perf tests; telemetry events for semantic pass.

## Non-Goals
- Full-repo indexing or global repomap; only targeted files/symbols.
- Multi-language in v1 (TS/JS first).
- Removing legacy shims immediately (plan later).

## APIs and Data Shapes

### CodeAnalyzer (new)
- `buildSymbolMap({ identifier, defs, refs, workspaceRoot, options }) → SymbolMap`
- `planRename({ identifier, newName, options }) → { edit: WorkspaceEdit, impact: { files, edits, risks } }`
- `applyRename({ edit, options }) → { applied: number, skipped: number, errors: [] }`

Options include:
- caps (maxCandidateFiles), budgets (ms), unsafe flags (include property keys), AST-only, precise, dry-run.

### SymbolMap (concept)
- Per-file:
  - bindings: [{ name, kind, range, exportKind? }]
  - imports: [{ specifier, localName, source, kind }]
  - usages: [{ name, kind, range, bindingId, safe: boolean }]
  - scope info: (minimal for rename safety)

### WorkspaceEdit
- Standard LSP shape: { changes: { [uri]: TextEdit[] } }.
- Planner returns ordered non-overlapping edits; descending order by position per file.

## Universal Tools (Initial Set, 80/20)

- find_definition, find_references, explore_codebase
- plan_rename, apply_rename
- grep_content, list_files
- diagnostics
- get_hover, get_completions (bounded, optional)
- list_symbols (per-file)
- pattern_stats (Layer 5 snapshot)
- knowledge_insights (Layer 6 snapshot)
- cache_controls (warm/clear)

MCP exposes these as tools; HTTP as endpoints; CLI as commands; LSP uses standard methods for core ones and can expose advanced tools in separate commands if desired.

## Workstreams & Steps

1) Core Tool Registry
- Create core/tools/registry.ts with canonical list (name, description, input/output schema/ref, availability flags).
- Wire MCP getTools() to read from the registry.
- Ensure HTTP OpenAPI lists the registry tools.

2) Layer 3 (TS/JS)
- Shared parse cache: unify L2/L3 parsing.
- Extraction: queries for bindings/import/export/usages.
- Resolution: link bindings ↔ usages (alias and scope aware).
- Planner: compute rename edits; flag unsafe contexts; output WorkspaceEdit + impact summary.
- Confidence/filters: include only AST+scope validated occurrences by default.

3) CodeAnalyzer APIs
- Add buildSymbolMap/planRename/applyRename with budgets/caps and progress events.
- Integrate L1/L2 outputs to seed candidate file set.

4) Adapters
- MCP: add plan_rename/apply_rename; error handling; examples.
- HTTP: `/symbol-map` (GET/POST), `/plan-rename` (POST), `/apply-rename` (POST).
- CLI: `plan-rename <identifier> <newName> [--json] [--unsafe-properties] [--ast-only]`; `rename` reuses plan or reads from stdin.
- LSP: prepareRename/rename backed by Layer 3; return precise ranges and safe edits.

5) Tests & Telemetry
- Unit: resolution correctness (imports/aliases/scope); token ranges per file; non-overlap edits.
- Integration: rename across import chains; exported API rename confirmation; skip strings/comments/property keys by default.
- Performance: cap candidate files; bounded semantic pass; deterministic under CI.
- Telemetry: semantic-pass start/end; parsed files; nodes matched; edits planned; timings.

6) Rollout
- Phase 1: TS/JS only; MCP/CLI/HTTP wired; LSP migrate to planner.
- Phase 2: leverage Layer 4–6 optionally (suggest broader refactors; confidence gating).
- Phase 3: consider a shared “semantic worker” implementation for L2+L3 under the hood with logical layers intact.

## Acceptance Criteria

- plan_rename returns valid WorkspaceEdit (no overlaps) and an accurate impact summary.
- rename applies cleanly or returns precise errors; dry-run works.
- LSP prepareRename/rename accurate ranges and placeholders for TS/JS.
- MCP/HTTP/CLI outputs consistent counts and stable JSON; progress events available.
- Tests green (non-perf); perf bounded; env overrides documented and respected.

## Budgeting and Environment Overrides

- Short-seed AST: auto-boost budget (≥150–200ms) and cap candidates ≤8; prioritize basename matches.
- Env overrides (documented in README):
  - ESCALATION_L2_BUDGET_MS
  - ESCALATION_L1_CONFIDENCE_THRESHOLD
  - ESCALATION_L1_AMBIGUITY_MAX_FILES
  - ESCALATION_L1_REQUIRE_FILENAME_MATCH

## Documents To Update

- README.md: universal tools list; examples for plan/apply rename; layer numbering; tools preferences; env overrides.
- PROJECT_STATUS.md: add Layer 3 milestone, metrics, and current progress.
- NEXT_STEPS.md: add concrete tasks per workstream.
- VISION.md: reflect 1–6 layers and goals; emphasize targeted mapping vs full index.
- API_SPECIFICATION.md: add tool schemas/endpoints.
- ADAPTER_ARCHITECTURE.md: thin adapters; core registry as source of truth.
- DEPLOYMENT_GUIDE.md: health/metrics for new layer; layer labels.

## Timeline (Rough)

- Week 1: Tool registry; Layer 3 skeleton; CodeAnalyzer APIs; unit tests.
- Week 2: TS/JS extraction/resolve; planner; CLI command; integration tests.
- Week 3: MCP/HTTP/LSP wiring; telemetry/metrics; docs; rollout.
