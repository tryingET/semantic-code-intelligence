---
summary: "Operator guidance for choosing SCI CLI, MCP HTTP, MCP stdio, HTTP tools/call, or direct adapter tests."
read_when:
  - "You are deciding which SCI interface to use in a harnessed coding session."
  - "You are writing dogfood, parity tests, or operator instructions for Alpha MVP workflows."
  - "You need to choose between CLI fallback, MCP HTTP, MCP stdio, HTTP tools/call, and direct adapter tests."
type: "guide"
---

# Interface choice guide — Phase 1 Alpha MVP

## Rule of thumb

Use the interface that matches the operator context, not the one with the most features. For latency expectations and what to do when workflows feel slow, see `docs/project/interactive-slo-guidance.md`.

For Phase 1, the first user is a harnessed LLM coding session. The safest default is:

```text
Pi with native SCI tools -> composite native tool calls over session-scoped MCP stdio
inside a target repo without native tools -> installed/global CLI workflow calls
long-lived MCP client -> MCP HTTP
stdio-only MCP host -> MCP stdio
deterministic parity testing -> HTTP /api/v1/tools/call
unit/contract coverage -> direct MCPAdapter tests
```

All interfaces should preserve the same core posture:

```text
bounded discovery -> graph impact -> recommend checks -> preview/check -> validationPlan -> guarded apply only when explicit -> rollback/evidence
```

## Decision table

| Situation | Prefer | Why | Avoid |
|---|---|---|---|
| Maintaining SCI itself in Pi with `pi-semantic-code-intelligence` registered | Native composite SCI tools | Tool schemas and composite-first routing are visible to the model; one session-scoped MCP stdio process avoids shell JSON and per-call startup friction. | Manual primitive chains when a matching composite is sufficient. |
| Maintaining SCI itself in a terminal session without native tools | Installed/global CLI composite workflow from the SCI repo cwd | Preserves machine-readable target-cwd behavior as the fallback. | One CLI process per primitive when a composite exists. |
| Working in another repository | Installed/global CLI from that target repo cwd | Keeps target paths relative and prevents SCI from hardcoding machine-local repo paths. | Committed docs/scripts with absolute target paths. |
| A harness already speaks MCP over HTTP | MCP HTTP | Best fit for long-lived MCP clients that can initialize once and call tools repeatedly. | Spawning many short-lived CLI processes if the host already maintains an MCP session. |
| A host only supports MCP stdio | MCP stdio | Valid Alpha path when stdout protocol cleanliness matters. | Logging or diagnostics on stdout; use stderr for diagnostics. |
| CI-like or deterministic cross-interface parity tests | HTTP `/api/v1/tools/call` | Simple request/response surface for repeatable tests without MCP client machinery. | Treating HTTP parity tests as a production API promise beyond alpha scope. |
| Core adapter contract/unit coverage | Direct `MCPAdapter` tests | Exercises tool routing and result shapes without server/network noise. | Claiming direct-adapter-only coverage proves client interoperability. |
| Previewing a patch in any interface | `patch_checks_in_snapshot` or `safe_write` preview | Produces snapshot artifacts, explicit checks, optional recommendations, and `validationPlan`. | Direct file writes before a reviewed diff/check path. |
| Intentionally applying a patch | `safe_write` with `apply:true`, passing checks, and `ALLOW_SNAPSHOT_APPLY=1` | Preserves guarded apply and applied-state verification. | Any apply path that bypasses guards or does not expose rollback evidence. |

## Interface-specific guidance

### CLI workflow

Use CLI workflow calls when the harness is already in a repository checkout and needs deterministic, machine-readable tool calls:

```bash
semantic-code-intelligence workflow read_file \
  --args '{"path":"README.md","range":{"startLine":1,"endLine":40}}' \
  --json
```

Prefer CLI for:

- target-repo/global usage;
- one-shot dogfood evidence;
- local fallback when MCP servers are not running;
- validation-plan spine proof from a non-SCI repo cwd.

CLI caveats:

- Each invocation is a process boundary. Prefer composite workflows such as `patch_checks_in_snapshot`, `structural_patch_checks`, or `safe_write` for multi-step mutation planning.
- Snapshot metadata/artifacts are persisted narrowly under `.ontology/snapshots/`, but this is not a durable session database.
- Clean generated `.ontology` artifacts in external dogfood if the target did not already own them.

### MCP HTTP

Use MCP HTTP when a harness can maintain an MCP session and wants repeated tool calls with normal MCP discovery:

- initialize once;
- call `tools/list`;
- call SCI tools through `tools/call`;
- keep operator evidence in the harness or AK, not in SCI runtime state.

Prefer MCP HTTP for long-lived coding workbench integrations. It is usually a better fit than CLI when the host already manages sessions.

### MCP stdio

Use MCP stdio when the client requires stdio transport. It is an Alpha-supported path, but stdout must stay protocol-clean.

Operator checks:

- initialize succeeds;
- `tools/list` advertises the Alpha tool surface;
- representative read/navigation/preview-check calls work;
- diagnostics stay off stdout.

Prefer MCP HTTP over stdio when both are available and the operator wants easier inspection/debugging.

### HTTP `/api/v1/tools/call`

Use HTTP tools/call for deterministic parity tests and non-MCP harness experiments.

It is useful because:

- request/response shape is simple;
- tests can call exact tools with exact arguments;
- it exercises server routing without MCP protocol ceremony.

Interpret `success:false` as a tool-invocation/transport error. A valid tool call may still return a domain payload with `ok:false` (for example failed checks or refused apply) that the caller should inspect as ordinary result data.

Do not overstate it as the primary product interface. The Alpha contract still prioritizes MCP tools first, then HTTP parity/non-MCP harnesses, then CLI fallback.

### Direct MCPAdapter tests

Use direct adapter calls for unit/contract tests where server lifecycle and protocol transport would only add noise.

They are best for:

- validating tool registration/routing;
- checking structured error shapes;
- covering core behavior cheaply.

They do not prove MCP client compatibility by themselves. Pair them with MCP HTTP and/or MCP stdio parity before making interface claims.

## Mutation and validation posture across interfaces

Regardless of interface:

1. Start with the smallest matching composite: `explore_symbol_impact`, `locate_confirm_definition`, `rename_safely`, `structural_patch_checks`, `patch_checks_in_snapshot`, or `safe_write`.
2. Use bounded native reads after the composite identifies relevant files; decompose into SCI primitives only when the composite evidence is insufficient.
   `explore_symbol_impact` only reports `ok:true` when definition or declaration evidence confirms the symbol. An `ok:false`, `isError:false` result with `symbolResolution.status: "unconfirmed"` is a completed bounded search, not a transport failure. A `status: "indeterminate"` or `degraded:true` result means a subcall failed or returned an unstructured result; do not infer symbol absence. Inspect `partial`, `symbolResolution.issues`, and the tailored `next_actions` before falling back.
3. Use `recommend_checks` for advisory command selection when touched files or graph impact are known.
4. Use `patch_checks_in_snapshot` or `safe_write` preview for a reviewed diff/check path.
5. Inspect `validationPlan` for selected commands, recommendation evidence, check result, snapshot artifacts, apply posture, and rollback links.
6. Apply only through guarded paths when explicitly intended.

For real-task dogfood, distinguish agent-efficiency evidence from primitive contract coverage. Record `sciCompositeCalls`, justified `nativeFallbacks`, `rawShellAvoided`, elapsed time, and whether preview left the workspace unchanged.

`recommend_checks` and `validationPlan` are evidence surfaces. They do not silently choose, append, or enforce validation commands.

## Current readiness implication

The interface evidence is credible for the closed Phase 1 Alpha MVP substrate, but not enough for production readiness:

- self-hosted CLI, HTTP, MCP HTTP, MCP stdio, direct adapter, and target-repo CLI paths are all exercised;
- external target validation-plan dogfood exists for multiple non-SCI repos, including a sibling JavaScript target, a clean worktree of mixed Python/Rust `agent-kernel`, and a clean Clojure worktree;
- interactive SLO guidance and lightweight elapsed-time history exist;
- IW50 closure review records the Alpha MVP closure boundary in `docs/project/phase-1-closure-review.md`.

## Next recommended hardening

After IW50/IW51, do not add more interface dogfood by default. Prefer one of:

1. Alpha maintenance/regression work when evidence fails, using `docs/project/alpha-maintenance-backlog.md` when it fits;
2. targeted hardening tied to a named closure-review gap; or
3. an explicit Phase 2 decision review before any UI/workbench implementation.

Do not start Phase 2 UI/workbench polish solely because the Alpha MVP interface set is documented. IW52 produced a draft pointing toward evidence review, and IW53 defines the evidence review contract in `docs/project/evidence-review-contract.md`, but superseded AK decision `46` is not accepted authority.
