---
summary: "Claude-compatible session guidance aligned with SCI's Agent Kernel and Alpha product posture."
read_when:
  - "You are starting a Claude or MCP-compatible coding session in this repository."
type: "reference"
---

# Claude session guidance

This file is loaded as plain Markdown project context alongside `AGENTS.md`. It does not override Agent Kernel authority or the repository’s current product contract.

## Read first

1. `AGENTS.md`
2. `docs/project/product-posture.md`
3. `docs/project/alpha-mvp-contract.md`
4. `docs/project/alpha-mvp-validation.md`
5. the exact AK task, decision, or direction record supplied by the operator

`PROJECT_STATUS.md`, `NEXT_STEPS.md`, old deployment guides, and old implementation plans are historical artifacts, not runtime work authority.

## Runtime authority

- Agent Kernel owns tasks, scopes, direction, decisions, lineage, and durable evidence.
- ROCS owns ontology semantics.
- SCI snapshot and `.test-results` artifacts are local execution evidence, not canonical AK evidence.
- Current source and tests own implementation behavior.
- Prompt/session TODO lists are convenience only and must not replace an AK task.

When the operator supplies an AK task id:

```bash
ak task show <id>
ak task claim <id> --agent <agent>
ak task scope show <id>
```

Stay inside the task’s explicit scope. Do not update historical status/backlog files as a substitute for AK state.

## Change workflow

1. Inspect dirty files before editing.
2. Reproduce the issue or establish a focused baseline.
3. Prefer SCI navigation and preview-first workflows when practical.
4. Implement the smallest coherent fix.
5. Run focused tests, then the relevant repository gate.
6. Record only commands and outcomes actually observed.
7. Export checked-in AK projections after authorized AK mutations.

Use the standardized Justfile and package surfaces rather than inventing parallel automation:

```bash
just help
just test
just check
just ci
just alpha-mvp-check
```

Repository scripts are valid owner surfaces when they contain nontrivial, tested logic. Just recipes should compose them rather than duplicating long implementations inline.

## Product boundary

The supported Alpha product is the 20-tool MCP/HTTP/CLI membrane documented in `docs/project/alpha-mvp-contract.md`. LSP, VS Code, deployment, dashboards, package publication, marketplace, analytics, and AI-training surfaces remain experimental, historical, or later-phase unless an explicit current decision promotes them.

Mutation is preview-first. Guarded snapshot application requires explicit operator intent and `ALLOW_SNAPSHOT_APPLY=1`.

## Validation

Focused development:

```bash
bun run typecheck
bun run command-surface:check
bun run alpha:mvp:test
```

Canonical Alpha gate:

```bash
bun run alpha:mvp:check
# or
just alpha-mvp-check
```

Repository integrity and AK-capable local validation:

```bash
./scripts/ci/portable.sh
./scripts/ci/full.sh
```

Do not claim production readiness from passing Alpha validation.
