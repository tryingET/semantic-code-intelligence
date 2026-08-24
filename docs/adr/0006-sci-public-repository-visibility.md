---
summary: "ADR-0006: Accept decision-133 public visibility of the SCI repository and supersede ADR-0005's private-channel binding."
read_when:
  - "You need the current SCI repository visibility and distribution-channel authority."
  - "You are changing release visibility, support-boundary, or public-use claims."
type: "adr"
system4d:
  container: "Repository visibility and the already-published 2.1.0-rc.1 release channel."
  compass: "An explicit accepted decision beats leftover private-only wording."
  engine: "AK decision 133 plus verified public GitHub repository state."
  fog: "Public availability is not support; untrusted callers, npm, and new releases remain unauthorized."
---

# ADR 0006 — Public SCI repository visibility (AK decision 133)

- Status: Accepted (2026-08-24)
- Authority: AK decision 133 (`accepted`, Option A; `unblocked`). This tracked record
  promotes the decision-time ADR; AK remains the authority of record.
- Supersedes: ADR 0005 private single-recipient channel binding for the existing
  `2.1.0-rc.1` GitHub Release. ADR 0004 remains the support-boundary authority.

## Context

SCI `2.1.0-rc.1` was frozen, privately released, then the operator accepted making
`tryingET/semantic-code-intelligence` public so external LLMs and agents can read it.
ADR 0005 had bound that release to a private single-recipient channel and required a
new decision for public visibility. Decision 133 is that decision. Execution
(AK-4942) flipped visibility; the repo is public.

## Decision

| Dimension | Binding |
|---|---|
| Visibility | Public GitHub repository `tryingET/semantic-code-intelligence` |
| What is public | Source, full git history, docs, workflows, tag `v2.1.0-rc.1`, and the existing rc.1 Release including `semantic-code-intelligence-2.1.0-rc.1.tgz` (SHA-256 `afbda42999edc3e7cd54eba6d2273b7e00f71c41980be9d3a391c8caa3c973db`) |
| Supersession | ADR 0005's private-channel binding is superseded for that existing release |
| Support | Unchanged ADR 0004: installed CLI + MCP stdio, one trusted operator/repository, best-effort, no SLA. Public availability is not support |
| Not authorized | npm publication; new releases; hosted/multi-tenant use; a support or issue-response obligation |
| License | Apache-2.0 unchanged |
| Irreversibility | Reverting visibility later does not retract clones, forks, or already-downloaded assets |

## Consequences

- Treat leftover "private channel only" wording in ADR 0005 as historical for the
  published rc.1 asset; this record is current channel authority.
- Do not infer production support, untrusted-repository readiness, or adoption
  claims from public visibility.
- `2.1.0-rc.2` remains a separate candidate identity until its own freeze and
  distribution decision.

## References

- AK decision 133; tasks 4938 (decision), 4942 (execution); evidence 7487, 7506–7508
- ADR 0004 — local single-user production candidate
- ADR 0005 — prior private self-distribution binding (superseded in channel only)
