# ADR-0001: Prime Ontology Engine and Triple Graph Storage

Status: Proposed
Date: 2025-09-04
Authors: Ontology-LSP Team

## Context

We want a repeatable, budgeted way to enrich Layer 4 (Ontology / Semantic Graph) with high-signal facts extracted from the codebase, and we want the data model to be compatible with triple-based stores (subject–predicate–object) without coupling higher layers to any single storage.

We also want L4/L5 to be pluggable in line with the Vision’s ecosystem pillars:
- Plugins: code extensions (strategies) for L4 (seeding/inference) and L5 (learning/propagation)
- Marketplace: knowledge assets (patterns/strategies) people can share
- AI Training: model providers via MCP bridges
- Analytics: rich telemetry and metrics across layers

## Decision

1) Introduce a PrimeEngine (prime_ontology tool) that seeds L4 with bounded runs using L1/L2/L3 facts, under strict budgets and with per-layer metrics.
2) Adopt a triple-compatible schema for L4 storage through StoragePort’s triple adapter. The triple adapter maps the Layer 4 semantic model (Thing ↔ Concept ↔ Symbol) to SPO triples without leaking storage specifics to higher layers.
3) Make L4/L5 strategies pluginable with a small, stable API. Model providers are bridged via MCP to keep networked inference optional and controlled.
4) Expose prime_ontology across all adapters (MCP stdio, MCP HTTP, HTTP, CLI) with a single ToolRegistry definition.
5) Add OpenTelemetry spans/metrics. For now, export to SQL as jsonb via the collector for easy dashboards and investigations.

## Triple Schema (StoragePort Triple Adapter)

We keep the in-memory concept graph for performance but define a canonical SPO mapping when using the triple-backed adapter:

- Subjects: `concept:{id}`, `thing:{id}`, `symbol:{id}`
- Predicates:
  - `hasCanonicalName` → object: string literal
  - `relatesTo` → object: `concept:{targetId}` with `relationType` in edge metadata (or as reified triple)
  - `hasSignature` → object: JSON string or normalized signature node
  - `hasConfidence` → object: numeric literal
  - `evolvedTo` → object: `evolution:{conceptId}:{timestamp}` (reified evolution entry)
- Symbol Node (`symbol:*`):
  - `symbolText` → string literal
  - `symbolLanguage` → string literal (optional)
  - `hasConfidence` → numeric literal
- Thing Node (`thing:*`) (anchors / referents in code):
  - `thingKind` → string literal (e.g. function/class/type)
  - `atLocation` → string literal (URI or file:// URI)
  - `hasConfidence` → numeric literal
  - `occurrences` → numeric literal
- Links (reified when attributes are needed):
  - `conceptAnchoredBy` → `thing:{thingId}` (Thing ↔ Concept; includes confidence/evidence)
  - `thingDenotedBy` → `symbol:{symbolId}` (Thing ↔ Symbol; includes role: declaration/reference/usage)

Notes:
- This keeps StoragePort as the abstraction. Higher layers only use Concept/Relation operations; they never see triples.
- The triple adapter can be backed by an embedded lib or a remote triple store; both should respect budgets.
- Initial implementation can persist triples in SQLite (json or side tables) and provide a memory mirror for speed.

## PrimeEngine

Tool name: `prime_ontology` (verb_noun, consistent with existing tools)

Inputs:
- `symbols?`: string[]
- `files?`: string[]
- `strategy?`: `symbols_only` | `scan_neighbors` | `project_sample` (default `scan_neighbors`)
- `depth?`: number (default 1)
- `maxItems?`: number (default 200, hard cap)
- `timeoutMs?`: number (default 10000) 
- `dryRun?`: boolean (default false)
- `verbose?`: boolean (default false)

Outputs:
- `{ ok, seeded: { conceptsCreated, conceptsUpdated, relationsAdded }, coverage: { symbolsSeen, filesTouched }, timing: { layer1, layer2, layer3, layer4, total }, notes: string[] }`

Execution:
- L1: resolve seeds → candidate files (ignore rules, caps)
- L2: extract declarations/imports/exports/calls for candidates
- L3 (optional): reuse `buildSymbolMap` for target symbols
- L4: upsert concepts/symbols/things/links/relations via StoragePort (triple adapter when configured)
- L5: disabled by default for prime; can be enabled to record rename exemplars only
- Budgets: chunking (e.g., 25 files), wall clock cutoff, per-layer time accounting

## Plugin System (L4/L5)

Strategy interfaces:

```ts
interface OntologyPrimeStrategy {
  name: string
  category: 'seeding' | 'inference' | 'consolidation' | 'validation' | 'import' | 'export'
  describe(): { summary: string; inputs: string[] }
  run(input: PrimeInput, ctx: PrimeContext, storage: StoragePort): AsyncGenerator<PrimeResult>
}

interface PatternStrategy {
  name: string
  category: 'learning' | 'propagation' | 'ranking'
  describe(): { summary: string; inputs: string[] }
  run(input: PatternInput, ctx: PatternContext, learner: PatternLearner): AsyncGenerator<PatternResult>
}

interface ModelProvider {
  name: string
  task: 'embedding' | 'rerank' | 'classify' | 'explain'
  invoke(args: Record<string, any>, ctx: { budgetMs: number }): AsyncGenerator<{ token?: string; value?: any }>
}
```

Registration via PluginManager:
- `registerOntologyStrategy(strategy)`
- `registerPatternStrategy(strategy)`
- `registerModelProvider(provider)`

Security:
- No network by default. Network only via approved ModelProviders that use MCP bridges.
- Storage limited to StoragePort and cache; no arbitrary FS writes unless permissioned.

## Adapters

- ToolRegistry: define `prime_ontology` once; visible to MCP stdio, MCP HTTP, HTTP, CLI; optional LSP command.
- MCP stdio + HTTP: handlers call PrimeEngine; return streamable progress and final summary.
- HTTP: `POST /api/v1/ontology/prime` returns the same summary; bounded synchronous run.
- CLI: `ontology-lsp ontology prime ...` convenience wrapper.

## OpenTelemetry

Spans:
- `code.analyzer.prime` (root)
- `prime.batch`, `l1.search`, `l2.parse`, `l3.symbol_map`, `l4.persist`, `plugin.run`, `model.invoke`

Attributes:
- `layer`, `strategy_name`, `strategy_category`, `item_count`, `budget_ms`, `depth`, `max_items`, `plugin_name`, `provider_name`, `storage_adapter`

Export:
- OTLP to collector; collector writes to SQL (jsonb). Tables: `traces`, `metrics`, plus materialized views
- Until we deploy the full stack, provide a local collector config and a SQL DDL sketch

## Alternatives Considered

1) Property Graph only (no triples)
- Pros: simpler mapping for devs
- Cons: reduces interoperability with triple stores and RDF tools

2) Direct RDF layer in core types
- Pros: fewer adapters
- Cons: leaks storage specifics; contradicts StoragePort abstraction

3) Offline-only prime (no adapters)
- Pros: simpler rollout
- Cons: contradicts MCP-first dogfooding; less usable

## Consequences

Positive:
- Pluggable intelligence at L4/L5 with clean APIs; dry-run friendly seeding; reproducible runs under budgets
- Triple-friendly serialization for data portability and analytics
- Uniform tooling across MCP stdio/HTTP, HTTP, CLI

Trade-offs:
- Additional code paths (PrimeEngine + strategies) to maintain
- Telemetry pipeline (OTel → SQL) adds infra work

## Rollout Plan

Phase 1 (scaffold): ToolRegistry entry, PrimeEngine skeleton, built-in strategies (symbols_only, scan_neighbors), MCP/HTTP/CLI handlers behind `layers.layer4.prime.enabled`.

Phase 2 (triple mapping): Extend TripleStoreStorageAdapter to persist and query SPO triples; add import/export strategies.

Phase 3 (plugins): Expose PluginManager registrations for L4/L5 strategies and ModelProviders; ship two examples.

Phase 4 (telemetry): Wire OTel spans; provide collector config and SQL JSONB sink with views.
