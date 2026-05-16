---
summary: "Product posture and phased user strategy for Semantic Code Intelligence."
read_when:
  - "You need to decide what Semantic Code Intelligence should optimize for next."
  - "You are changing product scope, roadmap, README claims, or alpha-MVP behavior."
type: "reference"
---

# Product posture

## Position

Semantic Code Intelligence is a phased product, library, and internal substrate. It should serve all three over time, but not all at once.

The first user is the **harnessed LLM coding session**: an LLM operating inside a tool/runtime harness such as Pi, Claude Code, Cursor, or another coding workbench.

Human IDE users, CI/review automation, dashboards, marketplace-style pattern assets, and production deployments are later phases unless they directly support the first user.

## First-user thesis

Harnessed LLM coding sessions need a reliable code-navigation and edit-planning substrate more than they need another general search tool.

The product should make a repository feel:

- **bounded**: every answer is tied to a snapshot or explicit workspace state;
- **navigable**: symbols, references, definitions, files, and structural context are easy to retrieve;
- **safe to change**: mutations are proposed as reviewable patches and checked before application;
- **explainable**: results include enough evidence for the harnessed LLM and human operator to trust or reject them;
- **portable**: behavior is exposed through MCP/HTTP/CLI contracts rather than private editor state.

## Phase 1: Harnessed LLM coding session substrate

Primary interfaces:

1. MCP HTTP / stdio tools
2. HTTP API for deterministic tool calls and tests
3. CLI for local verification and fallback

Alpha-supported operations are specified in `docs/project/alpha-mvp-contract.md`:

- `get_snapshot`
- `read_file`
- `text_search`
- `symbol_search`
- `ast_query`
- `find_definition`
- `find_references`
- `graph_expand`
- `propose_patch`
- `run_checks`

Success means a harnessed LLM coding session can solve routine code-navigation and patch-planning tasks with less raw shell probing, fewer stale assumptions, and clearer validation evidence.

### Current alpha evidence

Phase 1 has moved from posture to a repeatable Alpha MVP validation bundle. The current bundle proves:

- the documented Alpha MVP tool surface is registered and discoverable;
- HTTP `/api/v1/tools/call` executes bounded file reading, navigation, and preview-first patch checks;
- direct `MCPAdapter` coverage exercises the same core behavior without relying only on HTTP;
- MCP HTTP JSON-RPC can list tools and call navigation plus patch-planning operations;
- MCP stdio can initialize, advertise tools, execute representative read/navigation/patch-check calls, and keep stdout protocol-clean;
- CLI fallback can execute machine-readable workflow calls for local verification;
- ast-grep-backed structural search and preview-first structural patch checks are exposed through the same SCI workflow surface;
- self-hosted CLI dogfood uses SCI's own CLI workflow surface against this repo for navigation and preview-first patch planning;
- dogfood evidence is emitted as JSON and verifies that preview-first patch planning does not mutate the working tree;
- target-repo CLI usage is now framed as an installed/global command invoked from the repository being inspected, not as SCI knowing target repo paths;
- migration hygiene continues to reject pre-rename identity drift, machine-local path coupling, and unsafe local artifacts.

The current one-command validation paths are:

```bash
bun run alpha:mvp:check
just alpha-mvp-check
```

This is credible Alpha MVP evidence for the first-user substrate. It is not yet production readiness.

### Remaining Phase 1 gaps

Before treating Phase 1 as broadly proven, keep pressure on:

- proving the installed/global CLI path from at least one target repo cwd without baking that target into SCI;
- richer semantic graph behavior beyond stable fallback shapes;
- evidence comparison across runs so regressions are easier to spot;
- clearer performance budgets for harnessed-LLM interactive use;
- durable snapshot/session semantics where process-local CLI or adapter state is insufficient;
- operator-readable explanation of when to use HTTP, MCP HTTP, MCP stdio, direct adapter tests, or CLI fallback.

## Phase 2: Developer workbench

Human-facing IDE and dashboard experiences become primary only after Phase 1 proves the substrate.

Candidate surfaces:

- VS Code extension backed by the same core contracts;
- dashboard for graph/search/check evidence;
- CLI workflows for humans who prefer terminal-first navigation;
- local project setup helpers.

## Phase 3: CI and review automation

CI/review workflows should consume the same snapshot and patch-check primitives rather than inventing separate analysis logic.

Candidate surfaces:

- pull-request code-intelligence reports;
- rename/refactor safety summaries;
- check evidence bundles;
- drift detection for generated semantic indexes.

## Phase 4: Productization and deployment

Production deployments, marketplace/pattern economy, analytics, and AI-training claims are not alpha commitments. Keep them as roadmap material until Phase 1 and Phase 2 have evidence.

Promotion criteria before treating these as supported:

- stable contracts;
- repeatable install and startup;
- dogfood evidence on at least one nontrivial repo;
- documented rollback and data-retention posture;
- clear owner boundaries for task/evidence/governance state.

## Non-goals for alpha

- No compatibility preservation for pre-rename product identity.
- No marketplace, AI-training, or analytics product claims as supported features.
- No Kubernetes or production deployment as the default path.
- No autonomous direct writes as a primary workflow.
- No hidden policy authority from learned patterns.

## Alpha MVP decision rule

If a change does not improve harnessed-LLM navigation, patch planning, validation evidence, or contract reliability, it is probably not Phase 1 work.

Defer it unless it removes immediate risk from the Phase 1 path.
