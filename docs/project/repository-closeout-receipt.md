---
summary: "Local structured evidence wrapper for SCI's repository-declared landing gate."
read_when:
  - "You need one durable local receipt for repository closeout validation."
  - "You are changing loop-landing-check or its evidence boundary."
type: "reference"
---

# Repository closeout receipt

## Purpose

`just loop-closeout-receipt` runs SCI's existing repository-declared landing gate exactly once and materializes a compact receipt plus complete logs. It removes manual evidence assembly without duplicating or replacing `just loop-landing-check`.

The command is a repository-local validation observer. It does not commit changes, record AK evidence, complete an AK task, close an FCOS item, approve CI or release state, or grant governance authority.

## Usage

```bash
LOOP_TASK_ID=<task-id> just loop-closeout-receipt
```

`LOOP_TASK_ID` is recorded only as caller-supplied correlation metadata. It does not prove that the task exists or authorize lifecycle mutation.

The wrapper has no arbitrary command option. Its delegated command is fixed:

```text
just loop-landing-check
```

That landing recipe remains the owner of scope checking and the canonical Alpha MVP validation bundle. The wrapper invokes it once rather than spelling out or rerunning its child checks.

## Local artifacts

Each invocation creates a unique mode-restricted directory:

```text
.test-results/repository-closeout/<run-id>/
├── receipt.json
├── workspace-before.status.z
├── workspace-after.status.z
├── landing.stdout.log
└── landing.stderr.log
```

The status artifacts preserve exact bytes from:

```bash
git status --porcelain=v1 -z --untracked-files=all -- .
```

The receipt also records before/after values from the existing content-sensitive `scripts/git-tree-fingerprint.sh`. `workspaceInventory.unchanged` is true only when both status-artifact digests and content fingerprints match. This catches content changes that retain the same porcelain status shape.

Each artifact reference contains its repository-relative path, SHA-256 digest, and byte count. The receipt is published atomically after observations finish. Stdout and stderr logs are written directly to files and are not reduced to workflow-tail excerpts.

## Receipt contract

The schema identifier is:

```text
semantic-code-intelligence.repository_closeout_receipt.v1
```

The principal sections are:

- `run`: unique identity, optional caller task correlation, timestamps, and elapsed time;
- `delegatedGate`: fixed command identity, invocation count, process result, and complete log references;
- `workspaceInventory`: observer commands, before/after inventory references, unchanged result, and observation errors;
- `outcome`: repository-local gate and workspace-observation result;
- `authorityBoundary`: explicit local durability and non-authority assertions;
- `limitations`: observation coverage and log-handling caveats.

Possible outcome statuses are:

- `passed_workspace_unchanged`;
- `gate_failed`;
- `workspace_changed`;
- `observation_failed`.

The wrapper exits zero only for `passed_workspace_unchanged`. A pre-gate observation failure prevents delegation and records an invocation count of zero. A failed or lost process spawn, nonzero gate, changed workspace, or failed observation exits nonzero while retaining the available receipt and logs.

## Interpretation boundaries

The inventory covers Git-visible tracked and untracked state. Ignored filesystem state, including other `.test-results` or `.ontology` artifacts, is outside that observation. Empty before/after status artifacts mean only that no Git-visible entries were observed; they are not an independent cleanliness claim.

Pre-existing dirty entries are allowed. The receipt compares exact before/after state instead of requiring an initially clean worktree. This makes the observation useful without authorizing, deleting, staging, or normalizing unrelated work.

Full logs can be large and may contain sensitive text emitted by checks. They stay ignored and local unless an operator deliberately reviews and promotes selected artifacts through AK. Local cleanup can remove `.test-results/repository-closeout/`; that has no AK, Git, or FCOS lifecycle effect.

## Validation

Focused contract checks:

```bash
bun run format:check
bun run typecheck
bun test tests/repository-closeout-receipt.test.ts tests/build-command-surface.test.ts
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict
```

Canonical repository evidence should use one invocation rather than separately rerunning its children:

```bash
LOOP_TASK_ID=<task-id> just loop-closeout-receipt
```
