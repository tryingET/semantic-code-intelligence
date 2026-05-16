---
summary: "NEXTSTEPS.md - What to Do Next for the Semantic Code Intelligence repo."
read_when:
  - "You need NEXT STEPS information for Semantic Code Intelligence."
  - "You are changing NEXT_STEPS.md or related behavior."
type: "reference"
---

# NEXT_STEPS.md - What to Do Next

> **Purpose**: Forward-looking action items ONLY. No history, no completed items.
> For completed work, see PROJECT_STATUS.md

---

## 🚀 Immediate Priorities (Active Work)

### 0.3 E2E Cross-Protocol Wiring
- MCP HTTP transport parity: keep live-socket envelope tests green and explicit about HTTP semantics (invalid JSON → 400 + JSON; JSON-RPC tool errors → 200 + SSE with error payload)
- MCP HTTP schema failures: ensure `tools/call` missing JSON-RPC `params` consistently maps to InvalidParams (-32602), not InternalError (-32603)
- Test harness: audit remaining server-start suites for bind guards; ensure full parity runs on bind-capable hosts
- CLI workflow parity: ensure JSON error envelope tests stay stable in CI/local
- Performance variance: re-check variance after reducing protocol-order bias; align warmups/caches where possible; keep metrics actionable
- MCP robustness: consider tiny debounce to avoid repeated init in quick retries

### 0.27 Test Slicer & Batch Observability - Tuning
- Decide soft vs hard gates for slow batches; set repo variables accordingly
- Tune matrix size (6→8) if runners available to reduce wall-clock further
- Add "top offenders" comment bot (optional) sourced from aggregate summary

### 0.28 L4/L5 Robustness
- L4 (SQLite): guard evolution reads/writes; add indices for hot paths
- L5: `run_pipeline`, run history listing, and simple retry/backoff

### 0.35 Graph Expand Hardening (remaining)
- Strengthen callers/callees detection under fallback (bounded AST-first, regex fallback)
- Add symbol-only callees under strict budgets (or explicitly mark as unsupported with a note)

### 0.36 Learning Pipelines Persistence
- Make pipeline definitions fully CRUD (enable/disable/update schedule/components) and persist updates to DB.
- Ensure schedule updates reschedule immediately (no restart required) and expose scheduler “unsupported schedule” details consistently.
- Add `/api/v1/pipelines` parity fields (`lastRunAt`, `nextRunAt`, `scheduleNote`) to match tools/list.
- Add scheduler metrics (runs triggered, drift, failures) and lightweight backoff for repeated failures.
- Guardrails: keep scheduled execution feature-gated (`PIPELINES_ENABLE=1`) and remain no-op on constrained test hosts unless enabled.

### 0.37 MCP Prompts - Polish
- Expand completable suggestions using cached symbol/file candidates (budgeted and cancellable)
- Add prompt for "confirm definition" using `workflow_locate_confirm_definition`

### 0.6 MCP/HTTP Workflows GA
- Prompts: register `workflow-explore-symbol` and `workflow-safe-rename` with Use/Avoid/Returns guidance
- Add completable() suggestions for common symbols and edges
- Docs: short "Tool-First Editing" reminder and examples in docs/WORKFLOWS.md

---

## 📋 Near-Term Goals (1-2 Months)

### StoragePort Abstraction for Ontology (L4)
**Goal**: Make storage pluggable before scale-out

- **PostgresAdapter**: relational schema, indexes, transactions, migrations
- **TripleStoreAdapter**: SPARQL, typed predicates, pagination
- **Acceptance**:
  - Parity on findConcept, related k-hop, import/export (add k-hop parity tests)
  - L4 p95 ≤ 10ms on 50k files with warm cache
  - Backpressure + retry on transient errors; adapter-level telemetry
- **DevX**: Document `layers.layer4.adapter`; update CLI init to include `adapter: sqlite`
- **Risks**: Network variance → caching + bounded queries; Contention → pooling + tuned isolation

### Observability & SLOs (All Layers)
- Emit per-layer budgets/latency; escalation decisions (L1→L2/L3)
- Dashboards for L3/L4/L5; alert on p95 breaches, error spikes

### Type Safety & CI Stability
- Keep `tsconfig.build.json` as core type-check target in CI; expand gradually
- Enable `strict` and gate new modules behind incremental include
- Stabilize perf tests with deterministic budgets in CI
- Pre-commit hooks: format, lint, typecheck, unit tests

### Test Runner Stabilization v2
- Tighten CI-like defaults: `BATCH_SIZE=6 TIMEOUT=90s BAIL=1 L2_MAX_PARSE_FILES=10 ESCALATION_POLICY=never`
- Heartbeat output during long batches (line every ~15s)
- Optional hard timeout per batch via `BATCH_HARD_TIMEOUT_SEC`
- Exclude `e2e` and `performance/benchmarks` by default; opt-in via `WITH_E2E=1` / `WITH_PERF=1`
- Balance slices using historical timings; isolate "hot files" into dedicated slow slice
- Parallel slices recipe (`test-slices-par`) with port offsets per slice
- Simplify `just start` to remove fragile inline pipelines
- Roll up HTTP tests to reuse one server per group (reduce start/stop overhead)
- Docs: add real-time output expectations, bail usage, typical env presets for local vs CI

### 0.29 Test Infra - Remaining Polish
- Pin ports per suite (e.g., 7050) and add readiness checks to remove flake
- Time-bound external calls; keep tests self-contained
- Silence missing `test/` folder warnings in slicer (redirect find errors to /dev/null)
- Document `HEARTBEAT_SEC` and `BATCH_HARD_TIMEOUT_SEC` in TESTING_STRATEGY.md

---

## 🔭 Long-Term Roadmap (3+ Months)

### 1. Production Deployment
**Requirements**: Docker/Kubernetes permissions

- **Container Registry**: Push images to GitHub Container Registry or Docker Hub
- **Kubernetes Deploy**: Execute deployment to production K8s cluster
- **DNS/TLS Setup**: Configure domain and SSL certificates
- **Monitoring**: Enable production monitoring and alerting
- **Load Testing**: Validate production performance under load

Proceed with staged rollout while storage adapters and type-safety improvements land.

### 2. Advanced Performance Optimization
- **Startup Time**: Reduce cold start latency (currently ~2s)
- **Large Codebase**: Further optimize for projects with 100K+ files
- **Concurrent Users**: Support 1000+ simultaneous connections (currently handles 100+)
- **Memory Usage**: Further optimize from current 607MB baseline
- **Cache Warming**: Implement intelligent pre-loading strategies

#### 2.1 Layer 1 + AST Tuning
- **Short-Seed Heuristics**: For identifiers < 6 chars, auto-boost Layer 2 budget (150–200ms)
- **Confidence Gating**: Early-return only when fast-path yields 'likely-definition'
- **Race Merge Policy**: Optional merge of content + file discovery results when both finish within budget
- **Env Overrides Doc**: Document quick-tune vars (`ESCALATION_L2_BUDGET_MS`, `ESCALATION_L1_CONFIDENCE_THRESHOLD`, etc.)

#### 2.2 Output and UX
- **Summary Mode**: Keep enhancing examples and consistency
- **Deterministic Limits**: Enforce print caps consistently across commands
- **Stable CLI Formatting**: Keep pretty, relative path formatting; adapters return arrays; `--json` stable
- **Tree View**: `--tree` default depth 3; ensure presentation-only

#### 2.3 Test Infrastructure Hygiene
- **Biome, not ESLint**: Remove stray ESLint directives; use Biome comments if needed
- **No stdout from LSP**: Keep LSP server logs on stderr (avoid stdio protocol contamination)
- **VS Code Integration Harness**: Guard client/server connection via `ONTOLOGY_TEST_WITH_SERVER=1`
- **Test paths & outputs**: Consolidate under `tests/`; write outputs to `.test-results/`
- **Reporter standardization**: Use Bun's `--reporter=junit` with `--reporter-outfile` for CI-friendly XML

#### 2.4 Smart Escalation v2
- **Policy**: Add `core.performance.escalation.policy` = `auto | always | never` (default: `auto`)
- **Gating Rules**: Trigger when Layer 1 empty/ambiguous (no likely-definition, low confidence, >N files without filename match)
- **Budgets & Caps**: Time budgets (L2: 50–100ms, L3: ≤50ms); scope caps (L2: ≤10 candidate files)
- **Async-First Integration**: Keep `findDefinitionAsync/findReferencesAsync` as primary
- **Determinism**: Make thresholds deterministic in CI; identical cache keys with/without escalation
- **Instrumentation**: Emit `escalation:decision` events with reasons, budgets, counts
- **Testing Plan**: Unit tests (gating logic, budgets), integration (ambiguous symbols), cross-adapter parity
- **Rollout**: Default `auto` with conservative thresholds; allow `never` in constrained envs

### 3. Complete Plugin System Implementation
- **Plugin Marketplace**: Build web UI and registry service
- **Example Plugins**: Create additional plugins beyond template
- **CLI Tools**: Build plugin development CLI
- **Testing**: Integration test plugin system with core
- **Documentation**: Create plugin developer guide

### 4. Advanced Features
- **AI Model Integration**: Connect to local LLMs for enhanced suggestions
- **Multi-Language Support**: Extend beyond TypeScript/JavaScript (Python, Go, Rust)
- **Incremental Analysis**: Implement file-watching with incremental updates
- **Distributed Architecture**: Enable multi-node deployment for large teams

### 5. Adapters Parity
- **LSP**: Expose `explore` as `executeCommand` with JSON payload
- **HTTP**: Add `/api/v1/explore` query parameters for print limits and filters
- **MCP**: Ensure `explore_codebase` supports limit parameters, returns compact JSON

### 6. Security Hardening
- **AuthN/Z**: Add token-based auth for HTTP endpoints; scope tokens per adapter
- **Secrets**: Move all credentials to `env` + GitHub Actions secrets; document rotation
- **Rate Limiting**: Per-IP and per-route quotas; 429 responses with Retry-After
- **Input Validation**: Harden schema validation on all adapters; reject unknown fields
- **Threat Model**: Document attack surface; add SSRF and path traversal guards

### 7. Cache & Data Layer
- **Valkey (Redis-compatible)**: Implement `ValkeyCache` in `CacheService` with reconnect/backoff
- **Hybrid Strategy**: Memory+Valkey tiered write-through; configurable TTL per keyspace
- **Degradation**: Wire `UseCachedResult` strategy in error handler for read paths
- **Warmers**: Add startup prewarm for hot identifiers
- **Cache Metrics**: Export hit/miss and eviction metrics to monitoring dashboard

### 8. Error Handling Alignment
- Document adapter error shapes + examples in docs

### 9. Test Suite Stabilization
- **Perf Benchmarks**: Tune Layer 1 budget/timeouts or mock FS for determinism
- **Budgets**: Lock performance budgets; guardrail on >20% regressions
- **Fixtures**: Add synthetic large-tree fixture for race tests
- **Cross-Protocol Consistency**: Monitor in CI; ensure MCP/LSP/HTTP/CLI parity
- **Enhanced Search Caps**: Enforce result cap in async aggregator
- **Layer 1 Timeouts**: Increase LS directory analysis timeout in perf suite or gate by env

#### 9.1 Temporary Stubs and Relaxed Assertions
- **LSP Custom Methods**: Implement proper handlers for `ontology/getStatistics` and `ontology/getConceptGraph`
- Restore stricter test assertions that verify real `result` payload structure

#### 9.2 Async-First Cascade
- Optionally delete unreachable legacy cascade blocks in `unified-analyzer.ts`
- Centralize async budgets under config (`layers.layer1.grep.defaultTimeout` + global cap)

#### 9.3 Ontology & Storage
- Keep SQLite default; continue running Layer 4 suites in CI
- Postgres/Triple adapters: maintain parity tests behind env flags
- Add smoke doc for local DB runs (no containers)

### 10. Release & CI/CD
- **Semantic Versioning**: Adopt conventional commits + automated release notes
- **Artifact Signing**: Sign Docker images and VSIX; publish provenance (SLSA Level 1)
- **Matrix CI**: Add OS matrix (Linux, macOS) with Bun versions
- **Security Gates**: Fail PRs on high severity vulns from `security.yml`

### 11. Docs & DX
- **CLI Help**: Expand `--help` with realistic examples; add `--json` samples; show `--precise`/`--ast-only` patterns
- **Playground**: Add small repo fixtures under `examples/` with guided tasks
- **Troubleshooting**: Extend `docs/TROUBLESHOOTING.md` with common adapter errors
- **OpenAPI**: Freeze and version HTTP schemas; publish under `/openapi.json`
- **Tools Preferences**: Document optional tooling prefs (`fd` file discovery; `eza -T` for tree)
- **VS Code Palette Labels**: Use "Symbol: Build Symbol Map" and "Refactor: Plan Rename (Preview)"
- **Layer Numbering**: Normalize all docs to use L1–L5 mapping (Planner = L3, Ontology = L4, Pattern Learning & Propagation = L5)
- **StoragePort**: Link to `docs/STORAGE_PORT.md`; show adapter config examples
- **Dogfooding How-To**: Add README section on `just dogfood`, `dogfood_full`, `snap_*` commands

### 12. Cleanup
- **Legacy Shims Removal**: Remove compatibility shims for `claude-tools` imports; consolidate to `layer1-fast-search`

### 14. Native LS Interop (Type-Aware Providers)
- Define provider interface for type-aware servers (initial: tsserver)
- Methods: prepareRename, rename, findDefinition, findReferences; cancellable + timeouts
- Add provider manager with detection + config toggles: `PROVIDERS_TS_ENABLE`, `PROVIDERS_TS_BUDGET_MS`
- Integrate into Layer 3 planner as optional refinement step under strict budgets
- Tests: ensure identical behavior when disabled; improved precision for complex TS rename when enabled
- Docs: README section on "Language Server Interop"; env variables; risks/mitigations

### Storage Adapters Plan

#### A. Postgres Adapter
- Schema: concepts, representations, relations, evolution
- FKs + composite indexes (canonical_name, (from_concept_id,to_concept_id,relation_type))
- Queries: name lookup, neighbors (k-hop via CTEs), stats
- Migrations: sqldiff + version table; rollback path
- Operational: pool size, timeouts, retries, metrics; VACUUM/ANALYZE

#### B. Triple Store Adapter
- Model: ex:Concept, ex:relatedTo (typed), ex:hasRepresentation, ex:hasSignature, ex:hasEvolution
- SPARQL: find by label/altLabel, typed relations, k-hops
- Operational: HTTP timeouts, paging, retry/backoff, provenance

#### C. Cutover & Sync
- One-time ETL from SQLite → target; validation checksums
- Optional dual-write period; dark read-through for confidence
- Feature flag to switch active backend per workspace

### Security & Multi-Tenancy
- Capability-based plugin sandbox; least privilege for file, network
- Workspace isolation for storage; per-tenant quotas & limits
- Audit events for admin operations; PII policy if applicable

### DX & API Surface
- Stabilize HTTP/LSP error shapes; add pagination and rate limits
- Consistent CLI/HTTP/LSP semantics for planner (L3), ontology (L4), learning (L5) operations

### AST & CLI Enhancements

#### A. AST References Coverage
- Broaden TS/JS queries: optional chaining calls (`obj?.method()`), nested member calls, namespaced imports, aliasing
- Destructured imports/bindings used as calls
- Emit identifier/property nodes for all above for precise AST validation

#### B. Confidence Scoring Refinement
- Expose scoring weights in config (`performance.scoring.{l1,astDef,astRef}`)
- Tests: assert relative ordering (AST > L1; exact > prefix; word-boundary > substring)
- Consider penalizing matches in comments/strings when parser context known

#### C. Kind Inference Improvements
- Prefer AST node kinds to distinguish `function` vs `property`
- Use L1 inference only as fallback when AST unavailable

#### D. Config + Budgets
- Persist `layer2.budgetMs` at 100–150ms in precise/ast-only modes
- Expose dedupe strategy: `preferAst | merge | astOnly`

#### E. CLI UX
- Document `--ast-only` and `ref` alias in README/CLI help with examples
- Add `--ast` synonym for discoverability

#### F. Optional: WASM Fallback Path
- If native bindings unreliable, add `web-tree-sitter` fallback behind `preferWasm` flag

#### G. Optional: Node Run Target
- Provide `just cli-node ...` to run CLI with Node for environments preferring Node's native module path

#### H. Telemetry
- Emit counters for escalation rate, dedupe kept/dropped, average confidence per mode
- Add debug toggle for dedupe decisions

### Hybrid Code Brain Features

#### 0.5 SCIP/LSIF Integration (Optional)
- CI: add steps to run `scip-typescript` and `scip-python` on hot packages; cache artifacts
- Query: lightweight reader to consult SCIP for defs/refs when fresh; mark stale and fall back
- Budgets: cap per-package index time; provide `--packages` include list for large repos

#### 0.7 File Watcher Strategy
- Default: Node watcher via `chokidar` (fs.watch + fsevents) with debounce/coalesce; gitignore-aware
- Optional: Watchman bridge when available (better scale/monorepos)
- Abstract WatchPort: implementations for `chokidar` and `watchman`
- Config driven selection; health/metrics per backend; automatic fallback
- Overlay precedence: open buffers (from MCP/LSP) override FS events

#### 0.8 Web UI & Live Monitoring
- Add controls to run ast-query and graph-expand from UI; render results
- Extend UI to filter by session/tool and pause/resume stream
- Add inputs for maxKeep/maxAgeDays; show materialized snapshot directories
- Docs: link `/ui` in README; add basic troubleshooting for dashboards

#### 0.9 Precise Callers/Callees
- Integrate SCIP callers/callees where available
- For non-SCIP repos: lightweight project graph seeded from declarations/import graph
- Validate against goldens; switch to SCIP by default when fresh; keep grep+AST as fallback

#### 0.10 Dev Ergonomics
- Ensure default SQLite paths documented; Postgres remains opt-in
- Add "Getting Started" block to README: `just build`, `just start`, `/ui` links
- Provide Codex CLI setup snippet for MCP stdio in `~/.codex/config.toml`

### 2.2 Ontology Prime + Triple Graph
**Goal**: Implement ADR-0001 (PrimeEngine and triple-graph-compatible storage)

**Reference**: docs/adr/0001-prime-ontology-triple-graph.md

**Tooling (Core & Adapters)**:
- [ ] Add `prime_ontology` to ToolRegistry with schema & defaults (MCP stdio/HTTP, HTTP, CLI)
- [ ] MCP stdio/HTTP handlers: stream progress and return summary JSON; enforce budgets
- [ ] HTTP: `POST /api/v1/ontology/prime` endpoint; CLI alias `semantic-code-intelligence ontology prime`

**PrimeEngine (Layered, budgeted)**:
- [ ] Scaffold `src/ontology/prime/engine.ts` (batching, layer timings, dryRun support)
- [ ] Built-in strategies (L4): `symbols_only`, `scan_neighbors`, `project_sample`
- [ ] Categories: seeding/inference/consolidation/validation/import/export
- [ ] Respect ignore rules; chunk by N files; attribute time to L1/L2/L3/L4; skip L5 by default

**Triple Graph Mapping (StoragePort)**:
- [ ] Extend TripleStoreStorageAdapter with explicit SPO mapping for Concept/Representation/Relation
- [ ] Add import/export strategies (`ontology_export_snapshot`, `ontology_import_jsonl`)
- [ ] Keep StoragePort contracts stable; no leakage to higher layers

**Plugin System (L4/L5 + Model Providers)**:
- [ ] Plugin API: `registerOntologyStrategy`, `registerPatternStrategy`, `registerModelProvider`
- [ ] Security: default no-network; network only via ModelProviders using MCP bridges; enforce budgets
- [ ] Ship two example plugins (one L4 inference strategy; one L5 learning strategy) with docs

**Telemetry (OpenTelemetry → SQL JSONB)**:
- [ ] Add spans: `code.analyzer.prime`, `prime.batch`, `l1.search`, `l2.parse`, `l3.symbol_map`, `l4.persist`, `plugin.run`, `model.invoke`
- [ ] Attributes: layer, strategy_name, strategy_category, item_count, budget_ms, depth, max_items, plugin_name, provider_name, storage_adapter
- [ ] Provide local collector config writing to SQL jsonb; add DDL and views; surface aggregates in `/monitoring`

**Docs**:
- [ ] Link ADR-0001 from README/NEXT_STEPS
- [ ] Authoring guide for strategy/plugin creators (categories, examples, budgets, telemetry)
- [ ] Extend CI docs with sliced matrix, coverage job, gating variables

---

## 📊 Technical Debt to Address

### Testing Improvements
- **VS Code Extension Tests**: Add test environment support (missing vscode package)
- **E2E Real Codebase Tests**: Expand beyond current 6 scenarios
- **Performance Regression Suite**: Automated performance tracking
- **Chaos Engineering**: Add resilience testing (network failures, high load)
- **Layer 1 Race/Cancellation**: Add deterministic tests with synthetic large tree fixture
- **Budget Enforcement**: Assert end-to-end that LayerManager cutoffs respected under load

### Code Quality
- **JSDoc Documentation**: Add comprehensive inline documentation
- **TypeScript Strictness**: Enable all strict checks
- **Pre-commit Hooks**: Implement quality gates (lint, format, test)
- **Code Review Automation**: Set up danger.js or similar

### Infrastructure
- **Production Monitoring**: Deploy Grafana dashboards
- **Log Aggregation**: Implement ELK stack for centralized logging
- **Distributed Tracing**: Complete OpenTelemetry integration
- **Backup Strategies**: Automate database and configuration backups

---

## 🧭 Where to Start in a New Context

- Read PROJECT_STATUS.md (top sections) to see current state
- Review `test-output.txt` for latest full-suite logs
- Validate the suite (fast default):
  - `just test`
  - Single slice: `just test-sliced <N> <K>`
  - Stop-at-first-failure: `bun test --bail=1`
- Verify Layer 1/CLI:
  - `timeout 20s ./semantic-code-intelligence find <Symbol> -n 50 -l 20 --json`
  - `timeout 20s ./semantic-code-intelligence references <Symbol> -n 50 -l 20 --json`
  - `timeout 20s ./semantic-code-intelligence explore <Symbol> -n 100 -l 10 --json`
  - `timeout 20s ./semantic-code-intelligence symbol-map <Symbol> --max-files 10 --json`
  - `timeout 20s ./semantic-code-intelligence plan-rename <Old> <New> --json`

---

## 🔧 Useful Commands

### Testing
- Local tests (fast): `just test` (sliced + batched)
- Single slice: `just test-sliced <N> <K>`; all slices: `just test-slices <N>`
- Stop at first failure: `bun test --bail=1`
- Focus layer1/error tests: `bun test test/layer1-*.test.ts test/error-handling.test.ts`
- Generate JUnit report: `bun test --reporter=junit --reporter-outfile=report.xml`

### Development
- Build CLI: `bun run build:cli`
- Learning stats (HTTP): `just learning-stats`
- Start/stop test HTTP for E2E: `just start-test-http` / `just stop-test-http`
- Run E2E locally: `just e2e-local`

---

## 📈 Success Metrics to Track

### Performance KPIs
- **Response Time**: <100ms for 95% of requests
- **Cache Hit Rate**: >90% after warm-up
- **Memory Usage**: <1GB for typical workloads
- **Startup Time**: <1s target

### Adoption Metrics
- **Active Users**: Track daily/weekly/monthly active users
- **Pattern Learning Rate**: Patterns learned per day
- **Error Rate**: <0.1% (track via monitoring API)
- **User Satisfaction**: Feedback score >4.5/5

---

## 🔗 Resources

- **Documentation**: `docs/TROUBLESHOOTING.md` for issue resolution
- **Monitoring**: `http://localhost:8081` for dashboard
- **Commands**: `just --list` for all available commands
- **Diagnostics**: `just diagnostics` for system health
- **Support**: GitHub Issues for bug reports
