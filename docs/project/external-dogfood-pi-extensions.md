---
summary: "External dogfood evidence for using SCI CLI on the pi-extensions monorepo."
read_when:
  - "You need evidence that Semantic Code Intelligence works outside its own repository."
  - "You are changing the external pi-extensions dogfood harness."
type: "evidence"
---

# External dogfood — pi-extensions

## Purpose

After self-hosting on this repository, the next Phase 1 proof is using Semantic Code Intelligence on a nontrivial external repo.

`pi-extensions` is the first external target because it is close to the first user: harnessed LLM coding sessions inside Pi. It is also a real TypeScript monorepo with package boundaries, docs, extension entrypoints, and validation concerns.

## Target

Default external repo:

```text
/home/tryinget/ai-society/softwareco/owned/pi-extensions
```

Current package scenario:

```text
packages/pi-toolbox-discovery
```

Why this package:

- it owns the `toolbox` capability used to discover and activate Pi extension tools;
- it has package docs plus a real TypeScript extension implementation;
- it is directly related to making harness capabilities visible and bounded.

## Command

Run from the Semantic Code Intelligence repo:

```bash
bun run external:dogfood:pi-extensions
just external-dogfood-pi-extensions
```

Optional override:

```bash
PI_EXTENSIONS_REPO=/path/to/pi-extensions bun run external:dogfood:pi-extensions
```

Evidence is written to:

```text
.test-results/external-dogfood-pi-extensions.json
```

## What the harness does

The harness runs SCI's CLI workflow command from the `pi-extensions` repo root, using SCI as the code-intelligence substrate while preserving `pi-extensions` source-owner boundaries.

It calls:

1. `read_file` on `packages/pi-toolbox-discovery/README.md`;
2. `text_search` for toolbox-related package references;
3. `symbol_search` for `CATALOG` in `extensions/toolbox.ts`;
4. `find_definition` for `CATALOG`;
5. `find_references` for `CATALOG`;
6. `graph_expand` on the toolbox extension file;
7. `patch_checks_in_snapshot` with a harmless README patch and `true` as the check command.

The harness verifies:

- all CLI calls exit successfully;
- CLI stdout is machine-readable JSON;
- the target `pi-extensions` file is unchanged;
- `git status --short` in `pi-extensions` is unchanged;
- newly created `.ontology/snapshots` entries are best-effort cleaned up.

## Boundary

This is an external dogfood/readiness proof, not authority to mutate `pi-extensions`.

- SCI-owned artifacts live in this repo.
- `pi-extensions` remains the owner of its source files, package docs, tasks, and validation decisions.
- Real `pi-extensions` mutations require a separate owner-scoped task/wave and that repo's guardrails.

## What this proves

- SCI CLI can navigate a nontrivial external TypeScript package.
- SCI can locate package docs, implementation symbols, definitions, references, and graph/fallback context outside its own repo.
- SCI can stage and check a harmless external-repo patch without mutating the external working tree.

## What this does not prove

- Production readiness.
- That all `pi-extensions` packages behave equally well.
- Rich semantic graph coverage for every external repo.
- Permission to mutate `pi-extensions` canonical files.
