---
summary: "Target-repo CLI usage model for Semantic Code Intelligence."
read_when:
  - "You need to use Semantic Code Intelligence from another repository."
  - "You are changing external dogfood, CLI install, or harnessed-session usage docs."
type: "reference"
---

# Target-repo CLI usage

## Purpose

Semantic Code Intelligence should not encode the filesystem location of a target repository.

The intended Phase 1 model is that a harnessed LLM coding session stands inside the repository it is working on and invokes an installed SCI CLI from that repository's current working directory.

```bash
cd /path/to/target-repo
sci workflow read_file --args '{"path":"README.md","range":{"startLine":1,"endLine":80}}' --json
```

The short command is `sci`; the long command `semantic-code-intelligence` remains supported for explicit scripts and documentation.

This keeps source-owner boundaries clear:

- SCI owns the CLI/MCP/HTTP tool contract and generic behavior.
- The target repository owns its source files, tasks, docs, and validation decisions.
- Dogfood evidence should not require SCI to know machine-local target paths.

## Install or expose the CLI

During local development, build SCI and link its package bin into the operator's Bun global command surface.

From the SCI repo:

```bash
just install-cli-local
# or: bun run cli:install-local
```

Then verify from any target repo:

```bash
cd /path/to/target-repo
sci --help
semantic-code-intelligence --help
```

If the installed command is not available yet, use an explicit local path outside committed docs or scripts for that session only. Do not commit machine-local target repo paths into SCI.

## Generic workflow calls from a target repo

From the target repo root:

```bash
sci workflow text_search \
  --args '{"query":"toolbox","path":"packages","maxResults":12}' \
  --json

sci workflow symbol_search \
  --args '{"query":"CATALOG","fileHint":"packages/pi-toolbox-discovery/extensions/toolbox.ts","maxResults":10}' \
  --json

sci workflow patch_checks_in_snapshot \
  --args '{"patch":"diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-# Old\n+# Old\n","commands":["true"],"timeoutSec":30}' \
  --json

sci workflow structural_search \
  --args '{"language":"typescript","pattern":"console.log($$$ARGS)","paths":["src"],"maxResults":20}' \
  --json

sci workflow structural_patch_checks \
  --args '{"language":"typescript","pattern":"console.log($$$ARGS)","rewrite":"console.error($$$ARGS)","paths":["src"],"commands":["true"],"timeoutSec":30,"apply":false}' \
  --json
```

Use target-repo relative paths in `--args`. Avoid absolute paths unless the operator is doing an uncommitted one-off investigation. Structural patch workflows are preview-first; `apply` defaults to `false`, and `apply: true` requires `ALLOW_SNAPSHOT_APPLY=1` and passing checks. Omit `commands` to use the repo's default `bun run typecheck` path; in SCI that path is tsgo-primary, while `bun run typecheck:fallback` remains the explicit tsc fallback. Do not use or reintroduce a `build:tsc` alias.

## External dogfood evidence rule

External dogfood is valuable, but it should be captured as evidence of the target-repo usage model, not as a target-specific default inside SCI.

Acceptable:

- a target repo runs installed `sci` or `semantic-code-intelligence` from its own cwd;
- an operator records the target repo name and scenario in AK evidence or a repo-owned doc;
- a generic SCI script accepts an explicit target cwd argument without defaults.

Not acceptable:

- SCI source or docs hardcode machine-local absolute target repo paths;
- SCI default validation depends on a sibling repo being present;
- an SCI wave mutates a target repo without that repo's owner-scoped authority.

## Current status

Earlier external dogfood against a Pi extension package showed useful navigation and preview-first patch-check behavior, but it also exposed the wrong coupling: SCI carried target-repo knowledge.

The corrected product direction is installed/global SCI CLI usage from the target repository's cwd. Current local development support is `just install-cli-local`, which builds the CLI and registers package bins so target repos can invoke `sci` directly, with `semantic-code-intelligence` available as the long-form alias.
