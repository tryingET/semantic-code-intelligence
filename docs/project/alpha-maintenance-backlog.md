---
summary: "Post-IW50 Alpha maintenance backlog triage for the closed Phase 1 substrate."
read_when:
  - "You need to choose Alpha maintenance work after Phase 1 closure."
  - "You are deciding whether a follow-up is maintenance, targeted hardening, or Phase 2 scope."
  - "You need AK task IDs for the post-closure maintenance backlog."
type: "reference"
---

# Alpha maintenance backlog

Date: 2026-05-19  
Wave: IW51 — Alpha maintenance backlog triage

## Purpose

IW50 closed Phase 1 as an **Alpha MVP substrate** for the harnessed-LLM first user. This backlog keeps post-closure work bounded:

- maintenance/regression fixes belong here;
- targeted hardening must map to a named closure-review gap;
- Phase 2 UI, IDE, dashboard, and human workbench work requires a separate planning decision before implementation.

Do not use this backlog to reopen automatic Phase 1 dogfood accumulation.

## Triage rules

Classify new work as follows:

| Class | Accept into Alpha maintenance? | Rule |
|---|---:|---|
| Evidence bundle failure | Yes | Fix or update the smallest truthful failing contract. |
| Operator-reported substrate bug | Yes | Reproduce, preserve evidence, and scope the fix to the affected Alpha path. |
| Named closure-review gap | Maybe | Accept only when the task has a concrete trigger or measurable outcome. |
| More target dogfood for confidence only | No | Add only when closure review or a target failure identifies a specific ecosystem risk. |
| Phase 2 UX/IDE/dashboard | No | Requires a Phase 2 planning decision first. |
| Production SLO/deployment/analytics | No | Future productization scope, not Alpha maintenance. |

## AK-backed backlog

These tasks are AK records, not implementation authority until claimed and scoped for a wave.

| AK task | Priority | Maintenance area | Trigger | Notes |
|---:|---:|---|---|---|
| `3165` | 2 | Graph fallback/language characterization | Operator finds graph impact too sparse or misleading for a concrete change. | IW71 adds `docs/project/graph-language-characterization.md` and graph dogfood assertions; no whole-program accuracy claim. |
| `3166` | 2 | Performance evidence history calibration | Repeated `alpha:evidence:history` warnings are noisy or misleading. | Refine warning policy/baseline guidance; do not convert to production SLOs. |
| `3167` | 1 | Durable snapshot/evidence boundary | A real workflow needs cross-process/session semantics beyond current artifacts. | IW69 adds `docs/project/durable-snapshot-evidence-boundary.md`; avoid adding a broad state layer by default. |
| `3168` | 1 | Target dogfood issue capture | A target run fails or an operator reports target-specific friction. | Create a concrete issue capture path; do not add target proofs for confidence only. |

## Non-backlog items

The following are intentionally **not** Alpha maintenance backlog items:

- VS Code extension implementation;
- dashboard or human workbench UI;
- production deployment/Kubernetes work;
- marketplace or pattern economy features;
- broad analytics or training claims;
- durable metrics platform.

These may become valid after a Phase 2 or productization planning decision names the user, interface, validation contract, and rollback boundary.

## Recommended next move

If continuing immediately after IW51, prefer a **Phase 2 planning decision** only if the operator wants to move toward human workbench/IDE/dashboard work.

Otherwise, stop and wait for one of:

- an Alpha evidence regression;
- an operator-reported substrate bug;
- a concrete need tied to one of the AK-backed backlog items above.
