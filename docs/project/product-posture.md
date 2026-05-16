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
