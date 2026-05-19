---
summary: "Draft RFC for Phase 2 evidence review summary/integration; not reviewed or ADR-ready."
read_when:
  - "You need the draft RFC for Phase 2 evidence review."
  - "You are reviewing whether the evidence review summary path should advance toward ADR readiness."
  - "You need RFC scope, options, risks, and validation for evidence review integration."
type: "draft-rfc"
---

# RFC: Phase 2 evidence review summary path

Date: 2026-05-19  
Wave: IW56 — Phase 2 problem-intent and RFC draft  
Status: **draft RFC; not reviewed; not revised; not ADR-ready**

## Authority note

This RFC is a draft. It is not a reviewed RFC and does not authorize implementation beyond already-committed prototype work.

AK decisions `46` and `47` were superseded after the operator rejected unilateral decision lifecycle advancement. This RFC must receive explicit review and, if needed, a revised RFC before any ADR-ready claim.

## Problem / intent source

Problem-intent draft: `docs/project/phase-2-evidence-review-problem-intent.md`

Core problem:

> Phase 1 evidence is repeatable and machine-readable, but not yet easy for a human operator to inspect during harnessed-LLM work without either reading raw JSON or trusting an agent's summary.

Intent:

> Provide a read-only evidence review path that makes existing SCI evidence legible while preserving Phase 1 safety semantics and authority boundaries.

## Current evidence basis

Existing artifacts:

- Phase 1 closure review: `docs/project/phase-1-closure-review.md`
- Evidence review contract: `docs/project/evidence-review-contract.md`
- Non-mutating summary prototype: `bun run evidence-review:summary`
- Decision repair note: `docs/project/decision-authority-repair-note.md`

The prototype can already render:

```bash
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
```

## Proposal

Adopt the following Phase 2 evidence review path:

1. SCI owns the evidence summary producer and normalized `semantic-code-intelligence.evidence_review.v1` shape.
2. SCI keeps the producer read-only and non-mutating.
3. SCI does not own a full dashboard, IDE extension, or canonical UI state layer.
4. A future host integration, likely Pi/operator-workbench, may render the markdown/JSON summary after a separate explicit handoff/review.
5. No host integration begins until this RFC is reviewed and revised or accepted through the proper governance path.

## Required behavior

The evidence review summary must preserve the sections defined in `docs/project/evidence-review-contract.md`:

1. outcome banner;
2. changed or affected scope;
3. validation commands;
4. check results;
5. graph and impact evidence;
6. snapshot and artifacts;
7. safety and authority boundary.

Hard requirements:

- selected commands and recommended commands remain distinct;
- graph limitations/fallback notes remain visible;
- preview/apply posture remains visible;
- rollback availability/absence remains visible;
- production-readiness caveat remains visible;
- AK authority boundary remains visible;
- no source, snapshot, target repo, or DB mutation occurs during rendering.

## Options considered

### Option A — Keep evidence review CLI-only for now

SCI continues to own `bun run evidence-review:summary`; no host integration yet.

Strengths:

- safest authority boundary;
- no cross-repo mutation;
- easy to validate;
- useful immediately for operators who can read markdown/JSON.

Weaknesses:

- less ergonomic during live operator sessions;
- does not prove Pi/operator-workbench rendering value.

### Option B — Prepare a Pi/operator-workbench handoff packet

SCI produces a handoff packet for Pi, but does not mutate Pi.

Strengths:

- respects source-owner boundary;
- creates a concrete next step for visible rendering;
- keeps SCI focused on summary contract.

Weaknesses:

- still not an implemented user experience;
- requires a separate repo/scope switch or owner acceptance.

### Option C — Implement rendering in SCI

SCI creates a built-in dashboard/web view.

Strengths:

- fastest path to something visible inside SCI.

Weaknesses:

- violates the current source-owner boundary;
- risks creating canonical UI state in SCI;
- pulls Phase 2 toward dashboard/product surface before host needs are validated.

## Draft recommendation

Prefer **Option B** after review: prepare a Pi/operator-workbench handoff packet, with SCI retaining ownership only of the summary producer and evidence-review contract.

Do not implement rendering in SCI.

## Risks

1. **Authority drift** — an evidence renderer may be mistaken for canonical task/evidence authority.
   - Mitigation: render AK authority caveat and avoid persistent SCI UI state.
2. **Hidden policy drift** — recommended commands may appear executed.
   - Mitigation: visually separate selected vs recommended commands.
3. **Overclaiming readiness** — Alpha evidence may be presented as production readiness.
   - Mitigation: render production-readiness caveat in every summary.
4. **Source-owner drift** — SCI may absorb Pi/operator-workbench rendering concerns.
   - Mitigation: host integration requires separate handoff and owner scope.

## Validation plan

Draft validation for a future reviewed/revised RFC:

```bash
bun run typecheck
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
ak direction check --repo . --machine
```

If evidence runtime contracts change:

```bash
bun run alpha:mvp:check
```

## Review questions

A reviewer should decide:

1. Is Option B the correct next step, or should this remain CLI-only?
2. Are the source-owner boundaries explicit enough?
3. Is the normalized `semantic-code-intelligence.evidence_review.v1` shape sufficient for handoff?
4. What changes are required before this RFC becomes ADR-ready?
5. Who owns reviewing or accepting any Pi/operator-workbench integration?

## ADR-readiness status

Not ADR-ready.

Required before ADR readiness:

1. explicit RFC review;
2. revised RFC if review requests changes;
3. clear decision on Option A vs Option B;
4. owner boundary confirmation for any Pi/operator-workbench handoff;
5. explicit operator approval to create or advance AK decision lifecycle state.
