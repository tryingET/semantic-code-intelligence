---
summary: "Design boundary for durable vs ephemeral SCI snapshot and evidence artifacts."
read_when:
  - "You are changing snapshot artifact URIs, rollback evidence, or evidence-review artifact handling."
  - "You need to decide whether an SCI artifact may be cited across process/session boundaries."
  - "You are working on AK task 3167 or durable evidence semantics."
type: "design"
---

# Durable snapshot evidence boundary

Date: 2026-05-19
Wave: IW69 — Durable snapshot evidence boundary design
Task: AK `3167` — Alpha maintenance: design durable snapshot evidence boundary
Status: design accepted for Alpha maintenance; no new storage layer authorized

## Purpose

Define how SCI should talk about snapshot and evidence artifacts across live sessions without accidentally creating a broad durable state layer.

The immediate trigger is Alpha maintenance: evidence review now exposes first-class claims, authority boundaries, operator decision points, and artifact references. Those references need clear durability semantics before future work treats them as citeable evidence.

## Authority boundary

This document is a design boundary for SCI artifacts. It does not create:

- a new canonical evidence database;
- a durable metrics platform;
- Pi/operator-workbench host integration;
- AK decision lifecycle authority;
- production-readiness claims.

AK remains task/evidence authority where registered. SCI may produce evidence artifacts and summaries, but AK records decide whether a command/result was attached to a task.

## Artifact classes

| Class | Meaning | Examples | Cross-session citation |
|---|---|---|---|
| Ephemeral runtime artifact | Exists only for a live process/session or temporary workspace | in-memory snapshot state, transient progress handle | Do not cite as durable evidence |
| Local file evidence | Materialized file in the repo/worktree or temp path | `.test-results/alpha-evidence-packet.json`, markdown/JSON summary output | Cite only with path, command, timestamp/context, and cleanliness caveat |
| Snapshot URI reference | Handle into SCI snapshot machinery | `snapshot://.../overlay.diff`, `snapshot://.../status`, `snapshot://.../progress` | Cite as a pointer, not proof, unless materialized or accompanied by command evidence |
| Validation execution evidence | Observed command/check result | `run_checks`, `safe_write`, evidence-review smoke command | Cite through AK evidence or explicit command transcript |
| Commit evidence | Git commit containing source/docs/tests | commit hash | Durable for repo history; cite normally |
| AK evidence record | Task-attached evidence in AK | evidence IDs such as `2711` | Canonical task evidence where repo is registered |

## Durability levels

SCI should use these levels in docs, evidence reviews, or future schema fields:

| Level | Name | Definition | Allowed claim |
|---|---|---|---|
| D0 | Ephemeral | Only valid during the originating process/session | "was available during preview" |
| D1 | Reproducible local | Can be regenerated from committed code and documented command | "can be reproduced by running this command" |
| D2 | Materialized local | Stored as a local file artifact with known path | "was materialized at this path in this workspace" |
| D3 | Repo durable | Committed into git history | "is part of repo history" |
| D4 | Authority durable | Recorded in AK or accepted governance surface | "is task/governance evidence" |

Default posture:

- `snapshot://` references are **D0** unless materialized.
- `.test-results/*` files are **D2** locally but not repo durable unless committed.
- committed fixtures/docs/tests are **D3**.
- AK evidence IDs are **D4** for task evidence, but they do not make SCI artifacts governance decisions.

## Citation rules

1. Do not cite `snapshot://...` alone as durable evidence.
2. When citing a snapshot URI, also cite one of:
   - a materialized diff/status file;
   - a command that regenerated the snapshot;
   - an AK evidence record that captured the command/result;
   - a commit containing a representative fixture.
3. Treat rollback evidence as absent unless a concrete rollback command or materialized inverse patch is present.
4. Treat preview evidence as preview-only unless apply evidence proves mutation occurred.
5. Treat generated `.test-results/*` as local evidence unless committed or attached to AK evidence.
6. Do not move generated evidence into repo history merely to make it authoritative; commit only stable fixtures, contracts, or intentionally curated samples.

## Evidence-review schema implication

Evidence reviews should eventually distinguish artifact durability from observed status:

```text
EvidenceArtifact
- id
- kind
- schema
- observedStatus: observed | failed | unavailable | unknown | inapplicable
- durability: ephemeral | reproducible_local | materialized_local | repo_durable | authority_durable
- uriOrPath
- citationRequirement
```

IW70 adds this distinction to the Alpha summary producer so `semantic-code-intelligence.evidence_review.v1` no longer overloads `observedStatus` with durability meaning.

## Rollback evidence requirements

A review may say rollback is available only when at least one is true:

1. a concrete rollback command is present;
2. an inverse patch is materialized;
3. the original file content or snapshot state is recoverable through a documented command;
4. the change is not applied and therefore no rollback is needed.

If none are true, rollback evidence must be `unavailable`, not silently omitted.

## AK relationship

AK evidence records may cite SCI artifacts, but SCI artifacts do not become AK evidence automatically.

Recommended AK details shape when recording SCI artifact evidence:

```json
{
  "command": "bun run evidence-review:summary -- --input ... --format json",
  "artifact": "tests/fixtures/evidence-review-claim-model-sample.json",
  "durability": "repo_durable",
  "citation_requirement": "commit hash plus command evidence",
  "authority_boundary": "SCI artifact is evidence input/output, not decision authority"
}
```

## Non-goals

This design does not implement:

- a snapshot registry;
- content-addressed artifact storage;
- cross-repo artifact replication;
- long-term retention policy;
- dashboard/host rendering;
- production evidence warehouse.

Those may require a later ADR if real workflows need them.

## Implementation guidance

Small acceptable follow-ups:

- add optional `durability` and `citationRequirement` fields to evidence-review artifacts;
- document `snapshot://` as ephemeral unless materialized;
- add tests ensuring rollback absence remains visible;
- add curated fixtures for stable sample output.

Avoid by default:

- introducing a new DB table for SCI evidence;
- storing every snapshot permanently;
- making generated `.test-results/*` authoritative;
- treating Pi session logs as evidence authority.

## Review outcome

The durable boundary is:

> SCI may produce and summarize evidence, but durability depends on materialization, commit history, or AK recording. Snapshot URIs alone are pointers, not durable proof.

This gives future work enough semantics to cite artifacts honestly without building a broad state layer.
