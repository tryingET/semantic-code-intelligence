---
summary: "Bounded implementation plan for Pi Composite NEXUS v1."
read_when:
  - "You are executing decision 145 after ADR acceptance."
type: "implementation-plan"
---

# Pi Composite NEXUS v1 implementation plan

Date: 2026-08-31
Decision: AK `145`

## Slice 1 — Workspace and reference primitives

Owner: `semantic-code-intelligence`.

Add producer-minted persisted workspace identity, bound path/state/snapshot reference validators,
current-workspace discovery, root identity freeze/recheck, repository-boundary checks, and structured
redacted errors. Characterize existing compatibility inputs before changing schemas.

## Slice 2 — Revision-exact snapshot lineage

Owner: `semantic-code-intelligence`.

Put staging under cross-process exclusion, add immutable revisions and digests, require exact refs for
NEXUS check/apply, persist exact check receipts, quarantine legacy unbound snapshots, and add
deterministic interleaving tests.

## Slice 3 — Five producer workflows

Owner: `semantic-code-intelligence`.

Bind explore, locate, rename, patch checks, and structural patch checks. Navigation verifies pre/post
workspace state. Indeterminate file-context failures stop without locate. Mutating workflows return
exact snapshot refs and bound artifact/evidence fields.

## Slice 4 — Private Pi companion

Owner: `pi-extensions/packages/pi-semantic-code-intelligence` through a separate AK task.

Obtain and pin the producer workspace ref, inject bound inputs behind model-facing relative paths,
validate results/recoveries/snapshot refs, prohibit root drift, update strict schema negotiation and
disclosure, and preserve four-door/five-workflow topology.

## Slice 5 — Integration and live proof

Run focused, canonical Alpha, packaged candidate, companion CI/dogfood, source install, fresh Pi
process, and real native composite calls. Record evidence through the owning AK tasks. Versioning and
distribution require separate authority.

## Dependency order

`Slice 1 -> Slice 2 -> Slice 3 -> Slice 4 -> Slice 5`.

The companion may develop against checked-in producer fixtures after Slice 1 contracts freeze, but
must not land ahead of compatible producer behavior.

## Anti-scope

No LSP migration, broad legacy primitive conversion, global registry, relocation UI, multi-root
bridge, hosted authorization, cross-repo graph, public companion release, or new evidence authority.
