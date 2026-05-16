---
title: Embedding External Language Servers into the Core (Layer 3 Planner / Layer 4 Ontology)
description: Architectural plan to integrate LSP semantics across all adapters (LSP, MCP, HTTP, CLI) while deprecating redundant implementations
status: proposal
owner: core-team
---

# LSP Embedding Plan (Layer 3 Planner)

## 1. First Principles & Rationale

- Single source of truth: The core should provide capabilities once, while adapters (LSP/MCP/HTTP/CLI) map protocol details. Re-implementing editor features violates this principle and increases maintenance.
- Leverage mature semantics: Language servers (TS/JS, Pyright, rust-analyzer, etc.) already implement high-quality semantics (definitions, references, implementations, code actions, rename). We should consume, not recreate them.
- Progressive enhancement: Our 5-layer model remains. External LSP semantics become a dedicated “Layer 2.5: External Semantics” feeding Layer 3 (Planner) and Layer 4 (Semantic Graph), and higher layers (learning/propagation).
- Adapter-agnostic: Once embedded, all adapters and the CLI can access LSP-grade features without needing an IDE.

Second–Fourth Order Effects:
- Second order: Reduced code duplication; fewer -32601 errors; faster delivery; improved precision; consistent features across interfaces.
- Third order: Better training data for patterns; team-wide consistency; easier onboarding; cross-adapter parity (CLI, MCP, LSP, HTTP).
- Fourth order: Cross-language concept mapping powered by authoritative LS signals; marketplace patterns generalize beyond a single language; better analytics.

## 2. Objectives

- Integrate external Language Servers (LS) into the core as a managed service.
- Replace internal reimplementations (e.g., “dumb” ripgrep-only paths) for features where LS is authoritative.
- Keep fast Layer 1/2 as fallbacks and for discovery/recall; use LS to validate/precise results.
- Expose LS-powered capabilities uniformly to all adapters and the CLI.

Non-Goals (for this phase):
- Building our own full LS per language.
- Implementing IDE UX in the core (we only provide capabilities).

## 3. Architecture Overview

Components:
- LS Manager (new): Spawns and supervises per-language LS processes headless (stdio). Detects workspace roots, negotiates capabilities, and normalizes responses.
- LS Clients (per language): Thin connectors for typescript-language-server, pyright-langserver, rust-analyzer, etc. Use `vscode-languageserver-protocol` JSON-RPC to communicate.
- LS Aggregator: Merges results from multiple sources (Layer 1/2, LS). Adds ranking, deduplication, and confidence.
- Core Facade (ExternalSemanticsService): Protocol-agnostic interface exposed inside the core and used by adapters.
- Document Store & Notifications: Centralized document events (open/change/save) relayed to active LS instances.

Position in Layering:
- Layer 1: Fast search (recall, discovery)
- Layer 2: AST (tree-sitter) structural insights
- Layer 2.5 (new): External Semantics from LS
- Layer 3 (Planner) and Layer 4 (Semantic Graph) use L1/L2/L2.5 signals to build and validate concepts/relations
- Layer 4–5: Learning & propagation enhanced by high-precision LS data

## 4. Capability Mapping

Map LSP features to core capabilities, with fallback and merge logic:

- Definitions, References: Prefer LS; fallback to Layer 1 (fast search) + Layer 2 (AST). Use LS to validate and refine.
- Implementations: LS primary; fallback none (optional: heuristic search). New capability in core to serve all adapters.
- Code Actions (refactorings, quickfix): LS primary; expose via core API. CLI/MCP can request refactors without IDE.
- Rename & Prepare Rename: LS primary; layered with our propagation (Layer 5) to extend scope. Plan vs Apply maintained.
- Document Symbols, Folding, CodeLens: LS primary; expose results for UIs or MCP rendering.

Confidence & Ranking:
- Tag results as `source: 'ls' | 'l1' | 'l2'` and `lsValidated: boolean`.
- Merge by location (uri+line+char) with preference order: LS > AST > L1.
- Cache TTL tuned by feature type and file change events.

## 5. Core API Additions (Protocol-Agnostic)

Introduce `ExternalSemanticsService` in core (names subject to bikeshedding):

```ts
interface Position { line: number; character: number }
interface Range { start: Position; end: Position }

interface ExternalSemanticsService {
  initialize(workspaceRoot: string): Promise<void>
  shutdown(): Promise<void>

  definitions(uri: string, pos?: Position, idHint?: string): Promise<Definition[]>
  references(uri: string, pos?: Position, idHint?: string, includeDeclaration?: boolean): Promise<Reference[]>
  implementations(uri: string, pos?: Position, idHint?: string): Promise<Implementation[]>
  codeActions(uri: string, range: Range, kind?: string): Promise<CodeActionLike[]>
  prepareRename(uri: string, pos: Position): Promise<{ range: Range, placeholder: string } | null>
  rename(uri: string, pos: Position, newName: string, dryRun?: boolean): Promise<WorkspaceEdit>
  documentSymbols(uri: string): Promise<DocumentSymbolLike[]>
  foldingRanges(uri: string): Promise<FoldingRangeLike[]>
  codeLens(uri: string): Promise<CodeLensLike[]>
}
```

Notes:
- Keep result types compatible with existing core `types.ts` or add light adapters.
- All adapters (LSP/MCP/HTTP/CLI) call the same core methods.

## 5.1 Dual-Mode Provider Strategy (Editor vs Headless)

- In-editor (VS Code extension present): Do not spawn a parallel TypeScript/Python LS inside the core. Instead, the extension brokers requests to the built-in LS via commands like `vscode.executeDefinitionProvider`/`...ImplementationProvider`/`...CodeActionProvider` and forwards results to the core. This avoids double indexing and CPU contention.
- Headless (CLI/MCP/HTTP): Start managed LS processes via LS Manager. Mirror file system and (optionally) unsaved buffers from our Document Store when available.
- Switching: A simple runtime flag `externalSemantics.mode = 'proxy' | 'embedded'` determined by environment (extension sets `proxy`, others default to `embedded`).

## 6. LS Manager & Clients

Responsibilities:
- Discover: Determine languages in workspace and required LS binaries.
- Spawn: Start LS processes with stdio; handle retries; capture logs for diagnostics.
- Initialize: Send `initialize`/`initialized`, track server capabilities.
- Route: Multiplex requests to the correct LS for a given URI.
- Observe: Record timing, errors, feature support; expose diagnostics.

Supported servers (Phase 1):
- TypeScript/JavaScript: `typescript-language-server` + `tsserver`
- Python: `pyright-langserver`
- Rust: `rust-analyzer` (optional in Phase 1 if complexity too high)

Implementation details:
- Use `vscode-languageserver-protocol` and `vscode-jsonrpc` to implement a minimal client.
- Document events: the core already has file change tracking; mirror those events to each active LS.
- Cancellation: Use JSON-RPC cancellation tokens; enforce per-feature budgets (e.g., 150–500ms).

Codebase hooks (insert points):
- Our LSP server already collects document events and forwards to core: `src/servers/lsp.ts:97` and `src/adapters/lsp-adapter.ts:224` / `:243`. The ExternalSemanticsService should subscribe to these and emit `textDocument/didOpen|didChange|didSave` to embedded LS when in `embedded` mode.
- AnalyzerFactory and SharedServices lifecycle are suitable places to initialize/shutdown the LS Manager with the workspace root.

## 7. Aggregation & Fallback Strategy

For each capability:
- Try LS first (budgeted). If results arrive within budget, return.
- If LS exceeds budget or is unavailable, fallback to Layer 1 (+optional Layer 2 escalation) with lower confidence.
- Merge results when both are available; prefer LS with tie-breaking by confidence and AST validation.

Budgeting example:
- Definition: LS 200ms; fallback L1 150ms; escalate L2 150ms as needed.
- References: LS 400ms; fallback L1 300ms; L2 200ms for validation of top candidates.

## 8. Integration Points

Adapters:
- LSP Server: Reduce our claimed capabilities to those backed by core. When client probes extra methods, we can still return empty lists to avoid noisy errors.
- MCP Adapter: Add tools that call the new core service (implementations, refactorings via code actions, doc symbols, folding). This lets the LLM use IDE-grade features without an IDE.
- HTTP Adapter: Expose REST endpoints mirroring the ExternalSemanticsService for automation and CI.
- CLI: New commands (e.g., `cli refs/defs/impl/actions/rename`) invoke the core service; starts LS headless.

Semantic Graph (Layer 4):
- Consume LS signals as high-confidence edges (e.g., `defines`, `references`, `implements`).
- Use LS document symbols to seed concept extraction and enrich ontology nodes.

Rename & Propagation:
- Use LS `prepareRename/rename` to build the base edit set.
- Merge with propagation results (Layer 5) for cross-file patterns; preserve LS edits as “authoritative.”

VS Code extension specifics (when in proxy mode):
- We already pull refactorings via `vscode.executeCodeActionProvider` in `vscode-client/src/commands/CommandManager.ts:203`. Add similar paths for definitions/references/implementations/symbols to feed results back into the core via custom notifications/requests when desired (for learning/graph), without blocking the user interaction path.

## 9. Dependency & Environment Management

- Auto-detect installed LS binaries; provide configuration overrides.
- Offer `just ensure-servers` to install `typescript-language-server`, `pyright`, and optionally `rust-analyzer`.
- Containerize LS for CI where needed.

Repo reality check:
- Dependencies present: `vscode-languageserver` (server). Lockfile contains `vscode-jsonrpc` and `vscode-languageserver-protocol`; we should add them explicitly for client roles.
- Execution environment: Bun + Node 18+ (OK for spawning child processes and ESM modules).
- Existing Go project `legacy/mcp-language-server/` proves feasibility of an LSP→MCP bridge (now archived); we conceptually replicate this in Node for the core.

## 10. Observability & Reliability

- Metrics: per-feature latency (LS vs fallback), cache hit rate, failure types.
- Circuit breaker: Temporarily disable flaky LS and rely on fallback to maintain responsiveness.
- Structured logs tied to requestId; surface in `getDiagnostics()`.

## 11. Security & Isolation

- Run LS as child processes with limited environment.
- No networked LS unless explicitly configured.
- Sanitize inputs; redact sensitive env values in logs.

## 12. Migration Plan (Deprecate Redundant Implementations)

Phase A (Bootstrap, 1–2 weeks):
- Implement LS Manager + TS/JS client.
- Wire definitions/references/implementations/rename into core via ExternalSemanticsService.
- Add CLI commands; wire MCP tools for these capabilities.
- LSP server: advertise only supported capabilities and return empty arrays for probed methods.

Additional Phase A items (editor vs headless):
- VS Code mode: do NOT spawn embedded TS LS; rely on native LS via VS Code commands to avoid duplicate indexing.
- Headless mode: spawn embedded LS and wire document events from the core’s Document Store or direct file reads.

Phase B (Consolidation, 1–2 weeks):
- Replace internal “dumb” paths for definitions/references where LS is available; keep L1/L2 for fallback and ranking.
- Add code actions (refactorings) and document symbols/folding.
- Feed LS signals into Layer 3 concept graph.

Phase C (Expansion, 2–3 weeks):
- Add Python (pyright) and Rust (rust-analyzer) clients.
- Deduplicate utilities and searches replaced by LS; remove dead code paths and tests.
- Extend MCP tools to surface more LS features to the LLM (e.g., quick fixes, refactor previews).

## 13. Risks & Mitigations

- LS fragility/version drift: Pin versions; detect capability at runtime; provide fallbacks.
- Performance regressions: Strict budgets and timeouts; cache; circuit breakers.
- Complexity creep: Keep the ExternalSemanticsService minimal; do not leak protocol details.
- Multi-language overlap: Route by file language; optionally allow multi-LS merge (edge cases) with clear precedence.
- Double-indexing when inside VS Code: mitigated by proxy mode (extension brokers, core does not spawn LS).
- Unsaved buffer visibility in headless: provide an optional Document Store and API for adapters to push transient content when needed; otherwise operate on disk state for CLI/CI.

## 14. Success Metrics

- 90% of definition/reference/implementation requests served by LS within budget.
- >75% reduction in fallback-only usage for supported languages.
- Zero -32601 errors in normal operation.
- Positive developer feedback; fewer custom codepaths.

## 15. Work Items

- Core
  - [ ] Define `ExternalSemanticsService` interface and types
  - [ ] Implement LS Manager and TS/JS client
  - [ ] Add Aggregator + merge/ranking
  - [ ] Relay document events from core to LS
  - [ ] Expose diagnostics & metrics
  - [ ] Add `externalSemantics.mode` (proxy/embedded) and environment detection

- Adapters
  - [ ] LSP server: claim only supported capabilities; wire to core service
  - [ ] MCP: new tools for implementations, code actions, doc symbols, folding
  - [ ] CLI: `defs/refs/impl/actions/rename` commands
  - [ ] HTTP: REST endpoints mirroring service
  - [ ] VS Code: add proxy calls for definitions/references/implementations/symbols (optional) to hydrate learning/graph

- DevEx & Ops
  - [ ] `just ensure-servers` installer
  - [ ] Add docs & examples
  - [ ] Integration tests spanning LS + fallback

## 16. Example Flow (Definitions)

Embedded mode (CLI/MCP/HTTP):
1) Adapter calls `core.externalSemantics.definitions(uri, pos)`
2) LS Manager routes to TypeScript LS; sends `textDocument/definition`
3) Response merged with Layer 1/2 if necessary; ranked by confidence
4) Core returns unified `Definition[]` to adapter
5) Layer 3 records edges and updates concept graph

Proxy mode (VS Code):
1) Extension resolves definitions via `vscode.executeDefinitionProvider`
2) Extension returns results directly to UI and optionally forwards to core (`ontology/pushExternalSignal`) for learning/graph
3) Core uses results to update concept graph; no embedded LS spawned

## 17. Appendix: Proposed Module Layout

```
src/core/services/external-semantics/
  index.ts                # ExternalSemanticsService facade
  ls-manager.ts           # Spawn/supervise LS processes
  ls-client-base.ts       # JSON-RPC wrapper
  ls-client-ts.ts         # TS/JS client specifics
  ls-client-py.ts         # Pyright client specifics (Phase C)
  aggregator.ts           # Merge/rank results
  mappers.ts              # Map LSP types -> core types
  diagnostics.ts          # Metrics and health
  document-store.ts       # Optional transient buffers for headless
```

## 18. Decision Log

- Adopt LS as authoritative semantics; core remains protocol-agnostic.
- Maintain Layer 1/2 for recall, speed, and fallbacks.
- Do not disable built-in IDE language servers; we augment them.

---
This plan aligns with VISION.md: one brain, many interfaces. We unify semantics through LS integration, reduce duplication, and amplify every adapter—including the CLI and MCP—without re‑implementing IDE features.

## 19. Codebase Survey & Constraints (Findings)

- We have our own thin LSP server: `src/servers/lsp.ts:13`, with an adapter: `src/adapters/lsp-adapter.ts:20`. Currently only a subset of features is implemented (defs/refs/rename/completion) and others should not be advertised to avoid -32601.
- MCP adapter exists and is robust: `src/adapters/mcp-adapter.ts:1`. It’s a good surface to add LS-backed tools (implementations, code actions, symbols, folding).
- A separate Go bridge `legacy/mcp-language-server/` demonstrates LSP→MCP feasibility (archived); we apply the same concept in Node for uniformity.
- Dependencies: project already includes `vscode-languageserver` (server). Lockfile shows `vscode-jsonrpc` and `vscode-languageserver-protocol` available—add explicitly for client usage.
- Environment: Bun (ESM) + Node 18+ are compatible with JSON-RPC and child processes.
- Document events currently reach the core without content snapshots; for headless accuracy we will optionally add a Document Store to push unsaved buffers when needed.

No hard prohibitions were found. The main risks are operational (duplicate LS inside VS Code, performance, and unsaved buffer handling). The dual-mode strategy addresses these.
