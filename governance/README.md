---
summary: "Governance for semantic-code-intelligence: the Agent Kernel DB is the sole work authority; the work-items projection is retired."
read_when:
  - "You are looking for deferred or active work for semantic-code-intelligence."
  - "You are tempted to reintroduce a checked-in governance/work-items.json projection."
type: "reference"
---

# Governance — semantic-code-intelligence

Deferred and active work for this repo lives in the **Agent Kernel DB** (`ak task ...`).
The AK DB is the sole work authority; no checked-in work-items projection exists or should be reintroduced.

The retired `governance/work-items.cue` schema had no checked-in `work-items.json` instance and carried no work items; nothing was lost at retirement.

## Optional explicit task-scope snapshots

When an AK task for this repo needs explicit scope:

- author/update the scope in AK via `ak task scope show|set|update ...`
- keep repo-side copies under `governance/task-scopes/AK-<TASK-ID>.snapshot.json` as frozen exports
- refresh a checked-in snapshot with `mkdir -p governance/task-scopes && ak task scope export <TASK-ID> > governance/task-scopes/AK-<TASK-ID>.snapshot.json`
- reconcile checked-in snapshots against live AK with `./scripts/check-task-scope-snapshots.sh` before closeout
- use `./scripts/check-task-scope-snapshots.sh --offline` on generic CI runners to validate only the frozen export contract; offline success does not prove live AK reconciliation

## Non-negotiable

- Do not leave deferred work as ad-hoc TODO comments or scattered markdown notes.
- Do not reintroduce a checked-in `governance/work-items.json` projection; the AK DB is authoritative.
- Do not hand-author `governance/task-scopes/AK-*.snapshot.json` as if it were the live task-scope source of truth.
