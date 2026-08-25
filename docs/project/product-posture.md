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

## Operating model

SCI does not require a fixed Vision → Strategy → roadmap → task document ladder.
Current authority and context are layered deliberately:

1. [`VISION.md`](../../VISION.md) is the durable north star; [`vision.md`](vision.md) is its project-local pointer.
2. This file defines phased product posture and scope boundaries.
3. Installed Agent Kernel (`ak`) is canonical for live strategic frames, tasks, decisions, evidence, and lineage. The current frame key is `SF2` (display ID `AK.V5.SF02`) — Alpha maintenance and evidence-led direction discovery. The active implementation wave is `IW77` (display ID `AK.V5.SF02.WW77`) — first-user adoption and friction proof. IW77 prospectively samples real owner-authorized tasks to measure composite-first procedure effectiveness, total discovery cost, validated task advancement, and evidence-backed friction without activating broad Phase 2 or publication scope; its measurement contract is [`first-user-adoption-friction-proof.md`](first-user-adoption-friction-proof.md).
4. Repository ADRs record accepted human-readable policy. They do not create or advance AK decision state.
5. Implementation proceeds through an explicitly scoped AK task, owner-repo mutation, the smallest truthful validation, evidence, and closeout.
6. A fresh decision membrane is required when work changes authority, compatibility, ownership, persistence, mutation capability, publication posture, or broad product direction.

Planning and review documents support this process but are not parallel runtime authority. Superseded decisions `46` and `47` remain superseded.

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

1. Native Pi composite tools, exposed by the separately versioned private `pi-semantic-code-intelligence` companion (five doors; `safe_write` stays on MCP/CLI)
2. MCP HTTP / stdio tools
3. HTTP API for deterministic tool calls and tests
4. CLI for local verification and fallback

Alpha-supported operations are specified in `docs/project/alpha-mvp-contract.md`:

- `get_snapshot`
- `read_file`
- `text_search`
- `symbol_search`
- `ast_query`
- `find_definition`
- `find_references`
- `graph_expand`
- `recommend_checks`
- `propose_patch`
- `apply_snapshot`
- `patch_checks_in_snapshot`
- `extract_snapshot_artifacts`
- `run_checks`
- `structural_search`
- `structural_patch_checks`
- `safe_write`
- `explore_symbol_impact`
- `locate_confirm_definition`
- `rename_safely`

Success means a harnessed LLM coding session can solve routine code-navigation and patch-planning tasks with less raw shell probing, fewer stale assumptions, and clearer validation evidence.

### Current alpha evidence

Phase 1 is closed as an Alpha MVP substrate. This section defines what the evidence bundle must keep proving; it is not a log of past runs. The Alpha claim requires:

- the documented Alpha MVP tool surface stays registered and discoverable through every supported interface;
- cross-interface parity holds for the same core behavior, including ast-grep-backed structural workflows when ast-grep is available;
- preview-first mutation posture holds: patch and structural workflows stage snapshots and run checks without mutating the working tree unless an explicit guarded apply is authorized;
- progress is emitted as bounded JSON evidence that downstream consumers and the evidence-review handoff can validate;
- installed/global CLI usage stays target-repo-relative and free of machine-local paths;
- migration hygiene keeps rejecting pre-rename identity drift, machine-local path coupling, and unsafe local artifacts.

Canonical evidence lives with its owners and is not duplicated here:

- bundle gates and what each must prove: [`alpha-mvp-validation.md`](alpha-mvp-validation.md);
- closure boundary and preserved gaps: [`phase-1-closure-review.md`](phase-1-closure-review.md);
- per-run receipts and task lineage: the AK evidence ledger;
- interface selection: [`interface-choice-guide.md`](interface-choice-guide.md).

The one-command validation paths are:

```bash
bun run alpha:mvp:check
just alpha-mvp-check
```

This is credible Alpha MVP evidence for the first-user substrate. It is not production readiness.

### Phase 1 closure posture

Phase 1 is closed as an Alpha MVP substrate after IW50. The closure boundary is `docs/project/phase-1-closure-review.md`.

Do not keep adding Phase 1 dogfood waves by default. Future work should be one of:

- Alpha maintenance or regression fixes when the evidence bundle fails;
- targeted hardening tied to a named closure-review gap and the AK-backed backlog in `docs/project/alpha-maintenance-backlog.md`;
- an explicit Phase 2 decision review for human workbench/IDE/dashboard scope.

The bounded evidence-review slice is the only delivered Phase 2 vertical: SCI normalizes strict `semantic-code-intelligence.evidence_review.v1`, and the owning Pi repository validates and inertly renders it through `pi-evidence-review`. [ADR-0003](../adr/0003-authorize-bounded-evidence-review-consumer-handoff.md) records that narrow authorization. It does not activate a broad IDE/dashboard phase; superseded decision records stay superseded in AK.

### Local single-user production candidate

[ADR-0004](../adr/0004-local-single-user-production-candidate.md) authorizes one bounded productization slice: a versioned local runtime tarball, installed and dogfooded through CLI and MCP stdio by one trusted operator on one trusted repository. The executable contract is `docs/project/local-single-user-production-readiness.md` and the acceptance command is `bun run production:candidate:check`.

This candidate does not promote HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, public package distribution, hosted operation, untrusted code, or multi-tenancy to production support. The Alpha evidence bundle remains Alpha evidence; only the separate packaged-artifact gate supports the narrower local candidate claim.

Remaining non-blocking gaps after closure:

- richer semantic graph behavior beyond characterized fallback shapes and best-effort caller context;
- durable evidence history beyond current-run stable-field and lightweight elapsed-time comparison;
- production-grade p95/p99 performance evidence beyond the operator-facing latency bands and generated-evidence baseline in `docs/project/interactive-slo-guidance.md`;
- durable snapshot/session semantics where process-local CLI or adapter state is insufficient;
- validating interface guidance (`docs/project/interface-choice-guide.md`) in future target sessions when a concrete operator need appears.

## Phase 2: Operator workbench evidence

The first bounded Phase 2 slice is delivered: an operator supervising a harnessed LLM coding session can inspect normalized SCI evidence in Pi through an inert, read-only panel. SCI owns normalization; Pi owns validation and rendering. The completed slice does not execute commands, mutate repositories, persist approvals, activate links, normalize raw packets, or claim AK authority.

Current posture is **observation under frame `SF2`** (display ID `AK.V5.SF02`), not broad workbench expansion. Real-session evidence should drive producer or consumer corrections. A dashboard, VS Code extension, durable evidence store, interactive decision recording, or new mutation semantics requires a fresh explicit decision and owner-scoped implementation wave.

Later candidate surfaces remain:

- VS Code integration backed by stable core contracts;
- a broader graph/search/check dashboard;
- terminal-first operator workflows beyond read-only evidence inspection;
- local project setup helpers.

## Phase 3: CI and review automation

CI/review workflows should consume the same snapshot and patch-check primitives rather than inventing separate analysis logic.

Candidate surfaces:

- pull-request code-intelligence reports;
- rename/refactor safety summaries;
- check evidence bundles;
- drift detection for generated semantic indexes.

## Phase 4: Productization and deployment

ADR-0004 delivers the first deliberately narrow productization target: local tarball installation for CLI and MCP stdio under a trusted single-user boundary. Broader production deployments, marketplace/pattern economy, analytics, and AI-training claims remain roadmap material.

Promotion criteria before treating any broader surface as supported:

- a fresh decision naming the user, trust boundary, and release owner;
- stable contracts and a reproducible release artifact;
- executable install, startup, rollback, and recovery proof for that artifact;
- production p95/p99, concurrency, and soak evidence for the named target;
- authentication, authorization, TLS, command isolation, and tenant/workspace separation for network or multi-user operation;
- documented retention, backup, restore, incident, and upgrade posture;
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
