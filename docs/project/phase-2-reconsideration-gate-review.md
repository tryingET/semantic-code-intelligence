---
summary: "Historical IW72 verification of ADR-0002 gates before the host-owner gate was subsequently satisfied."
read_when:
  - "You are deciding whether SCI Phase 2 evidence review may move beyond CLI/markdown/JSON."
  - "You need current evidence for ADR-0002 reconsideration gates."
  - "You need the historical basis for the completed Pi/operator-workbench owner handoff."
type: "review"
system4d:
  container: "SCI Phase 2 evidence-review reconsideration under ADR-0002 and AK authority boundaries."
  compass: "Advance only evidence-backed SCI-owned work while preventing host, UI, and decision-authority drift."
  engine: "Focused schema tests, read-only status comparison, Alpha validation, and explicit external-owner gating."
  fog: "SCI-local verification cannot supply Pi/operator-workbench acceptance or revive superseded AK decisions."
---

# Phase 2 evidence-review reconsideration gate review

Date: 2026-07-12  
Wave: IW72 — Phase 2 evidence-review reconsideration gate verification  
AK task: `3831`  
Status: historical gate review; host-owner gate was subsequently satisfied and ADR-0003 authorizes the bounded consumer

> **Subsequent outcome:** This document records the state at IW72. The operator later authorized the Pi owner implementation; Pi tasks `3843`, `3853`, and `3855` delivered and hardened the read-only consumer, and SCI task `3866` completed live producer conformance proof. See [ADR-0003](../adr/0003-authorize-bounded-evidence-review-consumer-handoff.md). The producer's generated `blocked / cli_only` value remains intentionally conservative and is not the external owner-acceptance record.

## Decision boundary at IW72

This review attended to Phase 2 within the then-current repository policy in `docs/adr/0002-defer-evidence-review-handoff.md`. It did not revive or advance superseded AK decisions `46` or `47`, accept a new AK decision, authorize Pi/operator-workbench work, or authorize an SCI-owned UI.

At IW72, the lawful SCI surface remained read-only CLI/markdown/JSON evidence review and a future host handoff still required explicit acceptance from the Pi/operator-workbench owner scope. ADR-0003 records the later bounded acceptance; the remaining assessment is historical evidence.

## Reconsideration gate assessment

| ADR-0002 gate | Assessment | Evidence |
|---|---|---|
| Claim-model fields | Verified | `semantic-code-intelligence.evidence_review.v1` exposes first-class `evidenceArtifacts`, `limitations`, `claims`, `authorityBoundaries`, and `operatorDecisionPoints` arrays. |
| Evidence absence states | Verified | Focused tests cover `failed`, `unavailable`, `unknown`, and `inapplicable`; the observed sample retained distinct `observed`, `unknown`, and `inapplicable` states. |
| Selected vs recommended commands | Verified | The normalized shape separates `commands.selected`, `recommendedMinimum`, and `recommendedBroader`; regression tests prevent recommendation text from masquerading as execution evidence. |
| Committed normalized sample | Verified | `tests/fixtures/evidence-review-claim-model-sample.json` exists and fixture-parity regression coverage passed. |
| Read-only behavior | Verified for the observed SCI summary execution | Focused tests cover workspace immutability, mutation-capable import refusal, path/symlink/TOCTOU/non-regular/oversized-input refusal, and forged readiness resistance. A Linux `strace` audit of the renderer using the committed input fixture observed no successful mutation-capable filesystem syscall and no network connection/send syscall; before/after `git status --porcelain=v1` was unchanged. This bounds the observed execution across filesystem-backed source, snapshot, target, AK, and database surfaces without claiming a universal formal proof. |
| Pi/operator-workbench owner acceptance | **Missing — blocking** | The generated `handoffReadiness` reports `status: blocked`, `decision: cli_only`, and `host-owner-acceptance: missing` with `externalAuthorityRequired: true`. SCI cannot satisfy this gate itself. |

## Observed verification

Focused contract suite:

```bash
bun run evidence-review:test
```

Observed result:

```text
44 pass
0 fail
334 expect() calls
```

Read-only sample rendering and Linux syscall audit:

```bash
before=$(git status --porcelain=v1)
strace -f -qq \
  -e trace=openat,creat,unlink,unlinkat,rename,renameat,renameat2,mkdir,mkdirat,rmdir,truncate,ftruncate,connect,sendto \
  -o /tmp/sci-phase2-render.strace \
  bun run scripts/summarize-evidence-review.ts \
    --input tests/fixtures/evidence-review-validation-plan-input.json \
    --format json > /tmp/sci-phase2-evidence-review.json
after=$(git status --porcelain=v1)
test "$before" = "$after"
```

The trace was inspected for successful mutation-capable opens or path operations and for network connect/send operations. Bun attempted to open `/sys/kernel/debug/tracing/trace_marker` with `O_WRONLY`; the kernel rejected it with `EACCES`. No successful mutation-capable filesystem operation and no network connect/send operation was observed.

Observed result:

- output schema: `semantic-code-intelligence.evidence_review.v1`;
- all five first-class claim-model collections were arrays;
- claim-model, absence-state, command-distinction, and read-only indicators were `present`;
- sample/test evidence remained `not_asserted` in generated output because a local renderer must not certify its own external receipts;
- host-owner acceptance was `missing`;
- tracked and untracked status was unchanged.

The observed command result is recorded in this review and in AK task evidence at closeout; the committed input/output fixtures provide reproducible shape and parity inputs. Generated readiness remains a conservative local projection, not authority.

## Interpretation

ADR-0002 gates 1–5 now have SCI-local implementation and verification evidence. This makes the evidence-review contract suitable for continued CLI/markdown/JSON use and for an owner review request.

It does **not** make host handoff ready. Gate 6 is normative and external: only the Pi/operator-workbench owner can accept review of a consumer handoff. Until that happens:

- do not implement a Pi panel, web view, dashboard, or IDE surface;
- do not create durable host state in SCI;
- do not treat rendered evidence as AK task/evidence authority;
- do not claim production readiness;
- do not advance or replace decisions `46` or `47` by implication.

## Owner-review request

The next lawful Phase 2 action is an explicit owner-scoped review with this bounded question:

> Will the Pi/operator-workbench owner accept review of a read-only consumer handoff for `semantic-code-intelligence.evidence_review.v1`, limited to rendering existing markdown/JSON evidence, with no SCI-owned UI state, no hidden command selection, no mutation authority, and no claim that rendered evidence is canonical AK authority?

A positive answer authorizes preparation/review of a handoff contract only. It does not itself authorize implementation, merge, deployment, or publication; those remain subject to the owner repo's scope and validation rules.

## Current conclusion

At IW72, SCI-local readiness evidence was complete for ADR-0002 gates 1–5 and host-owner acceptance was still missing. That final gate was subsequently satisfied through explicit operator authorization and owner-repo implementation. ADR-0003 now governs the bounded read-only handoff. This does not authorize broader Phase 2 UI, persistence, execution, publication, or AK decision advancement.
