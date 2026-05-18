---
summary: "Operator-facing latency/SLO guidance for Phase 1 harnessed-LLM SCI workflows."
read_when:
  - "You need performance expectations for SCI Alpha MVP workflows."
  - "A harnessed LLM workflow feels slow or exceeds alpha evidence budgets."
  - "You are deciding whether current performance evidence supports broader Phase 1 closure."
type: "guide"
---

# Interactive SLO guidance — Phase 1 Alpha MVP

## Scope

This guide gives **operator-facing latency expectations** for harnessed LLM coding sessions using SCI.

It is not a production SLO, benchmark report, or capacity plan. Current Alpha evidence uses coarse per-call budgets to catch obvious regressions and to keep interactive workflows practical.

## Current evidence baseline

The Alpha evidence gate currently budgets generated dogfood calls as follows:

| Evidence class | Current coarse budget |
|---|---:|
| Alpha navigation/patch-planning calls | 15s per call |
| Self-hosted CLI calls | 15s per call |
| Structural workflow calls | 20s per call |
| Graph impact calls | 15s per call |
| Check recommendation calls | 15s per call |
| Safe-write calls | 15s per call |

Recent evidence packets generally run representative bounded calls well below those ceilings, often sub-second to a few seconds, but the budgets are intentionally loose. They prove that the current harness is not obviously stalled; they do **not** prove production latency SLOs.

## Operator latency bands

Use these bands during harnessed LLM sessions:

| Band | Latency | Interpretation | Operator response |
|---|---:|---|---|
| Instant | < 1s | Good for tight interactive loops. | Continue normally. |
| Interactive | 1–5s | Acceptable for bounded search, graph impact, recommendations, and preview checks. | Continue; prefer composite workflows to avoid repeated setup overhead. |
| Slow but tolerable | 5–15s | Acceptable for larger searches, cold CLI startup, structural workflows, or check execution. | Narrow paths/limits on the next call; inspect whether a cheaper workflow exists. |
| Budget pressure | 15–30s | Exceeds most alpha dogfood budgets or approaches structural budget limits. | Stop broad probing; reduce scope, use explicit file paths, lower limits, or split workflow. Record evidence if repeated. |
| Not interactive | > 30s | Not suitable for first-user interactive use without explanation. | Treat as a performance issue or choose another interface/strategy. Do not hide the delay from the operator. |

## Workflow-specific guidance

### Discovery and navigation

For `read_file`, `text_search`, `symbol_search`, `find_definition`, `find_references`, `ast_query`, and `graph_expand`:

- prefer repo-relative paths and explicit file hints;
- set `maxResults`, `limit`, and bounded ranges;
- use `graph_expand` for impact hints, then narrower reference/definition calls for confirmation;
- if a broad call is slow, do not retry the same broad call repeatedly.

### Check recommendation

`recommend_checks` should be fast because it is heuristic and does not run checks.

If it is slow:

- verify the caller did not pass a very large patch unnecessarily;
- pass `files` instead of a full patch when possible;
- keep `impactSummary` concise.

### Preview/check workflows

For `patch_checks_in_snapshot`, `structural_patch_checks`, and `safe_write` preview:

- distinguish SCI overhead from the command being run;
- use cheap checks such as `true` for shape/protocol dogfood;
- use real validation commands when the change is meaningful;
- inspect `validationPlan.commands.selected` to explain what actually ran.

If checks exceed the interactive band, reduce check scope when truthful (for example narrow test files) or tell the operator the workflow is now validation-heavy rather than navigation-heavy.

### CLI vs MCP latency

CLI is best for target-cwd fallback and one-shot dogfood, but each call has process startup cost. If a session makes many repeated calls and an MCP host is available, MCP HTTP can be more appropriate.

Use `docs/project/interface-choice-guide.md` for transport selection.

## Evidence response playbook

When a workflow exceeds expectations:

1. **Classify the delay** — startup, search breadth, graph expansion, structural matching, or external check command.
2. **Narrow the next call** — smaller paths/ranges, lower limits, file hints, or a composite workflow.
3. **Preserve evidence** — keep elapsed time, selected commands, and `validationPlan` in the session/evidence packet.
4. **Avoid false success** — do not claim interactive readiness if the operator waited on a slow hidden step.
5. **Escalate only with proof** — create a performance hardening task if repeated delays exceed 15s for normal navigation or 30s for any interactive workflow.

## What current Alpha performance evidence proves

Current evidence proves:

- representative Phase 1 workflows complete within coarse dogfood budgets;
- generated evidence includes per-call elapsed times;
- slow-path detection exists at the evidence-gate level;
- validationPlan records the selected commands so check latency can be distinguished from recommendation latency.

Current evidence does **not** prove:

- production SLOs;
- performance on very large repositories;
- stable p95/p99 latency across machines;
- dashboard-grade historical trend analysis;
- that CLI startup overhead is optimal for long-lived sessions.

## Recommended next hardening

Before broad Phase 1 closure, prefer one of:

1. collect external target latency evidence across at least one larger or less TypeScript-centric repo;
2. add historical comparison for elapsed time distributions;
3. split evidence budgets by workflow type and repository size;
4. document transport-specific startup overhead after more MCP HTTP vs CLI dogfood.
