---
summary: "Revised draft RFC for Phase 2 evidence review summary/integration; not ADR-ready."
read_when:
  - "You need the revised draft RFC for Phase 2 evidence review."
  - "You are reviewing whether the evidence review summary path should advance toward ADR readiness."
  - "You need RFC scope, options, risks, validation, and authority boundaries for evidence review integration."
type: "revised-draft-rfc"
---

# RFC: Phase 2 evidence review summary path

Date: 2026-05-19
Wave: IW58 — Phase 2 RFC conceptual model revision
Status: **conceptual-model revised draft RFC; not accepted; not ADR-ready**

## Authority note

This RFC is a revised draft. It is not an accepted RFC review and does not authorize implementation beyond already-committed prototype work.

AK decisions `46` and `47` were superseded after the operator rejected unilateral decision lifecycle advancement. They must not be advanced, revived, or cited as accepted authority. Any future decision must be explicitly operator-directed or created through the repo's accepted governance procedure.

Review notes for the previous revision: `docs/project/phase-2-evidence-review-rfc-review.md`.

This revision adds a conceptual model for evidence-backed operator judgment; it does not create governance acceptance.

## Problem / intent source

Problem-intent draft: `docs/project/phase-2-evidence-review-problem-intent.md`

Core problem:

> Phase 1 evidence is repeatable and machine-readable, but not yet easy for a human operator to inspect during harnessed-LLM work without either reading raw JSON or trusting an agent's summary.

Intent:

> Provide a read-only evidence review path that makes existing SCI evidence legible while preserving Phase 1 safety semantics and authority boundaries.

## Authority hierarchy

Read these artifacts in this order:

1. `docs/project/decision-authority-repair-note.md` defines the repair boundary: decisions `46` and `47` are superseded and non-authoritative.
2. `docs/project/phase-2-evidence-review-problem-intent.md` defines the draft problem and intent only.
3. `docs/project/evidence-review-contract.md` is a planning contract and compatibility baseline for the evidence-review shape, not accepted Phase 2 product direction.
4. `bun run evidence-review:summary` is implementation evidence for an existing non-mutating prototype, not governance approval.
5. This RFC is the current draft review object.

No artifact in this chain creates ADR readiness or AK decision lifecycle authority by itself.

## Current evidence basis

Existing artifacts:

- Phase 1 closure review: `docs/project/phase-1-closure-review.md`
- Evidence review contract: `docs/project/evidence-review-contract.md`
- Non-mutating summary prototype: `bun run evidence-review:summary`
- Decision repair note: `docs/project/decision-authority-repair-note.md`
- RFC review notes: `docs/project/phase-2-evidence-review-rfc-review.md`

The prototype can already render:

```bash
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
```

## Conceptual model

The evidence review path exists to support an operator's judgment, not to replace it. The model separates artifacts, claims, warrants, limitations, authority, and human decision points.

Core concepts:

- **EvidenceReview** — a read-only summary event/view that organizes evidence for operator inspection. It is not canonical task/evidence authority.
- **EvidenceArtifact** — an input object such as an alpha evidence packet, validation plan, graph impact summary, check recommendation, or snapshot link.
- **ReviewClaim** — a proposition the review can support or weaken, for example: "the selected checks passed", "the graph evidence is limited", or "this result remains preview-only".
- **ValidationExecution** — an event where selected commands actually ran.
- **CheckResult** — the observable outcome of a validation execution, including pass/fail/timeout and elapsed time where available.
- **RecommendedCommand** — an advisory command SCI suggested for risk coverage.
- **ExecutedCommand** — a command that actually ran. It must never be inferred from a recommendation.
- **Limitation** — a qualifier that weakens or bounds one or more review claims, such as fallback-shaped graph evidence or unavailable rollback evidence.
- **AuthorityBoundary** — a normative statement about what the review cannot authorize, such as production readiness, AK decision acceptance, mutation, or host integration.
- **OperatorDecisionPoint** — a human-facing choice left open by the evidence, such as continue, stop, narrow scope, inspect a limitation, or run stronger checks.

Conceptual rules:

1. every EvidenceReview must state at least one ReviewClaim and at least one AuthorityBoundary;
2. every ExecutedCommand must come from observed execution evidence, not recommendation text;
3. every RecommendedCommand must remain visually and structurally distinct from every ExecutedCommand;
4. every Limitation must identify the claim or decision point it qualifies;
5. unavailable evidence, failed evidence, unknown evidence, and inapplicable evidence must remain distinguishable;
6. an operator decision may be supported by evidence, but is not produced automatically by the evidence review;
7. a rendered review is a presentation of evidence, not governance acceptance.

Example claim/warrant shape:

```text
Claim: The preview evidence is sufficient to continue reviewing this patch.
Supported by: selected checks passed; touched files are visible; no apply evidence is present.
Limited by: graph impact evidence is fallback-shaped.
Warrant: For a low-risk preview, passing selected checks plus visible limitations may justify continued inspection, not production readiness.
Authority boundary: The review cannot accept an AK decision, mutate the workspace, or claim the patch is production-ready.
Operator decision point: continue, inspect graph limitation, run broader checks, or stop.
```

This conceptual model is the source for the schema review points below. If the JSON shape cannot represent these distinctions, the RFC should choose Option A and keep the producer CLI/markdown-only until the model and shape are aligned.

## Proposal

Adopt the following Phase 2 evidence review path if review accepts it:

1. SCI owns the evidence summary producer and normalized `semantic-code-intelligence.evidence_review.v1` shape.
2. SCI keeps the producer read-only and non-mutating.
3. SCI does not own a full dashboard, IDE extension, canonical UI state layer, or Pi/operator-workbench mutation.
4. A future host integration, likely Pi/operator-workbench, may render the markdown/JSON summary after a separate explicit handoff/review.
5. No host integration begins until this RFC is accepted or revised through the proper governance path.

The contract names the likely consumer. This RFC does not authorize work in that consumer.

## Target surface distinction

- **Contract-compatible future target:** a Pi/operator-workbench evidence review panel or equivalent lightweight markdown/web view.
- **Next SCI-owned deliverable:** a read-only summary producer and, if accepted, a non-mutating handoff packet describing the JSON/markdown contract.
- **Not authorized here:** Pi repository mutation, Pi UI implementation, durable host state, hidden command selection, or new apply semantics.

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

SCI continues to own `bun run evidence-review:summary`; no host integration or handoff packet yet.

Choose Option A if review finds that:

- the normalized summary shape is still unstable;
- contract gaps require more sample evidence before handoff;
- operator value is sufficient through markdown/JSON output;
- source-owner risk outweighs host-rendering benefit.

Strengths:

- safest authority boundary;
- no cross-repo mutation;
- easy to validate;
- useful immediately for operators who can read markdown/JSON.

Weaknesses:

- less ergonomic during live operator sessions;
- does not prepare Pi/operator-workbench rendering.

### Option B — Prepare a Pi/operator-workbench handoff packet

SCI produces a non-mutating handoff packet for Pi/operator-workbench owners, but does not mutate Pi.

Choose Option B only if review finds that:

- the `semantic-code-intelligence.evidence_review.v1` shape is stable enough for a consumer contract;
- selected-vs-recommended command semantics are clear;
- graph limitation and preview/apply semantics are visibly preserved;
- handoff can be authored without claiming host-owner acceptance.

Strengths:

- respects source-owner boundary;
- creates a concrete next step for visible rendering;
- keeps SCI focused on summary contract.

Weaknesses:

- still not an implemented user experience;
- requires a separate repo/scope switch or owner acceptance.

### Option C — Implement rendering in SCI

SCI creates a built-in dashboard/web view.

Under current boundaries, do **not** choose Option C.

Strengths:

- fastest path to something visible inside SCI.

Weaknesses:

- violates the current source-owner boundary;
- risks creating canonical UI state in SCI;
- pulls Phase 2 toward dashboard/product surface before host needs are validated.

## Draft recommendation

Current review posture: prefer **Option A** until the conceptual model and schema review points are resolved.

Choose **Option B** only after explicit review confirms that `semantic-code-intelligence.evidence_review.v1` can represent ReviewClaims, Limitations, AuthorityBoundaries, and OperatorDecisionPoints without collapsing evidence into authority.

Do not implement rendering in SCI.

## Schema review points

Before this RFC can approach ADR readiness, reviewers must decide:

1. whether `source.kind` values are closed or extensible;
2. which fields are required versus optional for each source kind;
3. how unavailable evidence differs from failed, unknown, and inapplicable evidence;
4. how multiple validation plans are represented;
5. how ReviewClaims, supporting artifacts, warrants, limitations, and authority boundaries are represented;
6. what stability expectations apply to artifact URIs such as `snapshot://.../overlay.diff`;
7. what versioning/deprecation policy applies to `semantic-code-intelligence.evidence_review.v1`;
8. whether target-dogfood evidence and alpha-packet evidence require separate sections or one shared renderer.

## Risks

1. **Authority drift** — an evidence renderer may be mistaken for canonical task/evidence authority.
   - Mitigation: render AK authority caveat and avoid persistent SCI UI state.
2. **Hidden policy drift** — recommended commands may appear executed.
   - Mitigation: visually separate selected vs recommended commands.
3. **Overclaiming readiness** — Alpha evidence may be presented as production readiness.
   - Mitigation: render production-readiness caveat in every summary.
4. **Source-owner drift** — SCI may absorb Pi/operator-workbench rendering concerns.
   - Mitigation: host integration requires separate handoff and owner scope.
5. **Decision repair regression** — a later wave may try to reuse decisions `46` or `47`.
   - Mitigation: keep them superseded and require any future decision path to be explicit and fresh.

## Validation plan

### Review-time validation

Use these checks for draft/RFC review work:

```bash
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
ak direction check --repo . --machine
```

Review must also inspect `git status --short` before and after rendering to confirm the summary path does not mutate source. ADR-ready validation should additionally confirm the renderer does not call AK or database mutation commands.

### Implementation-time validation

Use these checks if a later accepted wave changes runtime contracts:

```bash
bun run typecheck
bun run alpha:mvp:check
```

Additional host integration validation belongs in the owning host repo if Option B later proceeds.

## Review questions

A reviewer should decide:

1. Is Option A or Option B the correct next step under current source-owner boundaries?
2. Are the source-owner boundaries explicit enough?
3. Is the normalized `semantic-code-intelligence.evidence_review.v1` shape sufficient to represent the conceptual model?
4. Which schema review points must be resolved before ADR readiness?
5. Who owns reviewing or accepting any Pi/operator-workbench integration?
6. What evidence must be attached to prove rendering is read-only and non-mutating?
7. What operator decisions should the review support without automating or authorizing them?

## ADR-readiness status

Not ADR-ready.

Required before ADR readiness:

1. explicit RFC review by the operator or accepted governance path;
2. revised RFC if review requests changes beyond this draft revision;
3. clear decision on Option A versus Option B;
4. owner boundary confirmation for any Pi/operator-workbench handoff;
5. conceptual model and schema review point resolution or explicit deferral;
6. non-mutation/read-only validation evidence attached to the RFC;
7. explicit operator approval before any AK decision lifecycle creation or advancement.
