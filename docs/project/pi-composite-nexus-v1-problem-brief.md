---
summary: "Problem framing for Pi Composite NEXUS v1."
read_when:
  - "You are reviewing decision 145 or implementing workspace-bound SCI composite references."
type: "problem-brief"
---

# Pi Composite NEXUS v1 problem brief

Date: 2026-08-31
Decision: AK `145`
Task: AK `5230`

## Problem

SCI interprets repo-relative path strings through an ambient configured workspace that is absent
from five producer workflow request, result, recovery, snapshot, and evidence contracts consumed by
the private Pi companion. A target-repo-relative path can therefore be syntactically valid but bound
to the wrong Pi session root.

The current explore recovery compounds this ambiguity: all no-definition packets, including
indeterminate all-zero file-context failures, prescribe fileless locate in the same ambient
workspace. That can confirm an unrelated same-named symbol in the wrong repository.

Snapshot UUIDs add a second lineage ambiguity. Staging mutates a snapshot head independently of the
leases used by checks and apply, so one UUID can denote different overlay bytes across the
stage/check/apply sequence.

## Required outcome

Make workspace and snapshot lineage explicit without allowing clients to select roots:

- one server-minted workspace identity per process/session;
- bound paths and recovery edges;
- stable-state navigation receipts;
- revision-exact checked snapshot references;
- private Pi injection and validation;
- no automatic cross-repo rebinding.

## Non-goals

No hosted/multi-user operation, global workspace registry, cross-repo semantic composition, public
Pi-companion distribution, or claim that all legacy SCI paths are replaced.
