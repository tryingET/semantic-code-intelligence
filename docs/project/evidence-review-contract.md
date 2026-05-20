---
summary: "IW53 minimal operator-facing evidence review contract for Phase 2 planning."
read_when:
  - "You are designing or implementing the Phase 2 evidence review surface."
  - "You need required fields, sections, sample inputs, validation checks, or non-goals for evidence review."
  - "You are changing validationPlan, alpha evidence packets, or operator review output."
type: "contract"
---

# Evidence review contract

Date: 2026-05-19  
Wave: IW53 — Evidence review contract design  
Status: contract accepted for planning; IW54 adds a non-mutating summary prototype

## Purpose

The Phase 2 evidence review surface must help a human operator inspect and steer a harnessed-LLM coding session without weakening the closed Phase 1 Alpha substrate.

The surface is a **review contract**, not a new source of authority. It consumes existing SCI evidence and presents it clearly. It must not silently select commands, apply patches, mutate source, or store canonical task/evidence state.

## Target rendering surface

Initial target rendering surface:

> A Pi/operator-workbench evidence review panel or equivalent lightweight markdown/web view rendered from a JSON summary.

This contract deliberately avoids committing to a VS Code extension or full dashboard. A later implementation may choose a concrete renderer, but it must preserve this information contract first.

## Required input artifacts

A compliant review surface must accept at least one of these inputs:

1. `.test-results/alpha-evidence-packet.json` for bundle-level review;
2. a single `validationPlan` object from `patch_checks_in_snapshot`, `safe_write`, or related preview/check workflows;
3. optional companion graph/check evidence:
   - `impactSummary` from `graph_expand`;
   - `checkRecommendations` from `recommend_checks`;
   - snapshot artifact links (`overlay.diff`, `status`, `progress`);
   - safe-write verification/rollback evidence when present.

The surface may accept richer future inputs, but these existing Phase 1 artifacts are the compatibility baseline. The SCI-owned CLI summary producer accepts evidence through workspace-contained regular JSON files only; lexical path escapes, symlink escapes, same-path replacement or mutation between preflight/open/read, non-regular inputs, unreadable inputs, and oversized inputs must fail closed before parsing.

## Required review sections

A compliant evidence review must render these sections in this order.

### 1. Outcome banner

Required fields:

- overall `ok` / status;
- workflow name or evidence packet schema;
- whether this is preview-only or applied evidence;
- explicit Alpha/production boundary text.

Required operator question:

> Is this evidence enough to continue, or should the operator stop and inspect details?

### 2. Changed or affected scope

Required fields where available:

- touched files;
- target repo label/cwd model for target dogfood;
- graph seed (`file` or `symbol`);
- risk category/level;
- source kind/language when known.

### 3. Validation commands

Required fields:

- selected commands that actually ran;
- recommended minimum commands;
- recommended broader commands;
- `recommendationsAppliedToSelected` value;
- rationale for recommendations.

Hard rule:

> Selected commands and recommended commands must be visually distinct. Recommendations are advisory and must not appear as if they were executed unless they were actually selected. Bundle-level gate success must not be rendered as selected-command execution evidence unless selected command check results are present.

### 4. Check results

Required fields:

- check `ok`;
- elapsed time where present;
- command list/status when present;
- timeout/failure status when present.

Required operator question:

> Did the executed checks match the risk of the change?

### 5. Graph and impact evidence

Required fields:

- requested edges;
- edge counts/status;
- limitations/fallback notes;
- caller context count when present;
- planning hints.

Hard rule:

> Empty or fallback-shaped graph evidence must be shown as a limitation, not hidden behind a green check.

### 6. Snapshot and artifacts

Required fields:

- snapshot id or stable artifact links;
- `overlay.diff` link;
- status/progress links where present;
- apply guard posture;
- rollback command or rollback absence.

Hard rule:

> A preview/check result must remain visibly preview-only unless apply evidence proves otherwise.

### 7. Safety and authority boundary

Required fields/text:

- whether source was mutated;
- whether rollback evidence exists;
- whether target workspace status was preserved for external dogfood;
- reminder that AK remains task/evidence authority where registered;
- reminder that Alpha evidence is not production readiness.

## Minimal normalized shape

Implementations may normalize input into this shape before rendering:

```json
{
  "schema": "semantic-code-intelligence.evidence_review.v1",
  "source": {
    "kind": "alpha_packet | validation_plan | target_dogfood",
    "schema": "semantic-code-intelligence.validation_plan.v1",
    "workflow": "patch_checks_in_snapshot"
  },
  "evidenceArtifacts": [
    {
      "id": "validation-execution",
      "kind": "validation_execution",
      "schema": null,
      "observedStatus": "observed | failed | unavailable | unknown | inapplicable",
      "durability": "ephemeral | reproducible_local | materialized_local | repo_durable | authority_durable",
      "uriOrPath": null,
      "citationRequirement": "cite AK evidence id or explicit command transcript when available; local summary output alone is not authority-durable evidence"
    }
  ],
  "limitations": [
    {
      "id": "graph-impact-limitation-1",
      "limitation": "fallback: graph expand unavailable",
      "sourceArtifact": "graph-impact",
      "affectsClaims": ["graph-limitations"],
      "affectsDecisionPoints": ["continue-or-stop"],
      "severity": "warning"
    }
  ],
  "claims": [
    {
      "id": "checks-result",
      "claim": "Selected validation checks passed.",
      "status": "supported | weakened | contradicted | unresolved",
      "supportedBy": ["validation-execution"],
      "limitedBy": [],
      "warrant": "Executed command evidence, not recommendation text, determines this claim; check success without selected command evidence is not enough.",
      "authorityBoundaries": ["not-production-readiness"],
      "operatorDecisionPoints": ["continue-or-stop"]
    }
  ],
  "authorityBoundaries": [
    {
      "id": "not-production-readiness",
      "boundary": "Alpha evidence is not production readiness.",
      "affectedScope": "readiness"
    }
  ],
  "operatorDecisionPoints": [
    {
      "id": "continue-or-stop",
      "options": ["continue", "stop", "inspect limitations"],
      "supportingClaims": ["checks-result"],
      "limitingClaims": [],
      "residualUncertainty": "Recommended commands remain advisory unless executed."
    }
  ],
  "outcome": {
    "ok": true,
    "status": "checks_passed",
    "previewOnly": true,
    "applied": false,
    "productionReady": false
  },
  "scope": {
    "touchedFiles": ["src/example.ts"],
    "risk": { "level": "low", "category": "source_change" },
    "target": { "label": "repo", "cleanAfter": true }
  },
  "commands": {
    "selected": ["true"],
    "recommendedMinimum": ["bun run typecheck"],
    "recommendedBroader": ["bun run typecheck"],
    "recommendationsAppliedToSelected": false,
    "rationale": []
  },
  "checks": {
    "ok": true,
    "elapsedMs": 206
  },
  "graphImpact": {
    "hasImpactEvidence": false,
    "counts": { "imports": 0, "exports": 0, "callers": 0, "callees": 0 },
    "limitations": ["fallback: graph expand unavailable"],
    "planningHints": []
  },
  "artifacts": {
    "overlayDiff": "snapshot://.../overlay.diff",
    "status": "snapshot://.../status",
    "progress": "snapshot://.../progress"
  },
  "rollback": {
    "available": false,
    "command": null
  },
  "operatorQuestions": []
}
```

The first-class `evidenceArtifacts`, `limitations`, `claims`, `authorityBoundaries`, and `operatorDecisionPoints` fields are required to prevent the review from collapsing artifacts into claims, claims into authority, limitations into green status, bundle gates into selected-command execution, or recommendations into executed commands. `ReviewClaim.limitedBy` must reference `limitations[].id` values, not artifact IDs. Evidence artifacts also carry durability and citation requirements so `snapshot://` pointers are not mistaken for durable proof. Markdown renderers must neutralize caller-controlled evidence text so limitation strings cannot forge headings, status banners, inline markdown emphasis/links, or completion claims. CLI error paths must use sanitized messages rather than runtime stack traces or reflected caller-controlled values.

## Validation checks for an implementation wave

Any implementation of this contract must validate:

1. rendering from `.test-results/alpha-evidence-packet.json` succeeds without workspace mutation;
2. rendering from a standalone `validationPlan` sample succeeds;
3. selected vs recommended commands are distinct in output;
4. graph limitations/fallback notes are visible;
5. preview/apply posture is visible;
6. rollback absence/presence is visible;
7. production-readiness caveat is visible;
8. untrusted evidence text cannot forge markdown headings/status or inline emphasis/link claims;
9. alpha packet bundle gates remain distinct from selected-command execution evidence;
10. oversized evidence inputs fail closed before parsing;
11. path escapes, symlink escapes, TOCTOU replacement/mutation, missing/unreadable inputs, and non-regular evidence inputs fail closed without leaking input contents;
12. unsupported schemas, malformed JSON, unsupported formats, and unsupported extract modes fail with sanitized errors that do not expose stacks, source paths, or reflected caller-controlled text;
13. docs strict and direction check pass;
14. if runtime contracts change, `bun run alpha:mvp:check` still passes.

## Non-goals

This contract does not authorize:

- a VS Code extension;
- a full dashboard;
- a durable metrics platform;
- a canonical task/evidence database inside SCI;
- automatic validation command selection;
- new apply semantics;
- production SLO claims;
- graph accuracy claims beyond the evidence shown.

## Next executable wave

Recommended next wave:

**Explicit Phase 2 integration review**

IW54 implements the first non-mutating summary producer:

```bash
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --format markdown
bun run evidence-review:summary -- --input .test-results/alpha-evidence-packet.json --extract validationPlan --format json
```

Decision `47` was superseded after the operator rejected unilateral AK decision lifecycle advancement. Any future integration with Pi/operator-workbench must go through an explicit review/handoff path, not an agent-manufactured accepted decision.
