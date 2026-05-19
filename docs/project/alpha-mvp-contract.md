---
summary: "Alpha MVP contract for harnessed LLM coding sessions using Semantic Code Intelligence."
read_when:
  - "You are implementing, testing, or documenting the Phase 1 harnessed-LLM tool surface."
  - "You need to know what is alpha-supported versus roadmap for Semantic Code Intelligence."
type: "reference"
---

# Alpha MVP contract — harnessed LLM coding sessions

## User and job

The Phase 1 user is a **harnessed LLM coding session**: an LLM operating inside a tool/runtime harness such as Pi, Claude Code, Cursor, or another coding workbench.

The job is to make code-navigation and patch-planning work bounded, repeatable, and evidence-bearing.

A harnessed LLM coding session should be able to:

1. establish the repository state it is reasoning over;
2. retrieve relevant files, symbols, definitions, references, and graph neighborhoods;
3. propose a patch without silently mutating canonical files;
4. run explicit checks against the proposed or actual change;
5. report evidence that a human operator can inspect.

## Primary interfaces

Alpha support is limited to these interfaces, in order:

1. **MCP tools** for harnessed LLM coding sessions;
2. **HTTP `/api/v1/tools/call`** for deterministic parity tests and non-MCP harnesses;
3. **CLI commands** for local verification and fallback.

LSP, VS Code, dashboards, CI reports, Kubernetes deployment, marketplace, analytics, and AI-training surfaces are not Phase 1 commitments unless they directly verify or support the harnessed-LLM tool contract.

## Supported tool contract

The Alpha MVP tool surface is:

| Operation | Required behavior | Minimum evidence |
|---|---|---|
| `get_snapshot` | Return an identifier for the repository state or overlay state used by later calls. | Snapshot id or explicit state descriptor; snapshot metadata/artifacts are narrowly persisted for later artifact inspection. |
| `read_file` | Read bounded file ranges from the requested snapshot/workspace state; fail closed when lexical paths, symlinks, or opened file descriptors escape the workspace. | Path, range, and content or structured error without leaked out-of-workspace content. |
| `text_search` | Search text with caps, ignore handling, deterministic result shape, and workspace-contained search roots. | Query, result count, capped workspace-contained results. |
| `symbol_search` | Find likely symbols with path/language hints where available; fallback file hints must stay workspace-contained. | Query, candidates, confidence/ranking fields when available. |
| `ast_query` | Run structural language-aware queries where parser support exists; explicit paths and glob-expanded files must stay inside the workspace after lexical, realpath, and opened-file checks. | Language, query, matched ranges, parser/fallback status, and snippets only from workspace-contained files. |
| `find_definition` | Resolve likely definition locations without requiring a long-lived editor process. | Symbol/query, file/range candidates, fallback status. |
| `find_references` | Return bounded reference candidates. | Symbol/query, file/range candidates, cap metadata. |
| `graph_expand` | Expand file/symbol neighborhoods through imports, exports, callers, callees, or semantic edges where available, with a concise impact summary for change planning. | Node id, edge types, depth, neighbors, fallback/limitation status, edge counts, best-effort caller context, impact evidence status, and planning hints. |
| `recommend_checks` | Recommend transparent validation commands from touched files, a patch, and optional graph impact summary. It is advisory and does not run checks. | Minimum and broader command lists, rationale items tied to files/reasons, confidence, and input summary. |
| `propose_patch` | Accept a patch proposal as a reviewable diff and reject invalid patch shapes. | Patch id or structured result; invalid-patch diagnostics on failure. |
| `run_checks` | Run explicit validation commands or configured checks and return outcomes. | Commands, exit codes, stdout/stderr summaries, duration. |
| `structural_search` | Run ast-grep-backed structural search over bounded repo-relative paths with explicit result, timeout, and output-buffer limits. | Workflow/backend availability, language, pattern, paths, limits, match count, cap status, file/range/snippet matches. |
| `structural_patch_checks` | Generate an ast-grep structural rewrite diff, stage it in a snapshot, run explicit checks, and avoid working-tree writes by default. | Match count, patch file/replacement/diff-byte summary, snapshot id and artifact links, check result, applied=false unless explicitly guarded. |
| `safe_write` | Primary autonomous-safe write path: stage a patch, run checks, classify risk, optionally apply only with `apply:true` plus `ALLOW_SNAPSHOT_APPLY=1`, verify the applied working-tree change matches the reviewed snapshot overlay, and return rollback/artifact evidence. When `recommendChecks:true`, it also surfaces advisory check recommendations without changing the commands that run. | Risk class, snapshot id, check result, compact `validationPlan`, optional check recommendations, apply guard result, exact applied-diff verification when applied, rollback command/artifact, concise brief output when requested. |

## Cross-interface invariants

- MCP, HTTP, and CLI should use the same core behavior for the same operation.
- Results should be bounded by limits rather than unbounded repository traversal.
- File-reading, text-search roots, symbol fallback hints, and structural-snippet paths must be contained after lexical normalization and realpath resolution; direct file reads also verify opened descriptors so symlink or TOCTOU-shaped escapes fail closed.
- Errors should be structured enough for a harnessed LLM to recover without guessing.
- Stdio protocol paths must keep stdout clean.
- Tool names and documentation use the canonical Semantic Code Intelligence identity; no pre-rename compatibility names are retained during alpha.

## Patch and mutation safety

Alpha mutation posture is **preview first**.

- A proposed change is a diff/patch before it is an applied file mutation.
- Checks are explicit and reported.
- Failed checks must preserve diagnostics and avoid claiming success.
- Learned patterns can suggest; they do not silently enforce policy.
- `structural_patch_checks` and `safe_write` follow the same preview-first posture: `apply` defaults to `false`, and `apply: true` is honored only when `ALLOW_SNAPSHOT_APPLY=1` is set and checks pass.
- When `safe_write` applies, it verifies the applied working-tree state against the reviewed snapshot `overlay.diff` with a reverse `git apply --check` proof and reports `verification.appliedDiffMatchesSnapshot`; unverifiable shapes are structured non-success verification states rather than silent success.
- SCI orchestrates structural workflow safety and evidence; `ast-grep` performs deterministic structural matching and rewrite generation.
- `recommend_checks` may suggest `bun run typecheck`, narrow `bun test <file>` commands, or a no-op `true` for docs-only changes, with explicit rationale. Suggestions are not hidden policy gates.
- `patch_checks_in_snapshot` and `safe_write` return a compact `validationPlan` summary with selected commands, recommendation evidence, check result, snapshot artifacts, apply posture, and rollback links where applicable.
- Generated `validationPlan` evidence is compared on stable fields to flag check-plan drift while ignoring volatile snapshot ids and timing.
- `patch_checks_in_snapshot` and `safe_write` may include check suggestions when `recommendChecks:true`; suggestions and `validationPlan` summaries do not replace, append to, or enforce the explicit `commands` that actually run.
- Default structural checks use `bun run typecheck`, which is the tsgo-primary TypeScript validation lane. Do not reintroduce `build:tsc`; `bun run typecheck:fallback` remains the tsc fallback.

## One-command validation

Run the current Phase 1 validation bundle with either command:

```bash
bun run alpha:mvp:check
just alpha-mvp-check
```

These commands run TypeScript typecheck, Alpha MVP HTTP/direct-MCP/MCP-HTTP tests, the repeatable dogfood harness, and migration hygiene. See `docs/project/alpha-mvp-validation.md` for the package, Just, and CI validation surfaces.

## Done criteria for Phase 1

Phase 1 is credible when:

1. the supported operations above are documented and discoverable;
2. MCP and HTTP parity is tested for the core tool calls;
3. at least one nontrivial dogfood workflow records evidence that the tool surface reduced raw shell probing or stale assumptions;
4. migration hygiene and docs strict checks pass;
5. old product identity strings remain absent outside the hygiene rule itself and historical notes in this policy family.

## Explicit non-goals

- Production Kubernetes deployment as a default path.
- Marketplace, analytics, and AI-training as supported product features.
- Human IDE polish before harnessed-LLM substrate reliability.
- Direct autonomous writes without a reviewable patch/check path.
- Canonical task, decision, evidence, or governance authority; AK remains the owner for those facts.
