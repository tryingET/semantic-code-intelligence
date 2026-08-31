---
summary: "Independent architecture and security review synthesis for Pi Composite NEXUS v1."
read_when:
  - "You are reviewing or implementing the Pi Composite NEXUS v1 RFC."
type: "review"
---

# Pi Composite NEXUS v1 review synthesis

Date: 2026-08-31
Task: AK `5230`
RFC: [`pi-composite-nexus-v1-rfc.md`](pi-composite-nexus-v1-rfc.md)

## Review provenance

This synthesis records two independent read-only reviews dispatched before implementation:

- producer/root-cause and threat review: `dispatch-1788139168905`;
- product/compatibility/completion-boundary review: `dispatch-1788140013928`.

A separate producer surface map (`dispatch-1788138779636`) and Pi companion map
(`dispatch-1788139678998`) supplied implementation inventory. Dispatch output is session evidence,
not durable authority by itself; this checked-in synthesis is the reviewed architecture artifact.

## Outcome

**ACCEPT WITH BLOCKING CONDITIONS.**

The proposed intervention is the correct foundation if it remains a one-workspace identity and
lineage contract rather than becoming a root-selection capability. Implementation must satisfy the
blockers below before claiming completion.

## Blocking findings

### 1. Preserve containment and prohibit implicit rebinding

Consequence: critical. Confidence: high.

Cross-workspace absolute paths, path-derived root discovery, and dynamic root switching would bypass
session-loaded instructions, state partitioning, and owner boundaries. The server must mint a
reference only for its already configured workspace. Clients may echo identity but cannot map it to
a root.

### 2. Close mutable snapshot stage/check/apply races

Consequence: critical. Confidence: high.

Current staging appends to snapshot diffs without the usage lease used by checks and apply. A check
can therefore describe one mutable snapshot head while a later apply consumes another under the
same UUID. Workspace identity alone does not fix this. Revision-exact compare-and-swap staging,
immutable revision evidence, and exact check/apply receipts are mandatory.

### 3. Do not convert file-context failure into semantic escalation

Consequence: high. Confidence: high.

`explore_symbol_impact` currently recommends fileless locate for both genuine unconfirmed searches
and indeterminate failed evidence. With a wrong-root relative path, the recovery can confirm an
unrelated same-named symbol in the current repository. All-zero file-context failures must return
context repair, not locate.

### 4. Bind navigation to one observed state

Consequence: high. Confidence: high.

Explore and locate read live state. NEXUS may use a verified pre/post workspace-state digest for the
trusted local profile, but it must return no actionable result on drift. It must not label that
receipt an immutable snapshot or durable replay handle.

### 5. Bind repository authority, not only physical containment

Consequence: high. Confidence: high.

A nested repository can be physically beneath the configured root and still represent another owner
surface. Repository mode must reject paths crossing a nested `.git` boundary. An explicitly selected
nested repository receives its own target-root binding.

### 6. Keep compatibility additive for one wave

Consequence: high. Confidence: high.

The private Pi companion compares schemas at connection time and has strict result validators.
Replacing raw fields in place can prevent startup. Producer refs must land first as additive fields;
the companion then adopts and requires them for its native profile. Legacy direct surfaces remain
truthfully non-NEXUS until a later major contract.

### 7. Quarantine legacy snapshots

Consequence: high. Confidence: high.

Metadata without workspace/revision identity cannot be silently adopted into v1. It may be inspected
under an explicitly selected current root, but staging, check-evidence claims, and apply require a
fresh v1 snapshot.

## Accepted design choices

- producer-minted, persisted opaque workspace ID;
- internal canonical root and device/inode binding, never publicly disclosed;
- references are identifiers, not bearer authorization;
- no HMAC under the trusted same-user threat model;
- repo-relative model inputs remain ergonomic while the Pi bridge injects the bound identity;
- workspace-state digest for navigation, revision-exact snapshot refs for mutation/check/apply;
- four Pi doors continue to route to five producer workflows;
- no automatic root inference, reconnect, or newest-snapshot selection.

## Required proof before completion

1. Wrong-root A/B regression with same-named symbol: no false confirmation and no locate recovery.
2. Workspace binding restart, tamper, symlink, root-identity, and nested-repo tests.
3. Deterministic stage/check/apply interleaving and stale-ref tests.
4. Navigation state-drift fail-closed test.
5. Legacy snapshot inspection-only test.
6. Cross-interface producer parity and strict Pi consumer schema/validator tests.
7. Canonical Alpha, production-candidate, companion CI/dogfood, reinstall, and fresh live Pi calls.

## Explicit non-claims

Acceptance does not authorize hosted/multi-user operation, public companion distribution, a global
workspace registry, cross-repo semantic composition, AK/evidence promotion, or replacement of every
legacy raw path in SCI.
