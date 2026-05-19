---
summary: "IW50 closure review for the Phase 1 harnessed-LLM Alpha MVP substrate."
read_when:
  - "You need the current Phase 1 closure decision."
  - "You are deciding whether to add more Phase 1 dogfood or start Phase 2 planning."
  - "You need the boundary between alpha-usable substrate evidence and production readiness."
type: "review"
---

# Phase 1 closure review — harnessed LLM Alpha MVP

Date: 2026-05-19  
Wave: IW50 — Phase 1 closure review

## Closure decision

**Decision: close Phase 1 as an Alpha MVP substrate for the harnessed-LLM first user.**

SCI has enough repeatable evidence to treat the Phase 1 substrate as alpha-usable for bounded harnessed-LLM coding sessions:

```text
bounded discovery
-> graph/impact hints
-> check recommendation
-> preview/check in snapshot
-> validationPlan evidence
-> guarded apply only when explicit
-> rollback/evidence posture
```

This is a closure of the **Alpha MVP substrate**, not a declaration of production readiness, whole-program semantic accuracy, broad IDE readiness, or Phase 2 delivery.

## What is accepted as Phase 1 complete

Phase 1 is accepted for these first-user uses:

- SCI tool surface discovery and representative calls across CLI, HTTP, MCP HTTP, MCP stdio, and direct adapter tests;
- bounded read/navigation workflows for harnessed LLM context gathering;
- graph impact summaries that are useful when evidence exists and explicit when fallback-shaped;
- advisory `recommend_checks` output that does not silently mutate selected commands;
- preview-first patch/check workflows with snapshot artifacts and compact `validationPlan` summaries;
- guarded `safe_write` apply posture with exact applied-diff verification and rollback evidence;
- repeatable generated Alpha evidence and operator-facing evidence packets;
- target-cwd installed/global CLI dogfood across SCI, JavaScript, mixed Python/Rust, and Clojure target contexts.

The accepted interface stance is:

- **CLI** for target-repo and one-shot dogfood fallback;
- **MCP HTTP** for long-lived MCP hosts;
- **MCP stdio** for stdio-only hosts;
- **HTTP tools/call** for deterministic parity testing;
- **direct adapter tests** for contract/unit coverage.

## Evidence basis

The closure decision is based on:

- `bun run alpha:mvp:check` as the primary repeatable validation bundle;
- generated `.test-results/*` evidence packets;
- IW35–IW39 check-recommendation and validation-plan hardening;
- IW40 readiness review;
- IW41/IW43 non-SCI target validationPlan proofs;
- IW42 interface choice guidance;
- IW44 interactive latency/SLO guidance;
- IW45 lightweight elapsed-time history comparison;
- IW46 graph fallback/caller-context hardening;
- IW47 JavaScript target proof;
- IW48 mixed Python/Rust `agent-kernel` worktree proof;
- IW49 Clojure worktree proof.

## What closure does not prove

Phase 1 closure does **not** prove:

- production readiness;
- production p95/p99 SLOs;
- performance stability across machines or very large repositories;
- complete whole-program call graph accuracy;
- rich semantic graph behavior for every language;
- durable long-lived cross-process session semantics beyond narrow snapshot artifacts;
- polished human IDE/workbench UX;
- marketplace/pattern economy, analytics, Kubernetes, deployment, or productized operations.

## Remaining gaps after closure

These are no longer blockers to closing the Phase 1 Alpha MVP substrate, but they remain true follow-up risks:

1. **Graph depth and language richness** — current graph evidence is useful for planning and explicit about limitations, but it is not whole-program semantic analysis.
2. **Performance characterization** — Alpha budgets and lightweight history catch obvious regressions; production p95/p99 and cross-machine latency remain future work.
3. **Durable evidence/session store** — generated files and narrow snapshot artifacts are enough for Alpha MVP; a durable session/evidence database is not present.
4. **Target diversity beyond sampled repos** — JavaScript, Python/Rust, and Clojure proofs reduce uncertainty, but do not guarantee every ecosystem behaves well.
5. **Human workbench polish** — Phase 2 UI/IDE/dashboard work still needs its own strategy and validation contract.

## Operating rule after closure

Do **not** keep adding Phase 1 dogfood waves by default.

After IW50, new work should be one of:

1. **Maintenance/regression work** when the Alpha evidence bundle fails or an operator finds a concrete substrate bug;
2. **A Phase 2 planning/decision wave** if the operator wants human workbench, IDE, dashboard, or integration polish;
3. **A targeted hardening wave** only when tied to a named gap from this review, not general confidence-building.

## Suggested next direction

Recommended next wave:

**IW51 — Phase 2 planning decision or Alpha maintenance backlog triage**

Pick one:

- create a Phase 2 planning decision for developer workbench/IDE/dashboard priorities; or
- triage Alpha maintenance follow-ups into a small backlog, explicitly separating bugs from future product scope.

IW51 created that backlog in `docs/project/alpha-maintenance-backlog.md` and seeded AK tasks `3165`–`3168`.

IW52 created the Phase 2 planning decision in `docs/project/phase-2-planning-decision.md`. It names the target user, interface direction, validation contract, and rollback boundary, but still does not authorize UI implementation until the next evidence-review contract is accepted.
