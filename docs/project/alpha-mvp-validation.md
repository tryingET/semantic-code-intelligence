---
summary: "Validation bundle for the Phase 1 harnessed-LLM Alpha MVP."
read_when:
  - "You need to run or modify the Alpha MVP validation path."
  - "You are changing CI, package scripts, just recipes, or dogfood evidence for Phase 1."
type: "reference"
---

# Alpha MVP validation

## Purpose

The Phase 1 Alpha MVP validation bundle proves the first-user path for harnessed LLM coding sessions:

- documented Alpha MVP tool surface is present;
- HTTP `/api/v1/tools/call` can execute `read_file` and the non-mutating navigation cluster (`text_search`, `symbol_search`, `find_definition`, `find_references`, `ast_query`, and `graph_expand`);
- direct `MCPAdapter` calls can execute `get_snapshot`, `read_file`, and the non-mutating navigation cluster;
- MCP HTTP JSON-RPC can discover tools through `tools/list` and call `read_file` plus the navigation cluster through `tools/call`;
- MCP stdio can initialize, advertise the Alpha MVP tools through `tools/list`, and execute `read_file`, `text_search`, and `patch_checks_in_snapshot` while keeping stdout protocol-clean;
- HTTP, direct MCP, and MCP HTTP can stage `propose_patch` diffs and run explicit `run_checks` against snapshots without mutating the working tree;
- CLI fallback proves `safe_write` as the autonomous-safe write path: preview/check by default, guarded apply refusal without `ALLOW_SNAPSHOT_APPLY=1`, risk classification, exact applied-diff verification after clean guarded apply, structured non-success verification for a dirty touched-file mismatch, rollback command, and brief output;
- CLI fallback can execute machine-readable tool calls through `semantic-code-intelligence workflow <tool> --args <json> --json`;
- CLI fallback covers ast-grep-backed `structural_search` and preview-first `structural_patch_checks` for deterministic structural edits;
- HTTP, direct MCP, and MCP HTTP now include structural search parity coverage when `ast-grep` is available;
- self-hosted CLI dogfood uses SCI's own CLI workflow surface against this repo for SCI-first navigation/discovery and preview-first patch planning;
- self-hosted structural dogfood records machine-readable evidence for structural search, snapshot patch artifacts, default tsgo checks, apply-guard refusal, and unchanged working tree posture;
- graph impact dogfood records machine-readable evidence for `graph_expand` impact summaries, edge counts/status, and planning hints;
- impact-aware check recommendation dogfood records machine-readable evidence that `recommend_checks` maps docs-only, TS source, test-file, and graph-impact inputs to explicit advisory validation commands, and that preview/check workflows can surface those recommendations plus compact `validationPlan` summaries without changing executed commands;
- Alpha evidence history compares generated elapsed-time maxima against an explicit baseline without claiming production SLOs;
- target-repo CLI usage is documented and has been exercised as an installed/global command invoked from a non-SCI repository cwd, including graph impact, check recommendation, preview/check, validationPlan evidence, and clean target posture;
- repeatable dogfood evidence can be emitted as machine-readable JSON;
- `alpha:evidence:check` gates generated dogfood evidence for SCI-first discovery, preview-first mutation posture, safe-write exact verification, and coarse latency budgets;
- `alpha:evidence:packet` emits an operator-facing evidence packet that summarizes tool coverage, SCI-first discovery, preview-first mutation, safe-write verification, validation commands, and remaining gaps;
- migration hygiene still rejects stale identity drift and unsafe local artifacts.

## Local commands

Preferred package-script surface:

```bash
bun run alpha:mvp:check
```

Equivalent Just surface:

```bash
just alpha-mvp-check
```

Dogfood-only evidence:

```bash
bun run alpha:mvp:dogfood > .test-results/alpha-mvp-dogfood.json
bun run self:dogfood:cli
bun run structural:dogfood
bun run graph:dogfood
bun run recommend-checks:dogfood
bun run safe-write:dogfood
bun run validation-plan:compare
bun run alpha:evidence:check
bun run alpha:evidence:history
bun run alpha:evidence:packet
```

Test-only subset:

```bash
bun run alpha:mvp:test
```

## CI

GitHub Actions workflow:

```text
.github/workflows/alpha-mvp.yml
```

The workflow runs:

1. `bun install --frozen-lockfile`
2. `bun run alpha:mvp:check`
3. uploads `.test-results/alpha-mvp-dogfood.json` when present

## Dogfood evidence shape

The dogfood harness emits JSON with this high-level shape:

```json
{
  "schema": "semantic-code-intelligence.alpha_mvp_dogfood.v1",
  "ok": true,
  "mode": "harnessed_llm_code_navigation_simulation",
  "summary": [
    {
      "name": "read_file",
      "status": 200,
      "success": true,
      "elapsedMs": 10,
      "observation": "Read the Phase 1 contract from a bounded range."
    }
  ],
  "calls": [],
  "interpretation": {
    "proves": [],
    "does_not_prove": []
  }
}
```

The `interpretation.does_not_prove` section is intentional. Passing this bundle proves the Phase 1 harnessed-LLM Alpha MVP path, not production readiness or Phase 2+ surfaces.

`bun run validation-plan:compare` reads generated validation plans and emits `.test-results/validation-plan-comparison.json`, comparing stable fields while ignoring volatile snapshot ids and timing. When drift is detected, the comparison includes operator-facing explanations and remediation hints. `bun run alpha:evidence:check` reads the generated dogfood JSON files under `.test-results/` and emits `.test-results/alpha-evidence-check.json`. It is intentionally a lightweight evidence gate, not a historical database: it checks that current evidence still contains SCI-first discovery, graph impact summaries, impact-aware check recommendations, validationPlan summaries/comparison, preview-first mutation posture, safe-write exact apply verification plus mismatch fail-closed behavior, and coarse per-call latency budgets. `bun run alpha:evidence:history` emits `.test-results/alpha-evidence-history.json`, comparing current elapsed-time maxima against `docs/project/alpha-evidence-latency-baseline.json`; repeated warnings are hardening signals, while existing Alpha budgets remain the fail-closed latency gate. Operator-facing latency bands are documented in `docs/project/interactive-slo-guidance.md`.

`bun run alpha:evidence:packet` reads the same generated evidence plus the gate/history results and emits `.test-results/alpha-evidence-packet.json`. The packet is the concise operator-facing summary: what evidence passed, what safety posture and check-recommendation behavior were proven, which validation commands matter, what latency-history comparison observed, and what Phase 1 still does not prove. For choosing among CLI, MCP HTTP, MCP stdio, HTTP tools/call, and direct adapter tests, see `docs/project/interface-choice-guide.md`.

## Navigation parity scope

Navigation parity currently means the same bounded tool names are exercised through HTTP tools/call, direct MCPAdapter calls, MCP HTTP JSON-RPC, and an MCP stdio smoke path. It does not mean every parser or graph backend returns rich semantic results in every environment; fallback shapes remain valid alpha evidence when they are structured and non-throwing. Interface choice guidance is maintained in `docs/project/interface-choice-guide.md`.

MCP stdio parity currently means the server can initialize, list tools, execute representative bounded navigation and preview-first patch-check calls, and keep stdout free of non-JSON-RPC pollution. Stderr logs are acceptable for diagnostics and are not protocol payloads.

Patch-planning parity currently means `propose_patch` accepts a reviewable diff into an isolated snapshot and `run_checks` executes an explicit command against that snapshot. `safe_write` is the primary autonomous-safe write workflow: preview/check by default, risk-classify the patch, optionally apply only when `apply:true`, checks pass, and `ALLOW_SNAPSHOT_APPLY=1` is set, verify the applied working-tree state against the reviewed snapshot overlay diff, and return rollback/artifact evidence. `structural_patch_checks` composes ast-grep structural rewrite generation into the same snapshot/check posture. It deliberately does not apply the staged diff to the canonical working tree by default; `apply: true` is refused unless `ALLOW_SNAPSHOT_APPLY=1` is set and checks pass. Structural patch results include workflow/backend/language/pattern/rewrite/paths, explicit limits, match/cap metadata, patch file/replacement/diff-byte summaries, snapshot artifact links (`overlay.diff`, `status`, `progress`), checks, apply posture, and next actions.

CLI fallback parity currently means local command-line execution can call the same tool registry through the generic `workflow` command with JSON arguments and machine-readable stdout. Snapshot ids are now backed by narrow metadata/artifacts under `.ontology/snapshots/<id>/`, so a later CLI process can use `extract_snapshot_artifacts` to inspect status and bounded `overlay.diff`/progress content. Multi-step mutation planning should still prefer composite workflow tools such as `patch_checks_in_snapshot` or `structural_patch_checks`; SCI has not added a large cross-process session state layer.

Self-hosted CLI dogfood currently means SCI CLI is used as a practical work loop on the SCI repo itself, not only as a protocol smoke test. The self-hosted loop records `selfHosting.sciFirstDiscovery` evidence that bounded reads, text search, symbol search, definition/reference lookup, and graph context happen through SCI workflow calls before snapshot patch planning. Structural dogfood extends that with `scripts/dogfood-structural-workflow.ts`, which writes `.test-results/structural-workflow-dogfood.json` and proves preview-first ast-grep structural workflows without adding external target-repo assumptions. Graph impact dogfood writes `.test-results/graph-impact-dogfood.json` and proves `graph_expand` emits edge counts/status plus planning hints for harnessed LLM change planning. Recommend-checks dogfood writes `.test-results/recommend-checks-dogfood.json` and proves `recommend_checks` emits advisory minimum/broader validation commands for docs-only, TS source, test-file, and graph-impact cases. It also proves `patch_checks_in_snapshot` can thread those recommendations and emit a compact `validationPlan` when `recommendChecks:true` while still running caller-supplied commands. Safe-write dogfood proves `safe_write` can surface the same advisory recommendations and `validationPlan` in preview mode without changing guarded apply behavior. Validation-plan comparison writes `.test-results/validation-plan-comparison.json` and flags stable-field drift while ignoring volatile snapshot/timing fields. Alpha evidence history writes `.test-results/alpha-evidence-history.json` and compares elapsed-time maxima against `docs/project/alpha-evidence-latency-baseline.json`. Drift entries include explanations and suggested remediation so operators can distinguish real safety regressions from intentional contract changes. CLI parity tests also prove a later CLI process can read snapshot artifacts produced by `structural_patch_checks`. See `docs/project/self-hosted-cli-dogfood.md`.

Target-repo CLI usage means an installed/global `semantic-code-intelligence` command is invoked from the repository being inspected, with target-repo-relative paths. Current evidence includes a generic `target-validation-plan:dogfood` proof from a non-SCI repository cwd: bounded read/discovery, graph impact, check recommendation, preview/check, validationPlan evidence, generated artifact cleanup, and clean target posture afterward. SCI should not commit machine-local paths for external repositories. See `docs/project/target-repo-cli-usage.md`.

## Maintenance rule

When the Alpha MVP contract changes, update all of these in the same wave:

- `docs/project/alpha-mvp-contract.md`
- package scripts in `package.json`
- `just alpha-mvp-check`
- `docs/project/interface-choice-guide.md`
- `docs/project/interactive-slo-guidance.md`
- `scripts/dogfood-alpha-mvp.ts`
- `scripts/dogfood-self-hosted-cli.ts`
- `scripts/dogfood-structural-workflow.ts`
- `scripts/dogfood-graph-impact.ts`
- `scripts/dogfood-recommend-checks.ts`
- `scripts/dogfood-safe-write.ts`
- `scripts/compare-validation-plans.ts`
- `scripts/compare-alpha-evidence-history.ts`
- `scripts/check-alpha-evidence.ts`
- `scripts/build-alpha-evidence-packet.ts`
- target-repo/global CLI usage docs such as `docs/project/target-repo-cli-usage.md`
- Alpha MVP tests under `tests/alpha-mvp-*.test.ts`, including CLI fallback coverage
- `.github/workflows/alpha-mvp.yml`
