---
summary: "ADR-0005: Accept decision-130 narrow private self-distribution of SCI 2.1.0-rc.1."
read_when:
  - "You need the accepted SCI 2.1.0-rc.1 distribution channel and its bindings."
  - "You are changing release visibility, channel, or support-boundary claims."
type: "adr"
system4d:
  container: "Distribution authority for the frozen 2.1.0-rc.1 candidate."
  compass: "An explicit accepted decision beats an implicit distribution habit."
  engine: "AK decision 130 bindings plus verified tag/release execution receipts."
  fog: "Private single-recipient channel only; broader visibility requires a new decision and is not authorized here."
---

# ADR 0005 — SCI 2.1.0-rc.1 private self-distribution (AK decision 130)

- Status: Accepted (2026-08-24)
- Authority: AK decision 130 (`accepted`, Option A; `unblocked`). This tracked record promotes
  the decision-time ADR for durable in-repo reference; AK remains the authority of record.
- Supersedes: none. Extends ADR 0004 (local single-user production candidate), which continues
  to define the support boundary.

## Context

SCI `2.1.0-rc.1` was frozen (AK-4898) at commit `5e99a90c03173707e5562ce5e89169123a6fad6b`
(archive SHA-256 `afbda42999edc3e7cd54eba6d2273b7e00f71c41980be9d3a391c8caa3c973db`,
payload digest `9a2ec94d1697b31b0b6bd7e77312589684819469e88fa5e7f41a2f3861a5dba5`,
14 entries), landed on `origin/main`, and locally re-validated (AK-4899). Remote CI never
executed — a zero-step GitHub billing failure retained as an accepted advisory gap; local
validation is reduced assurance versus an independent GitHub-hosted runner.

Distribution required an explicit decision: ADR 0004 authorizes a local single-user
candidate but no distribution channel.

## Decision

Accept narrow self-distribution under these bindings:

| Dimension | Binding |
|---|---|
| Release owner | tryingET (single accountable operator) |
| Audience | The same single trusted operator; no third party |
| Channel | Private GitHub Release on `tryingET/semantic-code-intelligence` with the exact frozen tarball; annotated tag `v2.1.0-rc.1` referencing this decision; no npm, public registry, or mirrors |
| Support policy | ADR 0004 boundary: best-effort, installed CLI + MCP stdio only; no SLA, hosted, or deployment support |
| Authenticity | SHA-256 `afbda429…` published in the decision record and verified by the recipient at install; no signing infrastructure claimed |
| Rollback | Uninstall per bundled README; reinstall prior artifact or rebuild from `5e99a90c…`; `.ontology` runtime state retained per docs |
| Incident boundary | Single workstation/user; the channel is transport only, not a supported interface |

Review: `ready_for_adr`, no blockers (dispatch-1787551093396). Execution: AK-4915 published
tag object `eb6343e878df40d20cdb3f769ff015444550159c` (dereferencing to the frozen commit)
and one non-draft private Release with exactly the frozen asset; independently verified
ACCEPT (dispatch-1787552400416) with all bindings exact and zero unrequested effects.

## Consequences

- `2.1.0-rc.1` is distributable only through this single-recipient private channel.
- Distribution beyond it — npm, public registries, mirrors, third parties, or public repo
  visibility — requires a new decision; it is not authorized by this record.
- Any new tracked bytes after the freeze require a new candidate version; the frozen
  binding is immutable.
- The remote-CI advisory gap (billing-blocked, never executed, never claimed green) travels
  with this release's evidence posture.

## References

- AK decision 130; tasks 4903 (decision), 4915 (execution); evidence 7421, 7435–7447
- ADR 0004 — local single-user production candidate
- RFC and decision-time ADR: `.test-results/distribution-decision/` (workflow scratch; AK is authority)
