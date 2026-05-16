---
summary: "Self-hosted SCI CLI dogfood loop for maintaining Semantic Code Intelligence with its own tool surface."
read_when:
  - "You want to use Semantic Code Intelligence on this repository itself."
  - "You are changing the self-hosted CLI dogfood harness or validation commands."
type: "evidence"
---

# Self-hosted CLI dogfood

## Purpose

Semantic Code Intelligence should be useful for maintaining Semantic Code Intelligence itself.

The self-hosted CLI dogfood loop uses the local CLI workflow surface as the primary harnessed-LLM substrate:

```bash
semantic-code-intelligence workflow <tool> --args '<json>' --json
```

In source-tree development, run it through Bun:

```bash
bun run src/servers/cli.ts workflow <tool> --args '<json>' --json
```

## Current committed harness

Run the repeatable self-hosted loop with either command:

```bash
bun run self:dogfood:cli
just self-dogfood-cli
```

Run the structural workflow dogfood with:

```bash
bun run structural:dogfood
```

The commands write machine-readable evidence to:

```text
.test-results/self-hosted-cli-dogfood.json
.test-results/structural-workflow-dogfood.json
```

## What the harness does

The harness calls SCI CLI workflow tools against this repo to:

1. read the current product posture with `read_file`;
2. locate the alpha-evidence section with `text_search`;
3. inspect the dogfood script itself with `symbol_search`, `find_definition`, and `find_references`;
4. request graph/fallback context with `graph_expand`;
5. stage and check a doc patch with `patch_checks_in_snapshot`;
6. verify the working tree target file was not mutated.

The structural harness calls installed `sci workflow` against this repo to:

1. find a known TypeScript pattern with `structural_search`;
2. generate a structural rewrite diff with `structural_patch_checks` and `commands:["true"]`;
3. verify omitted commands default to `bun run typecheck` (tsgo primary in SCI);
4. verify `apply:true` is refused without `ALLOW_SNAPSHOT_APPLY=1`;
5. verify the working tree remains unchanged.

This makes the CLI path a real self-hosted maintenance loop rather than only a protocol smoke test.

## Operator rule

For SCI maintenance work, prefer SCI CLI workflow calls before raw shell probing when the question is about:

- bounded file reading;
- text or symbol lookup;
- definition/reference discovery;
- graph/fallback context;
- preview-first patch checks;
- deterministic structural matching and rewrite planning through ast-grep-backed workflows.

Raw shell tools are still appropriate for git status, deterministic validation commands, AK operations, and cases where SCI does not yet expose the needed primitive.

## Known limitation

CLI workflow invocations are process-local for live adapter state, but snapshot metadata/artifacts are narrowly persisted under `.ontology/snapshots/<id>/`. A later CLI process can call `extract_snapshot_artifacts` with a snapshot id to inspect status plus bounded `overlay.diff`/progress content. For multi-step mutation planning, still prefer composite workflow tools such as `patch_checks_in_snapshot` or `structural_patch_checks`, or use MCP/HTTP when a long-lived server/session is needed.

## What this proves

- SCI CLI can be used as a practical self-hosted navigation and patch-planning loop on the SCI repo.
- CLI workflow stdout is machine-readable JSON for harness consumption.
- Preview-first patch checks can validate a proposed change without mutating the working tree.

## What this does not prove

- Production readiness.
- External-repository usefulness.
- Durable cross-process snapshot/session semantics.
- Human IDE, dashboard, marketplace, analytics, or AI-training support.
