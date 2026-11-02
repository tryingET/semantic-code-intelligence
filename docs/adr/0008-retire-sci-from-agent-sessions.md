---
summary: "ADR-0008: Retire SCI as deployed from agent sessions in stages; whether a repaired SCI would pay is not established, and no demonstrated benefit justifies funding repair."
read_when:
  - "You are deciding whether to use, repair, reinstall or extend SCI."
  - "You need the rollback path for the SCI retirement."
  - "You are changing SCI's product posture or its Pi companion."
type: "adr"
system4d:
  container: "SCI as deployed in Pi agent sessions on this workstation."
  compass: "Stop paying for a substrate that shows no benefit, without claiming more than was tested."
  engine: "Staged, separately authorized removal, each stage verified."
  fog: "The evidence covers SCI as deployed, not a repaired or redesigned tool."
---

# ADR-0008: Retire SCI from agent sessions

Status: Accepted
Date: 2026-11-02
Decision: AK `190`
Task: AK `8167`
RFC: [`retirement-from-agent-sessions-decision.md`](../project/retirement-from-agent-sessions-decision.md)
Inspections: [first](../project/retirement-decision-independent-review.md),
[cross-family](../project/retirement-reinspection-gpt-6-1-sol.md),
[third](../project/retirement-third-inspection.md)

## Context

SCI grew to about 117k lines under contract-conformance gates, with no gate on benefit against a
native baseline. Measured over 1,510 distinct calls in Pi sessions:

- 31.2% resolved the symbol, 34.8% were unconfirmed and 34.0% errored; since September about three in
  five calls errored.
- From September a device-pinned workspace binding (ADR-0007) failed after reboots, because `/home` is
  a btrfs subvolume whose `st_dev` changes. The Pi companion hid the reason.
- Up to about half of code file operations fall outside the session cwd, which SCI as deployed refuses.
- In a value sample no call was decisive. Across all resolved calls, 22 of 1,510 calls pointed the
  agent to a file new to its session, and a definition-shaped `rg` mostly gave the same.
- A small paired pilot (AK7925) did not overturn this. It was low-dose, and every arm edited the same
  source files.

## Decision

Retire SCI **as deployed** from agent sessions, in reversible, separately authorized stages. Code
context goes to native `read`/`rg`, the language's compiler or type checker, git worktrees plus repo
validation, and context-packer + Ripwire behind its own gate.

**Not decided.** Whether a repaired or redesigned SCI would pay for itself is **not established**: the
pilot tested neither a compiler-backed repair, nor several workspaces per session, nor hard navigation
tasks. No demonstrated benefit justifies funding repair on this evidence. Reopening needs a concrete
design and a paired pilot in which the treatment is verified per arm.

The operator set the portfolio rule (record §9) aside. The tool-written-state rule stays a proposal
under AK decision 191.

## What landed

| Stage | Change | AK |
|---|---|---|
| 1 | Pi companion removed from the operator's Pi settings | AK7928 |
| 2a | Machine-level `.ontology/` ignore, managed in dotfiles-managed | AK7932 |
| 2b | The softwareco meta repo stops tracking `.ontology/ontology.db*` | AK7935 |
| 3 | Posture says retired and frozen; SessionStart and Stop hooks and the composite-first policy removed | AK7938, AK8135, AK7949 |
| 4 | 59 `.ontology` directories archived with a proven restore, then deleted, on the operator's exception to the never-delete decision | AK7947 |
| — | Shell export, `PATH` entries and packaged runtime removed | AK7953 |

## Consequences

- This repository is frozen. New product work needs a new decision.
- ADR-0007 no longer describes a live surface. Its device-pinned binding stays unrepaired.
- Agents lose symbol lookup through SCI. A definition-shaped `rg` covers most of what was used.

## Rollback

Stage 1 is no longer one line. Restoring SCI in Pi needs the package entry in `~/.pi/agent/settings.json`
plus `SCI_MCP_COMMAND` pointing at a built source checkout's `bin/semantic-code-mcp`, or a reinstall.
Removed hooks and the policy section can be reverted by commit. The `.ontology` data is in
`~/.local/share/ai-society-retired/sci-ontology-2026-11-02/`, though a re-enabled SCI mints fresh
bindings and does not need it.

## Limits

- The closing inspection was a self-check by the session that corrected the record, chosen by the
  operator on a card. The cross-family inspection saw an earlier version.
- The pilot had n = 6 with one run per cell, and could not exclude a 20% reduction.
- The record says which figures were not re-inspected (attention counts, code size, footprint).

## Open

- dep-surgeon's `.ontology` stays until its owner session releases it (AK7947).
- The `sci` toolbox bundle stays dormant (AK7951).
- The uncommitted 2026-09-05 work in this repository still has no owner decision.
