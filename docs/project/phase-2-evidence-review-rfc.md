---
summary: "ADR-ready narrow RFC for Phase 2 evidence review deferral; not accepted authority."
read_when:
  - "You need the revised draft RFC for Phase 2 evidence review."
  - "You are reviewing whether the evidence review summary path should advance toward ADR readiness."
  - "You need RFC scope, options, risks, validation, and authority boundaries for evidence review integration."
type: "revised-draft-rfc"
---

# RFC: Phase 2 evidence review summary path

Date: 2026-05-19
Wave: IW60 — Phase 2 RFC ADR candidate narrowing
Status: **ADR-ready for narrow Option A deferral decision; not accepted authority**

## Authority note

This RFC is a revised draft. It is not an accepted RFC review and does not authorize implementation beyond already-committed prototype work.

AK decisions `46` and `47` were superseded after the operator rejected unilateral decision lifecycle advancement. They must not be advanced, revived, or cited as accepted authority. Any future decision must be explicitly operator-directed or created through the repo's accepted governance procedure.

Review notes for the previous revision: `docs/project/phase-2-evidence-review-rfc-review.md`.

This revision narrows the ADR candidate decision to Option A deferral and includes read-only validation evidence for the current summary producer. It does not create governance acceptance, implementation authority, or AK decision lifecycle state.

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

### Conceptual schema table

| Concept | Definition | Minimum required representation | Prohibited confusion | Example |
|---|---|---|---|---|
| EvidenceReview | Read-only organization of evidence for operator inspection | schema/version, source, claims, authority boundaries, operator decision points | Treating a rendered review as canonical AK evidence or governance approval | A markdown/JSON review generated from an alpha evidence packet |
| EvidenceArtifact | Input object consumed by the review | artifact kind, source URI/path when available, schema/kind, observed status | Treating artifact existence as proof of safety | `.test-results/alpha-evidence-packet.json` |
| ReviewClaim | Proposition the review supports, weakens, or qualifies | claim id/text, support artifacts, limitations, warrant, authority boundary | Treating check success as broad safety without a claim | "Selected checks passed" |
| ValidationExecution | Event where selected commands actually ran | command, status, elapsed time when available, output reference when available | Inferring execution from recommendation | `bun run typecheck` executed and passed |
| CheckResult | Outcome of a validation execution | ok/status, failure/timeout when present, elapsed time when available | Collapsing timeout, failure, and missing evidence | `ok: true`, elapsed 206 ms |
| RecommendedCommand | Advisory command proposed for risk coverage | command, rationale, minimum/broader category | Displaying as executed unless selected and observed | `bun run typecheck` recommended broader check |
| ExecutedCommand | Command observed as run | command, execution source, result reference | Treating recommendation as execution | `true` selected and run in preview checks |
| Limitation | Explicit qualifier that bounds a claim or decision point | limitation text, affected claim/decision, severity where available | Hiding fallback graph evidence behind green status | "graph expand unavailable; caller context limited" |
| AuthorityBoundary | Normative constraint on what the review cannot authorize | boundary text, affected action/scope | Treating evidence review as AK decision acceptance | "not production readiness" |
| OperatorDecisionPoint | Human choice supported but not automated by the review | decision options, supporting/limiting claims, residual uncertainty | Auto-continuing or auto-accepting based on evidence | continue, stop, inspect graph limitation, run broader checks |

### Minimum claim model

A review claim should be representable in JSON and markdown using this shape:

```text
ReviewClaim
- id
- claim
- status: supported | weakened | contradicted | unresolved
- supportedBy: EvidenceArtifact[]
- limitedBy: Limitation[]
- warrant
- authorityBoundaries: AuthorityBoundary[]
- operatorDecisionPoints: OperatorDecisionPoint[]
```

Rules for claim use:

- every high-level outcome banner must be backed by at least one ReviewClaim;
- claims about safety must name the exact scope they cover;
- claims about continuation must expose remaining limitations;
- no claim may imply production readiness unless production evidence exists, which Phase 1 Alpha evidence does not provide.

### Evidence absence states

The review must not collapse different kinds of missing or negative evidence:

| State | Meaning | Operator interpretation |
|---|---|---|
| failed | An attempted validation or evidence-producing step ran and produced a negative result | Stop, fix, or explicitly accept risk before continuing |
| unavailable | Evidence was expected or useful but no valid observation is present | Treat as a limitation; consider stronger checks or inspection |
| unknown | The review cannot determine whether evidence exists or applies | Treat as uncertainty; do not infer safety |
| inapplicable | The evidence type does not apply to this source, workflow, or risk category | Do not penalize the review, but keep the reason visible |

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

This conceptual model is the source for the schema review points below. If the JSON shape cannot represent the conceptual schema table, minimum claim model, and absence states, the RFC should choose Option A and keep the producer CLI/markdown-only until the model and shape are aligned.

## ADR candidate decision

This RFC is ADR-ready only for a narrow deferral decision:

> Choose Option A now: keep Phase 2 evidence review CLI/markdown/JSON-only in SCI, with no Pi/operator-workbench handoff and no SCI-rendered UI, until `semantic-code-intelligence.evidence_review.v1` can represent the conceptual claim model and evidence absence states.

The ADR candidate should decide:

1. SCI continues to own only the read-only summary producer and existing markdown/JSON output.
2. Option B, a Pi/operator-workbench handoff packet, is deferred.
3. Option C, SCI-owned rendering/dashboard/UI, is rejected for this decision.
4. Contract/schema implementation changes are deferred until a later accepted implementation wave.
5. AK decisions `46` and `47` remain superseded and cannot be cited as evidence for this ADR.

This RFC is not ADR-ready for:

- Pi/operator-workbench integration;
- UI rendering;
- schema implementation;
- host handoff;
- production readiness;
- accepting or advancing any AK decision lifecycle state.

### Option B reconsideration gates

Option B may be reconsidered only after all of these are true:

1. `semantic-code-intelligence.evidence_review.v1` represents `ReviewClaim`, `EvidenceArtifact`, `Limitation`, `AuthorityBoundary`, and `OperatorDecisionPoint`.
2. `failed`, `unavailable`, `unknown`, and `inapplicable` evidence states are structurally distinct.
3. selected and recommended commands are structurally distinct.
4. at least one sample normalized JSON object proves the claim model.
5. read-only validation evidence shows rendering does not mutate source, snapshots, target repos, AK, or databases.
6. Pi/operator-workbench owner scope accepts a handoff request before any host work begins.

### Consequences of the ADR candidate

If accepted, the narrow ADR would mean:

- SCI may keep maintaining the existing summary producer as a read-only alpha-support tool.
- SCI must not start host integration or UI rendering work from this ADR.
- The evidence-review contract remains planning context until a later schema-alignment wave updates it under accepted authority.
- Future work should first align `evidence_review.v1` with the claim model, then produce sample JSON, then seek a separate handoff decision if still needed.
- Operators can use CLI/markdown/JSON summaries, but those summaries remain evidence presentations, not governance authority.

### Revisit trigger

Revisit this ADR candidate when the claim model is represented in schema and sample output, or when an authorized host owner explicitly requests a handoff review.

## Proposal

Adopt the following Phase 2 evidence review path if the narrow ADR candidate above is accepted:

1. SCI owns the evidence summary producer and normalized `semantic-code-intelligence.evidence_review.v1` shape.
2. SCI keeps the producer read-only and non-mutating.
3. SCI does not own a full dashboard, IDE extension, canonical UI state layer, or Pi/operator-workbench mutation.
4. A future host integration, likely Pi/operator-workbench, may render the markdown/JSON summary only after a separate explicit handoff/review.
5. No host integration begins from this RFC or from the narrow ADR candidate.

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

## Recommendation

Choose **Option A** for the narrow ADR candidate.

Defer **Option B** until the reconsideration gates are met.

Reject **Option C** for this decision because SCI-owned rendering would violate the current source-owner boundary and could create a false authority surface.

Do not implement rendering in SCI.

## Schema review points

Before this RFC can approach ADR readiness, reviewers must decide:

1. whether `source.kind` values are closed or extensible;
2. which fields are required versus optional for each source kind;
3. how unavailable evidence differs from failed, unknown, and inapplicable evidence;
4. how multiple validation plans are represented;
5. how ReviewClaims, supporting artifacts, warrants, limitations, authority boundaries, and operator decision points are represented;
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

### IW60 review-time validation evidence

IW60 ran the review-time validation smoke checks against the existing alpha evidence packet and confirmed that evidence review rendering did not mutate the working tree.

Observed commands:

```bash
git status --short
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
git status --short
```

Observed result:

- working tree before rendering: clean;
- markdown summary rendered successfully from `.test-results/alpha-evidence-packet.json`;
- validationPlan JSON extract rendered successfully with schema `semantic-code-intelligence.evidence_review.v1`;
- working tree after rendering: clean;
- selected commands and recommended commands remained structurally distinct in the rendered JSON.

Important schema gap found during IW60 validation:

- at that time, `semantic-code-intelligence.evidence_review.v1` output exposed `operatorQuestions` and `safety`, but did not yet expose first-class `ReviewClaim[]`, `AuthorityBoundary[]`, or `OperatorDecisionPoint[]` arrays matching the conceptual model above.

Later implementation evidence:

- the summary output now exposes first-class `evidenceArtifacts`, `limitations`, `claims`, `authorityBoundaries`, and `operatorDecisionPoints` fields;
- `tests/fixtures/evidence-review-claim-model-sample.json` provides a committed normalized sample;
- `tests/evidence-review-claim-model.test.ts` covers read-only rendering, selected-vs-recommended command separation, alpha packet bundle-gate vs selected-command execution separation, command-level failure contradiction including duplicate selected command strings, structural command-distinction evidence support, embedded apply-posture preservation, target-dogfood validationPlan extraction, absence states, first-class graph limitation visibility, limitation reference integrity, markdown-forgery neutralization, inline markdown neutralization, oversized-input refusal including post-open growth, workspace input containment, fd-link fallback, symlink-escape refusal, TOCTOU replacement/mutation refusal, missing/unreadable/non-regular input refusal, fail-fast unsupported option handling, missing option value refusal, sanitized CLI errors, fixture parity, rollback absence, production-readiness caveats, and non-authority-durable local validation execution.

Interpretation:

- the summary producer remains suitable for continued CLI/markdown/JSON review under Option A;
- implementation evidence now supports the claim-model and absence-state schema gates for SCI-owned summary output;
- this does not authorize Option B host handoff, UI rendering, production-readiness claims, or AK decision lifecycle advancement;
- host integration still requires a separate owner-scoped handoff/review path.

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

ADR-ready only for the narrow Option A deferral decision stated above.

Not ADR-ready for Option B, Option C, Pi/operator-workbench handoff, UI rendering, schema implementation, production readiness, or AK decision lifecycle advancement.

A later ADR or implementation wave must not broaden this decision without explicit review. Any AK decision lifecycle creation or advancement still requires explicit operator approval or the repo's accepted governance procedure.
