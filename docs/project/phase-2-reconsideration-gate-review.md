---
summary: "IW72 verification of ADR-0002 Phase 2 evidence-review reconsideration gates and the remaining host-owner boundary."
read_when:
  - "You are deciding whether SCI Phase 2 evidence review may move beyond CLI/markdown/JSON."
  - "You need current evidence for ADR-0002 reconsideration gates."
  - "You are preparing a Pi/operator-workbench owner review request."
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
Status: SCI-local gates verified; host handoff remains blocked

## Decision boundary

This review attends to Phase 2 within the accepted repository policy in `docs/adr/0002-defer-evidence-review-handoff.md`. It does not revive or advance superseded AK decisions `46` or `47`, accept a new AK decision, authorize Pi/operator-workbench work, or authorize an SCI-owned UI.

The current lawful SCI surface remains read-only CLI/markdown/JSON evidence review. A future host handoff requires explicit acceptance from the Pi/operator-workbench owner scope.

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

Phase 2 is attended through a verified reconsideration review. SCI-local readiness evidence is complete for ADR-0002 gates 1–5. Host-owner acceptance remains the sole blocking reconsideration gate, so the repository must remain on the CLI/markdown/JSON path until that external acceptance is explicit.
