---
summary: "ADR-0007: Adopt workspace-bound references and revision-exact snapshot lineage for SCI's private Pi composite profile."
read_when:
  - "You are changing workspace/path identity, composite recovery, or snapshot check/apply lineage."
  - "You are changing the private Pi SCI companion contract."
type: "adr"
system4d:
  container: "Trusted local single-user SCI producer and private Pi companion."
  compass: "Make workspace and reviewed state explicit without granting root-selection authority."
  engine: "Persisted workspace identity, bound paths/state, immutable snapshot revisions, and Pi injection."
  fog: "References are lineage identifiers, not authentication, evidence authority, or multi-workspace permission."
---

# ADR-0007: Adopt Pi Composite NEXUS v1

Status: Accepted
Date: 2026-08-31
Decision: AK `145`
Task: AK `5230`
RFC: [`pi-composite-nexus-v1-rfc.md`](../project/pi-composite-nexus-v1-rfc.md)
Review: [`pi-composite-nexus-v1-review-synthesis.md`](../project/pi-composite-nexus-v1-review-synthesis.md)

## Context

SCI's private Pi composite corridor currently gives repo-relative path strings meaning through an
ambient Pi session/MCP workspace. A wrong-root relative path can fail as indeterminate evidence and
then trigger a broader fileless locate in the same wrong repository. Snapshot UUIDs also identify
mutable heads, allowing staged bytes to change between check and apply.

Existing lexical, realpath, symlink, and opened-file containment is correct and must remain. The
missing primitive is explicit workspace and reviewed-state lineage.

## Decision

Adopt **Pi Composite NEXUS v1** with this bounded scope:

- one server-minted persisted opaque workspace identity for the configured trusted-local workspace;
- workspace-bound machine path references and recovery arguments;
- pre/post workspace-state receipts for explore and locate;
- revision-exact immutable snapshot references for rename, patch/structural checks, artifacts, and
  check/apply lineage;
- compare-and-swap staging under cross-process exclusion;
- private Pi handshake, injection, validation, and immutable session-root binding;
- additive compatibility for legacy direct clients during one migration wave.

A workspace reference is an identity and lineage assertion. It does not authorize a client to map or
select a root. Automatic root inference, cross-workspace absolute paths, dynamic rebinding, and
newest-snapshot selection are prohibited.

This decision narrowly supersedes ADR-0004's no-new-persistence consequence only for contained local
workspace-binding and snapshot-revision metadata. It does not create a durable session/evidence
database or authority surface.

## Consequences

Positive:

- wrong-root path meaning becomes observable and fail-closed;
- indeterminate file-context failures cannot escalate into unrelated symbol confirmation;
- paths, recoveries, artifacts, checks, and apply evidence share one workspace identity;
- checked overlay bytes cannot silently change before apply;
- the foundation supports later target-root orchestration and federated evidence without weakening
  repository containment.

Trade-offs:

- moving, copying, or replacing a bound workspace initially fails closed until a later explicit
  rebind/migration design exists;
- local `.ontology/nexus` identity/revision metadata is added;
- schemas and strict Pi validators require coordinated producer-first rollout;
- legacy direct surfaces remain explicitly non-NEXUS until later migration.

## Security and authority boundary

The threat model remains one trusted local OS user and trusted repositories. IDs and digests are not
signatures or bearer capabilities. Existing containment and apply guards remain mandatory. Hosted,
network, multi-user, hostile same-UID tampering, global registries, cross-repo root selection, AK
authority, and public companion distribution remain unauthorized.

## Validation

Acceptance requires the validation ladder in
[`pi-composite-nexus-v1-validation-rollout-rollback.md`](../project/pi-composite-nexus-v1-validation-rollout-rollback.md),
including deterministic stage/check/apply races, wrong-root same-symbol recovery, state drift,
nested repository, restart/tamper, legacy quarantine, cross-interface, packaged candidate, and live
installed-Pi proof.

## Rollback

Disable the private Pi NEXUS profile and revert additive producer fields while preserving
containment. Keep any created NEXUS metadata inert or remove only proven generated state with the
producer stopped. Never roll back by enabling ambient cross-workspace access or silently rewriting
legacy snapshots.

## Not authorized

- replacement of every legacy SCI raw path;
- LSP or broad HTTP migration;
- multi-workspace, multi-user, hosted, or public service support;
- global workspace registry or automatic root discovery;
- relocation/rebind UX;
- public Pi-companion publication;
- cross-repo semantic composition;
- new evidence, approval, or governance authority.
