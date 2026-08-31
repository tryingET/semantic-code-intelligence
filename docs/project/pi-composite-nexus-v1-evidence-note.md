---
summary: "Bounded source and incident evidence for Pi Composite NEXUS v1."
read_when:
  - "You are reviewing the evidence supporting decision 145."
type: "evidence-note"
---

# Pi Composite NEXUS v1 evidence note

Date: 2026-08-31
Decision: AK `145`

## Observed incident

Pi session `019fe323-e3ee-72ba-93ca-ba88e19182cf` was rooted at
`softwareco/owned/local-ai-control-plane` while the operator task targeted
`softwareco/infra/workstation`.

The preceding explore call supplied a workstation-relative-looking path. It was interpreted against
the Pi session root, returned indeterminate with no usable evidence and thrown subcalls, then
recommended locate. A later absolute workstation path was correctly rejected by the Pi companion.

Session inventory was structurally complete when audited (version 3, no malformed lines). The live
peer supplied the bounded causal trace. Session history remains observation, not AK authority.

## Source evidence

- Pi binds workflow execution to `ctx.cwd`: companion `src/extension.ts`.
- The bridge launches MCP with `SEMANTIC_CODE_WORKSPACE` and `WORKSPACE_ROOT`: companion
  `src/mcp-bridge.ts`.
- SCI resolves paths against that configured root: `src/core/workspace-path.ts`.
- Explore prescribes locate for all no-definition packets: `src/core/workflows/symbol-workflow.ts`.
- The companion rejects obvious absolute paths before execution: companion
  `src/sci-error-projection.ts`.
- Snapshot staging mutates `snap.diffs`, while checks/apply use separately acquired leases:
  `src/core/overlay-store.ts`.

## Independent review evidence

- producer implementation map: `dispatch-1788138779636`;
- security/threat review: `dispatch-1788139168905`;
- Pi companion map: `dispatch-1788139678998`;
- completion-boundary review: `dispatch-1788140013928`.

The durable synthesis is [`pi-composite-nexus-v1-review.md`](pi-composite-nexus-v1-review.md).

## Proof limits

No implementation or runtime behavior is claimed by this note. The snapshot race is source-proven
but still requires a deterministic regression test. The proposed references are not authentication,
signatures, or evidence authority.
