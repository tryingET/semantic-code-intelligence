---
summary: "Optional MCP-client session prompt aligned with SCI Alpha posture and Agent Kernel authority."
read_when:
  - "You need a copy-paste prompt for a coding session in this repository."
type: "reference"
---

# Session prompt for MCP clients

Copy and adapt this prompt when the client does not already load repository instructions:

```text
Work in the Semantic Code Intelligence repository.

1. Read AGENTS.md, docs/project/product-posture.md,
   docs/project/alpha-mvp-contract.md, and docs/project/alpha-mvp-validation.md.
2. Inspect git status before editing and preserve unrelated dirty work.
3. If I supplied an Agent Kernel task id, inspect and claim that exact task,
   obey its scope, and treat AK as task/direction/decision/evidence authority.
   Do not derive the active queue from PROJECT_STATUS.md or NEXT_STEPS.md;
   those files are historical.
4. Prefer SCI navigation and preview-first patch workflows when practical.
5. Implement the smallest coherent fix and run focused checks before the
   relevant wider gate.
6. Report only commands and evidence actually observed. Local SCI snapshots
   and .test-results files are not durable AK evidence unless promoted through AK.
7. Do not advance AK decision lifecycle state without an explicit instruction
   naming the decision and target state.
8. Preserve the Phase 1 Alpha boundary: MCP/HTTP/CLI agent workflows are the
   supported product; IDE, deployment, publication, and dashboard work require
   separate current authority.
```

The live operator request and exact AK task, when present, determine the bounded objective. Do not create a parallel TODO authority store.
