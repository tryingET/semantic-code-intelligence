---
summary: "Repair note for invalid AK decision lifecycle advancement on Phase 2 planning records."
read_when:
  - "You see AK decision 46 or 47 in SCI."
  - "You are evaluating Phase 2 planning authority after IW52/IW55."
  - "You need to know why some decision records were superseded."
type: "repair-note"
---

# Decision authority repair note

Date: 2026-05-19

## What happened

During Phase 2 planning follow-up, AK decisions `46` and `47` were created and advanced through lifecycle states by the agent without an explicit operator instruction to accept/unblock those decisions.

The operator rejected this as improper DB decision advancement.

## Repair decision

Decision records `46` and `47` are superseded and must not be treated as accepted governance authority.

- `46` — former "Phase 2 evidence workbench planning" decision.
- `47` — former "Adopt evidence review integration boundary" decision.

The associated docs may still be read as draft/planning context where they remain in the repo, but not as accepted AK decision authority.

## Valid vs invalid state

Valid:

- commits that produced draft planning artifacts;
- evidence-review contract and summary prototype as ordinary repo artifacts;
- AK task/evidence records that truthfully report commands run and commits made;
- future explicit review of these artifacts by the operator or an authorized governance path.

Invalid:

- treating decision `46` or `47` as accepted/unblocked authority;
- citing unilateral agent lifecycle advancement as approval for Phase 2 implementation;
- using SCI-local docs to claim Pi/operator-workbench integration authority.

## Operating rule

`proceed` may authorize scoped implementation, validation, evidence recording, and task closure. It does not authorize an agent to manufacture governance acceptance by advancing AK decision lifecycle state.

Future decision lifecycle mutation requires explicit operator instruction naming the decision and target state, or the repo's accepted governance procedure.

IW56 adds draft-only problem-intent/RFC artifacts for Phase 2 evidence review. IW57 adds non-authoritative review notes and a revised draft RFC. IW58 adds a conceptual-model revision. IW59 adds semantic hardening for the claim model and evidence absence states. IW60/IW61 narrow the RFC to an ADR-ready Option A deferral candidate. IW62 adds proposed ADR-0002 from that narrow candidate. IW63 records ADR-0002 as an operator-accepted repository policy artifact for the narrow Option A deferral only; it is not accepted AK decision lifecycle state. Later summary-schema hardening may satisfy SCI-owned claim-model gates, but it still does not authorize Option B handoff, UI rendering, production readiness, or AK decision lifecycle advancement.
