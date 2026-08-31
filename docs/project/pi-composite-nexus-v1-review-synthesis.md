---
summary: "Controlling review synthesis for Pi Composite NEXUS v1 decision 145."
read_when:
  - "You are closing review for decision 145."
type: "review-synthesis"
---

# Pi Composite NEXUS v1 controlling review synthesis

Date: 2026-08-31
Decision: AK `145`
Reviewed RFC: [`pi-composite-nexus-v1-rfc.md`](pi-composite-nexus-v1-rfc.md)
Review memo: [`pi-composite-nexus-v1-review.md`](pi-composite-nexus-v1-review.md)

## Outcome

**ready_for_adr**

Independent producer/security, consumer/compatibility, and product/completion reviews converge on the
same architecture:

- preserve one configured workspace and prohibit path-derived rebinding;
- use a server-minted persisted opaque identity, not a bearer authorization token;
- bind machine-actionable paths and recoveries to that identity;
- bind navigation to a verified pre/post state digest;
- close the mutable snapshot race with revision-exact compare-and-swap staging and exact check/apply
  receipts;
- adopt additively in the private Pi profile before any later direct-client mandatory migration.

The RFC incorporates every supported blocker. No unresolved design-contract blocker remains for ADR
recording. Implementation completion remains conditional on the deterministic race, wrong-root,
state-drift, compatibility, packaged-candidate, and live-Pi proofs named in the review memo.

## Residual risks accepted for this decision

- trusted same-user metadata tampering remains outside the threat model;
- workspace relocation/rebind is deferred and initially fails closed;
- legacy direct surfaces remain non-NEXUS compatibility paths;
- workspace-state receipts are observational and not durable snapshots;
- version promotion and distribution require separate authority.
