---
summary: "IW52 Phase 2 planning decision after Phase 1 Alpha MVP closure."
read_when:
  - "You are deciding whether to start Phase 2 work."
  - "You need the target user, interface, validation contract, and rollback boundary for Phase 2."
  - "You are proposing UI, IDE, dashboard, or developer-workbench work."
type: "decision"
---

# Phase 2 planning decision

Date: 2026-05-19  
Wave: IW52 — Phase 2 planning decision  
AK decision: `46`  
Status: accepted planning decision; implementation not started

## Decision

**Start Phase 2 planning around operator-facing evidence/workbench support, not a broad IDE or dashboard build.**

The first Phase 2 direction should make the closed Phase 1 Alpha substrate easier for a human operator to inspect and steer during harnessed-LLM coding sessions.

This decision authorizes planning and task shaping only. It does **not** authorize implementation of a VS Code extension, dashboard, marketplace, production deployment, analytics, or new mutation semantics.

## Target user

Primary Phase 2 user:

> A human operator supervising a harnessed LLM coding session that uses SCI for discovery, patch planning, validation, and evidence.

Secondary users may include maintainers reviewing generated evidence after the fact, but Phase 2 should not pivot to standalone human IDE usage until the operator-supervised workflow is validated.

## Initial interface direction

Prefer an **evidence workbench / operator review surface** over editor-first implementation.

The first planning slice should consume existing Phase 1 evidence surfaces:

- `validationPlan` summaries;
- `.test-results/alpha-evidence-packet.json`;
- `graph_expand` impact summaries and limitations;
- `recommend_checks` rationale;
- snapshot artifact links (`overlay.diff`, `status`, `progress`);
- safe-write verification and rollback posture.

Likely interface candidates, in priority order:

1. **Design/contract for an evidence review panel** that can be rendered by Pi/operator workbench or a lightweight web view.
2. **CLI/JSON summary refinement** only when needed to support that review panel.
3. **MCP resource/read integration** for evidence artifacts if a real host needs it.
4. **IDE extension** only after the evidence review contract is stable.

## Validation contract

A Phase 2 implementation wave must define validation before code changes. Minimum validation contract:

- sample evidence packet renders or summarizes without mutating the workspace;
- selected commands, recommendations, checks, graph limitations, and rollback posture remain visible;
- no hidden validation command selection is introduced;
- Alpha validation bundle still passes (`bun run alpha:mvp:check`) if runtime contracts change;
- docs strict and direction check pass;
- operator-facing claims distinguish Alpha evidence from production readiness.

## Rollback boundary

Phase 2 work must be rollbackable without damaging the Phase 1 substrate:

- keep Phase 1 CLI/MCP/HTTP contracts stable unless a separate compatibility decision approves changes;
- keep new work additive until validated;
- if an evidence workbench surface fails, revert that surface while preserving Phase 1 validation commands and generated evidence;
- do not move task/evidence authority into SCI UI state; AK remains task/evidence authority where registered.

## Rejected paths for now

| Path | Reason rejected for initial Phase 2 |
|---|---|
| VS Code extension first | Too likely to optimize editor polish before evidence-review contract is stable. |
| Full dashboard first | Risks product-surface expansion and state ownership ambiguity. |
| Production SLO/performance dashboard | Productization scope; Phase 1 evidence is not production p95/p99. |
| Marketplace/pattern economy | Later productization, not operator workbench validation. |
| New mutation/apply semantics | Phase 1 guarded apply is accepted; changes need separate compatibility decision. |

## Next executable wave

IW53 produced the evidence review contract in `docs/project/evidence-review-contract.md`.

Recommended next wave:

**IW54 — Evidence review summary prototype**

Goal: implement the smallest non-mutating renderer/summary producer for the contract, preferably as a CLI or script that reads existing `.test-results`/`validationPlan` input and emits markdown or JSON.

Do not build a UI until the summary contract is proven with existing evidence samples.
