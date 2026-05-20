---
summary: "ADR-0002: Defer Phase 2 evidence-review host handoff until semantic evidence-review schema is ready."
read_when:
  - "You need the Phase 2 evidence-review ADR candidate."
  - "You are deciding whether SCI may start Pi/operator-workbench evidence-review handoff or UI work."
  - "You are changing evidence-review summary schema, rendering, or handoff scope."
type: "adr"
---

# ADR-0002: Defer Evidence Review Handoff Until Claim Model Is Schema-Ready

Status: Accepted
Date: 2026-05-19
Accepted: 2026-05-19 by explicit operator instruction (`do 1` after being offered “Accept/reject proposed ADR-0002 explicitly”)
Authors: Semantic Code Intelligence Team

## Authority note

This ADR is **accepted as a repository ADR** for the narrow Option A deferral decision recorded below.

This ADR does not create or advance AK decision lifecycle state. AK decisions `46` and `47` remain superseded and must not be cited as accepted authority.

## Context

Phase 1 is closed as an Alpha MVP substrate for harnessed-LLM coding sessions. SCI now has machine-readable evidence artifacts, including validation plans, alpha evidence packets, graph impact summaries, check recommendations, and snapshot links.

Phase 2 planning asked whether SCI should move toward a human-readable evidence review surface. Earlier planning overreached by creating and advancing AK decisions without explicit operator authority. That overreach was repaired in `docs/project/decision-authority-repair-note.md`.

The ADR-ready RFC is now deliberately narrow:

- source RFC: `docs/project/phase-2-evidence-review-rfc.md`;
- problem intent: `docs/project/phase-2-evidence-review-problem-intent.md`;
- planning contract: `docs/project/evidence-review-contract.md`;
- review notes: `docs/project/phase-2-evidence-review-rfc-review.md`.

The RFC establishes a conceptual model for evidence-backed operator judgment:

- EvidenceReview;
- EvidenceArtifact;
- ReviewClaim;
- ValidationExecution;
- CheckResult;
- RecommendedCommand;
- ExecutedCommand;
- Limitation;
- AuthorityBoundary;
- OperatorDecisionPoint.

It also distinguishes evidence absence states:

- failed;
- unavailable;
- unknown;
- inapplicable.

IW60 validation confirmed the existing summary producer could render markdown/JSON without mutating the working tree. At ADR acceptance time, `semantic-code-intelligence.evidence_review.v1` did not yet expose first-class `ReviewClaim[]`, `AuthorityBoundary[]`, or `OperatorDecisionPoint[]` arrays matching the conceptual model. Later follow-up work may satisfy schema-readiness gates, but it does not change this ADR's Option A deferral or authorize host handoff by itself.

## Decision

Choose Option A now:

> Keep Phase 2 evidence review CLI/markdown/JSON-only in SCI, with no Pi/operator-workbench handoff and no SCI-rendered UI, until `semantic-code-intelligence.evidence_review.v1` can represent the conceptual claim model and evidence absence states.

Specifically:

1. SCI continues to own only the read-only summary producer and existing markdown/JSON output.
2. Option B, a Pi/operator-workbench handoff packet, is deferred.
3. Option C, SCI-owned rendering/dashboard/UI, is rejected for this decision.
4. Evidence-review contract/schema implementation changes are deferred until a later accepted implementation wave.
5. AK decisions `46` and `47` remain superseded and cannot be cited as evidence for this ADR.

## Non-decisions

This ADR does not authorize:

- Pi/operator-workbench integration;
- UI rendering;
- schema implementation;
- host handoff;
- production readiness claims;
- accepting or advancing any AK decision lifecycle state;
- treating evidence-review output as canonical AK task/evidence authority.

## Reconsideration gates for Option B

A Pi/operator-workbench handoff packet may be reconsidered only after all of these are true:

1. `semantic-code-intelligence.evidence_review.v1` represents `ReviewClaim`, `EvidenceArtifact`, `Limitation`, `AuthorityBoundary`, and `OperatorDecisionPoint`.
2. `failed`, `unavailable`, `unknown`, and `inapplicable` evidence states are structurally distinct.
3. selected and recommended commands are structurally distinct.
4. at least one sample normalized JSON object proves the claim model.
5. read-only validation evidence shows rendering does not mutate source, snapshots, target repos, AK, or databases.
6. Pi/operator-workbench owner scope accepts a handoff request before any host work begins.

## Alternatives considered

### Option A — Keep evidence review CLI-only for now

SCI keeps the existing non-mutating summary producer and markdown/JSON output. No host handoff packet or UI work starts.

Chosen because the conceptual model was clear enough to block premature integration, but the JSON shape at acceptance time was not yet aligned enough to support host handoff.

### Option B — Prepare a Pi/operator-workbench handoff packet

SCI would author a non-mutating handoff packet for a future Pi/operator-workbench rendering surface.

Deferred because the schema did not yet represent the claim model and absence states at ADR acceptance time. Handoff without later schema evidence and host-owner acceptance would risk exporting an unstable or semantically incomplete contract.

### Option C — Implement rendering in SCI

SCI would build the rendered review surface directly.

Rejected for this decision because SCI-owned rendering would violate the current source-owner boundary, risk creating a false authority surface, and pull SCI toward product/UI ownership before the evidence schema is stable.

## Consequences

Positive:

- Prevents another authority-overreach cycle.
- Keeps SCI inside its current ownership boundary.
- Preserves the existing useful CLI/markdown/JSON summary path.
- Makes the next implementation target clear: align `evidence_review.v1` with the claim model before handoff.

Trade-offs:

- Operators still do not get a dedicated Pi/operator-workbench panel.
- The evidence-review JSON required later implementation evidence before it could be treated as schema-ready.
- Even after schema-readiness work, host integration still requires explicit owner acceptance before it can be reconsidered.

## Rollback and revisit

Rollback for this accepted ADR requires a later explicit superseding ADR or accepted governance action. Do not silently broaden or reinterpret this ADR into host handoff, UI rendering, schema implementation, production readiness, or AK decision lifecycle authority.

Revisit when:

1. `evidence_review.v1` represents the claim model and absence states;
2. sample normalized JSON proves the model;
3. read-only validation confirms no source, snapshot, target repo, AK, or DB mutation;
4. a host owner explicitly requests or accepts a handoff review.

## Validation evidence

Observed review-time checks from IW60/IW61:

```bash
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
git diff --check
ak direction check --repo . --machine
```

Observed result:

- markdown summary rendered successfully;
- JSON summary rendered successfully with schema `semantic-code-intelligence.evidence_review.v1`;
- selected and recommended commands remained distinct in rendered JSON;
- working tree stayed clean apart from intentional docs edits;
- docs strict, diff check, and direction check passed.

## Follow-up

IW64 begins aligning `semantic-code-intelligence.evidence_review.v1` with the conceptual claim model by adding first-class evidence artifacts, claims, authority boundaries, and operator decision points to the summary output. IW65 adds regression coverage for that model, IW66 wires the claim-model test into the alpha validation surface, IW67 adds `tests/fixtures/evidence-review-claim-model-sample.json` as a committed normalized sample, IW68 adds read-only boundary regression coverage for the summary renderer, and IW69 defines durable vs ephemeral snapshot evidence semantics in `docs/project/durable-snapshot-evidence-boundary.md`. Later hardening keeps local validation execution from being treated as `authority_durable` without AK evidence or an explicit command transcript, requires selected-command evidence before supporting selected-check claims, consumes distinct execution evidence entries for duplicate selected command strings, makes command-level selected-check failures contradict aggregate clean-pass claims, keeps structural command-distinction support separate from unavailable validation execution, keeps alpha packet bundle gates distinct from selected-command execution, preserves embedded apply posture when rendering packet-level evidence, keeps absent graph evidence visible as a first-class limitation, enforces limitation reference integrity, neutralizes markdown-forgery and inline-markdown text, refuses oversized evidence input before parsing including post-open growth, contains summary inputs to workspace-contained regular JSON files with path-escape, symlink-escape, TOCTOU replacement/mutation, missing/unreadable, non-regular input refusal, and fd-link fallback, validates missing/unsupported CLI options before input parsing, supports validationPlan extraction for every supported evidence input kind that embeds one, keeps the committed normalized sample fixture matched to current output, and sanitizes CLI errors so unsupported schemas, malformed JSON, unsupported formats, and unsupported extract modes do not expose stack traces, source paths, or reflected caller-controlled text. Handoff or UI work remains blocked until all reconsideration gates above are satisfied, including Pi/operator-workbench owner scope acceptance.
