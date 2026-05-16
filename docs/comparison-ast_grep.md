# Ontology‑LSP vs. ast-grep

This document provides a practical, engineering-focused comparison between Ontology‑LSP and ast‑grep to help you choose the right tool for a given job and understand where they can complement each other.

## Summary

- Use Ontology‑LSP when you need multi-layer code intelligence (find definition/references, symbol‑aware rename planning, knowledge graph, pattern learning) exposed over LSP/MCP/HTTP/CLI with observability and persistence.
- Use ast‑grep when you want fast, explicit, rule‑driven structural search and codemods using tree‑sitter patterns and YAML rules (CLI and editor integrations), typically in one‑off or repeatable refactors without project‑wide semantic modeling.

## Side‑by‑Side Overview

| Dimension | Ontology‑LSP | ast‑grep |
| --- | --- | --- |
| Primary Goal | Unified, protocol‑agnostic code intelligence with planning and knowledge graph | Grep‑like AST structural search and rewrite (codemods) |
| Core Engine | 5‑layer pipeline: Fast Search → AST → Planner → Ontology (semantic graph) → Pattern Learning & Propagation | Tree‑sitter AST engine + rule matcher (metavariables, constraints) |
| Interfaces | LSP, MCP, HTTP, CLI | CLI (`sg`), editor/extension integration |
| Persistence | Ontology DB (configurable path), caches, metrics | No DB by default; YAML/TOML rule files and inline CLI patterns |
| Cross‑File Semantics | Yes (symbol map, references, rename planning across files; ontology links) | Matches run per file; no project‑wide symbol graph (rules can scan many files but without cross‑file linkage) |
| Refactoring | Workspace edits with preview/plan/dry‑run; rename planner; adapter‑safe | Structured fixes via patterns with placeholders and transforms |
| Learning | Pattern learning from developer actions with confidence scores | No built‑in learning (rules are authored/curated) |
| Observability | Metrics per layer, SLOs, stats endpoints | Minimal (CLI output; some tooling integration) |
| Config & Safety | Feature flags/env (see CONFIG.md), pluggable storage, stdio‑clean adapters | Config via rule files; no background server required |
| Typical Fit | IDE navigation + safe refactors + org knowledge | Targeted codemods + structural linting/guardrails |

Notes:
- Both rely on tree‑sitter for AST parsing. Ontology‑LSP layers AST with planning and graph modeling; ast‑grep focuses on fast matching and rewriting.
- ast‑grep has an excellent rule language and CLI UX for authoring and applying codemods; Ontology‑LSP optimizes for protocol‑served intelligence and collaboration.

## Analysis Model

- Ontology‑LSP
  - Multi‑layer pipeline with budgets and escalation: Layer 1 (Fast Search), Layer 2 (AST), Layer 3 (Planner: symbol map + rename planning), Layer 4 (Ontology: semantic graph, storage adapters), Layer 5 (Pattern Learning & Propagation).
  - Produces a symbol‑aware plan with provenance, then validates and returns edits or navigation results, exposing identical capabilities via LSP/MCP/HTTP/CLI.
  - Persists knowledge and metrics; supports cache invalidation and cross‑request learning.

- ast‑grep
  - Single‑tool model centered on AST pattern matching with metavariables (e.g., `$X`, `$Y`), constraints (kind/inside/has/not), and structured rewrites (`fix`, transforms).
  - Excellent for precise, explicit matches and repeatable codemods; no built‑in global symbol reasoning or ontology storage.

## Query & Rule Authoring

- Ontology‑LSP
  - Provides operations like find definition, references, plan/apply rename, symbol map, completions, diagnostics, and ontology/pattern endpoints. It doesn’t expose a user‑facing pattern DSL by default; learning and propagation are driven by observed actions and internal models.
  - Ideal when you want protocol‑level features (LSP/MCP), cross‑file semantics, and stored knowledge rather than authoring per‑rule codemods.

- ast‑grep
  - YAML/TOML rule files and CLI one‑liners enable concise structural queries and transforms. You can lint for patterns, offer quick‑fixes, and run codemods project‑wide.
  - Great rule ergonomics: compose constraints, test rules locally, and share them with teams; strong fit for policy checks and migrations.

## Refactoring Workflows

- Ontology‑LSP
  - Symbol‑aware rename planner builds a WorkspaceEdit with preview and dry‑run, budgeting AST/provider calls (when enabled) and validating ranges before edits. Cross‑file references are captured via symbol maps and ontology links.
  - Best for safe, interactive refactors surfaced through IDEs (LSP) or via APIs (HTTP/MCP) with metrics and auditability.

- ast‑grep
  - Codemods defined by patterns and `fix` templates apply structured, repeatable edits. It’s deterministic and fast, ideal for large‑scale mechanical changes (APIs, naming, call shapes) where rule authorship is clear.
  - Lacks type‑oriented rename semantics; relies on syntax + constraints to bound changes.

## Cross‑File & Knowledge Graph

- Ontology‑LSP maintains a semantic graph (Layer 4) with pluggable storage adapters (e.g., SQLite/Postgres per project config) to connect declarations, references, and concepts across files. Pattern learning (Layer 5) attributes and propagates patterns, enabling team‑wide knowledge reuse.
- ast‑grep processes files independently. You can scan many files, but relationships across files are not modeled as first‑class graph edges.

## Interfaces & Integration

- Ontology‑LSP
  - LSP: editor integrations for navigation, rename, diagnostics, custom methods (symbol map, plan‑rename, stats).
  - MCP: tools for definition/references/rename/symbol‑map/etc. with streaming HTTP or stdio.
  - HTTP: REST endpoints for CI/CD and dashboards (e.g., `/api/v1/plan-rename`, `/api/v1/symbol-map`).
  - CLI: convenience commands mirroring core capabilities.

- ast‑grep
  - CLI‑first (`sg scan`, `sg fix`, etc.) with a strong VS Code extension and playground to author rules.
  - Seamless inclusion in scripts/CI for policy checks and migrations.

## Observability & SLOs

- Ontology‑LSP exposes per‑layer metrics (p95/p99, error rate, budgets), health checks, and stats endpoints; designed to keep stdio clean for protocol servers. Useful for production and team visibility.
- ast‑grep outputs matches and application reports via CLI and editor UIs; no long‑running server metrics by default.

## Performance Considerations

- Both tools are fast and leverage tree‑sitter. Ontology‑LSP adds orchestration and persistence to deliver higher‑level semantics while meeting tight budgets (e.g., sub‑100ms p95 for common IDE requests in validated setups). ast‑grep excels at raw structural search/replace throughput and scales linearly across files.

## Typical Use Cases

- Pick Ontology‑LSP when you need:
  - IDE navigation (definitions/references) with semantic disambiguation.
  - Rename planning with cross‑file safety and preview.
  - Team knowledge capture, learned patterns, and ontology export.
  - Protocol diversity (LSP, MCP, HTTP) and dashboards/metrics.

- Pick ast‑grep when you need:
  - Authorable, reviewable codemods for syntax‑level migrations.
  - Structural lint rules and quick fixes enforceable in CI.
  - One‑off or repeatable edits that don’t require global symbol analysis.

## Interoperability Patterns

The tools complement each other well:

1) Gate Codemods via Ontology‑LSP Preview
   - Run `sg scan`/`sg fix` to propose edits in a branch.
   - Use Ontology‑LSP’s symbol map and plan‑rename to verify coverage and detect risky edges (e.g., imports/exports, external references) before landing changes.

2) Discover Patterns with Ontology‑LSP, Codify with ast‑grep
   - Let Ontology‑LSP learn/attribute a recurring refactor.
   - Translate it into an ast‑grep rule for codemods in repos lacking Ontology‑LSP deployment.

3) CI Guardrails
   - ast‑grep rules enforce style and API usage.
   - Ontology‑LSP checks higher‑order issues (cross‑file rename safety, ontology consistency) and publishes metrics.

## Example Artifacts

### ast‑grep rule (illustrative)

```yaml
id: replace-deprecated-call
language: typescript
rule:
  pattern: oldApi($ARG)
message: "Use newApi(arg) instead of oldApi(arg)"
severity: warning
fix: newApi($ARG)
```

Run:

```bash
sg scan -r rules/replace-deprecated-call.yml
sg fix  -r rules/replace-deprecated-call.yml
```

### Ontology‑LSP plan‑rename request (HTTP)

```json
{
  "identifier": "oldApi",
  "newName": "newApi",
  "file": "file:///repo/root"
}
```

Endpoint: `POST /api/v1/plan-rename` (preview‑only)

## Risks & Limitations

- Ontology‑LSP
  - Heavier runtime model (servers, storage) and broader operational footprint; requires configuration and budgets per layer. Best used where protocol integration and team‑level observability matter.

- ast‑grep
  - No project‑wide semantic graph; correctness depends on rule scoping/constraints. For renames that require type or symbol disambiguation, pair with language servers or Ontology‑LSP planning.

## Decision Guide

- Need LSP/MCP/HTTP APIs, metrics, persistence, and cross‑file symbol safety? Choose Ontology‑LSP.
- Need quick, explicit, reviewable codemods with simple deployment and no server? Choose ast‑grep.
- Need both? Use Ontology‑LSP for planning/validation/metrics and ast‑grep for rule‑driven transformations.

## References

- ast‑grep project site and docs: https://ast-grep.github.io/
- Ontology‑LSP architecture, layers, and adapters: see README.md, ADAPTER_ARCHITECTURE.md, API_SPECIFICATION.md, CONFIG.md, and docs/.
