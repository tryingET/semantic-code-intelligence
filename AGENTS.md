---
summary: "AGENTS.md — Guidelines for Agentic Changes in this Repo for the Semantic Code Intelligence repo."
read_when:
  - "You need AGENTS information for Semantic Code Intelligence."
  - "You are changing AGENTS.md or related behavior."
type: "reference"
---

# AGENTS.md — Guidelines for Agentic Changes in this Repo

This document defines how harnessed LLM coding sessions (and humans automating work) should
operate in this repository. It encodes our “fix‑bugs‑first” mindset,
layer mapping, safety rules, and delivery expectations.

## Purpose

- Ensure safe, incremental, high‑signal changes.
- Keep the codebase buildable, testable, and deployable at all times.
- Reduce rework by aligning with the project’s architecture and docs.

## Core Principles

1) Fix bugs first
- Prioritize broken builds, failing tests, and type errors before
  features or refactors.
- Make CI/`tsgo` primary typecheck green for core + adapters before expanding scope; keep `tsc` as fallback during rollout.

2) High-signal, scoped changes
- Target the smallest sufficient context; avoid broad churn.
- When confidence is high, ship a coherent fix/refactor in one pass.
- Use Conventional Commits with clear scopes and rationale.

3) Keep the architecture consistent
- Layers (renumbered):
  - Layer 1: Fast Search
  - Layer 2: AST Analysis
  - Layer 3: Planner (symbol map + rename planning)
  - Layer 4: Ontology / Semantic Graph
  - Layer 5: Pattern Learning & Propagation
- Ontology DB path comes from `layers.layer4.dbPath`.
- Pattern learner config is under `layers.layer5.*`.
- Use Drizzle ORM for TypeScript data access when adding new
  persistence modules; align choices with the engineering guidance document
  referenced below.

4) Pluggable storage mindset
- Treat Layer 4 storage behind a StoragePort with adapters (SQLite,
  Postgres, Triple Store). Do not hard‑code storage specifics into
  higher layers.

5) Observability & SLOs
- Emit/keep metrics per layer (p95/p99, error rate, budgets). Do not
  add noisy logs to stdio‑based protocols.

## Safety Rules

- Do not commit generated artifacts (bundles, logs, pid files).
- Keep protocol stdout clean for stdio servers (e.g., LSP/MCP stdio).
- Do not introduce network calls in core paths without feature flags.
- Use approved environment variables and config (see CONFIG.md).

## Change Workflow

At a glance (local testing quick path): use `just test` for fast, sliced + batched runs. For a single slice use `just test-sliced <N> <K>`, or `just test-ci-like` to mirror CI locally. See “Local Testing (Sliced + Batched)” below.

1) Triage & prepare
- Reproduce issue locally. Capture exact commands.
- For current product direction, prefer `docs/project/product-posture.md`, `docs/project/alpha-mvp-contract.md`, and `docs/project/alpha-mvp-validation.md` over older roadmap/status files.

2) Implement
- Start with the narrowest fix that restores correctness.
- Add or adjust tests narrowly around the fix (when applicable).
- Keep public types stable unless a breaking change is approved.

### SCI Composite-First Editing Policy

Before raw search/read chains on unfamiliar code, call the smallest matching composite workflow:

- unknown symbol or change impact → `explore_symbol_impact`
- uncertain definition → `locate_confirm_definition`
- symbol rename → `rename_safely`
- syntax-shaped transformation → `structural_patch_checks`
- prepared patch preview/check → `patch_checks_in_snapshot` or `safe_write` with `apply:false`

Do not decompose a composite into primitive SCI calls unless its result is insufficient. Use bounded native `read`/`edit` after the workflow identifies the relevant files. Straightforward Markdown or exact textual edits may use native tools directly.

When native SCI Pi tools are registered, prefer them. Otherwise use MCP from a long-lived client or the installed/global CLI from the target repo cwd. If SCI is unavailable or fails, state the fallback briefly before using native search/read tools. Never bake target repo paths into SCI source or docs.

Apply remains separately authorized: keep preview workflows at `apply:false` unless the operator explicitly requests mutation and the server-side apply guard is enabled.

3) Validate
- Build: `bun run build:all`.
- Type‑check: `bun run typecheck` (`tsgo` primary). Use `bun run typecheck:fallback` (`tsc`) only for incident recovery or compatibility diagnosis.
- Tests (fast path): `just test` (sliced + batched). For a single slice use `just test-sliced <N> <K>`; for CI‑like locally use `just test-ci-like`. Tune with `SLICES`, `BATCH_SIZE`, `TIMEOUT`, and prefer `BUN_JOBS=1` for stability.
- Avoid running perf/e2e unless explicitly requested.

4) Commit & docs
- Use Conventional Commits with gitmoji, e.g.:
  - 🐛 fix(adapter): correct completion request shape
  - 📝 docs(vision): align storage adapters roadmap
- Note breaking changes in the commit body; update docs accordingly.

@docs/engineering-ts.md

Tip: for a quick workspace overview, use `eza -T -L 3 --git-ignore --only-dirs` (or `tree -L 3`).

## Protocol Adapter Notes

- LSP adapter:
  - Map Completion → LSP CompletionItem precisely (kinds, fields).
  - Keep textDocumentSync types valid (use enum/object as required).
  - Avoid private method access in class internals.

- MCP adapter:
  - Serialize core types to MCP payloads via explicit mappers.
  - Keep core types out of wire objects to avoid leakage.

- HTTP adapter:
  - Guard optional diagnostics and stats; do not assume interfaces.

## Layer‑Specific Guidance

- L3 Planner: time `buildSymbolMap` and `planRename` via LayerManager
  for clear metrics. Skip learning/propagation during preview (dryRun).
- L4 Ontology: route persistence through StoragePort; budget queries;
  avoid tight coupling to a specific DB.
- L5 Learning & Propagation: attribute both learning and propagation
  time to Layer 5; allow gating by config.

## PR & Review Checklist

- [ ] Fixes/tests first; build green locally.
- [ ] Minimal blast radius; no unrelated refactors.
- [ ] Conventional Commit with clear scope and body.
- [ ] Docs updated when behavior/architecture changes.
- [ ] No generated files or secrets committed.

## Incident Response

- If a change breaks build/test, prioritize a `revert` or minimal hotfix
  over new features. Capture follow-up in AK/task evidence or the relevant `docs/project/` surface.

---

For current Phase 1 direction, read `docs/project/product-posture.md`,
`docs/project/alpha-mvp-contract.md`, and `docs/project/alpha-mvp-validation.md`.



## Dogfooding (MCP‑first)

Prefer dogfooding through the MCP HTTP server (Streamable HTTP) when validating client integration contracts. Use the CLI for local fallback and for target-repo/global command workflows. When building features or fixes, validate via registered SCI tools and workflows rather than by calling internals directly.

### Start servers

```
just start
# HTTP: 7000, MCP HTTP: 7001, LSP: 7002
```

### Open MCP session (JSON‑RPC over HTTP)

Initialize and capture the session id:

```
curl -i -sS -X POST   -H 'content-type: application/json'   http://localhost:7001/mcp   -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | tee /tmp/mcp.init

export MCP_SESSION_ID=$(grep -i ^Mcp-Session-Id: /tmp/mcp.init | awk '{print $2}' | tr -d '
')
echo "MCP_SESSION_ID=$MCP_SESSION_ID"
```

List available tools:

```
curl -sS -X POST -H "content-type: application/json" -H "Mcp-Session-Id: $MCP_SESSION_ID"   http://localhost:7001/mcp   -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | jq .
```

### Explore code via MCP (with conceptual hints)

```
curl -sS -X POST -H "content-type: application/json" -H "Mcp-Session-Id: $MCP_SESSION_ID"   http://localhost:7001/mcp   -d '{
        "jsonrpc":"2.0",
        "id":3,
        "method":"tools/call",
        "params":{
          "name":"explore_codebase",
          "arguments":{ "symbol":"TestClass", "file":"tests/fixtures", "maxResults":50, "conceptual":true }
        }
      }' | jq .
```

Notes:
- Set `L4_AUGMENT_EXPLORE=1` or pass `conceptual: true` to include Layer 4 conceptual hints.
- Conceptual is optional and off by default in core.

### Safe rename (plan → snapshot → checks) via MCP

```
# Plan and stage a safe rename with checks
curl -sS -X POST -H "content-type: application/json" -H "Mcp-Session-Id: $MCP_SESSION_ID"   http://localhost:7001/mcp   -d '{
        "jsonrpc":"2.0",
        "id":4,
        "method":"tools/call",
        "params":{
          "name":"workflow_safe_rename",
          "arguments":{
            "oldName":"HTTPServer",
            "newName":"HTTPServerX",
            "file":"src/servers/http.ts",
            "runChecks":true,
            "commands":["bun run build:all","bun test -q"],
            "timeoutSec":180
          }
        }
      }' | jq .
```

Inspect the staged diff for the snapshot (via MCP resource read):

```
# Replace <SNAP_ID> from previous output
export SNAP_ID=<SNAP_ID>
# diff
curl -sS -X POST -H "content-type: application/json" -H "Mcp-Session-Id: $MCP_SESSION_ID"   http://localhost:7001/mcp   -d '{
        "jsonrpc":"2.0",
        "id":5,
        "method":"resources/read",
        "params":{ "uri":"snapshot://'$'SNAP_ID/overlay.diff" }
      }' | jq -r '.contents[0].text'
# status
curl -sS -X POST -H "content-type: application/json" -H "Mcp-Session-Id: $MCP_SESSION_ID"   http://localhost:7001/mcp   -d '{
        "jsonrpc":"2.0",
        "id":6,
        "method":"resources/read",
        "params":{ "uri":"snapshot://'$'SNAP_ID/status" }
      }' | jq .
```

### Dogfood Workflows (expected during changes)

Keep two purposes distinct:

- **Real-task usage:** composite first → one or two bounded reads → native exact edit or SCI patch construction → `safe_write apply:false` / `patch_checks_in_snapshot` evidence.
- **Contract coverage:** primitive calls may be exercised individually to prove registration, parity, errors, and result shapes. Do not present this as the optimal agent workflow.

For real-task evidence, record the composite calls, justified native fallbacks, primitive shell/search chains avoided, elapsed time, and whether preview left the workspace unchanged. Validate structured results, JSON-RPC errors, and latency budgets with small fixtures.

### Quick helpers
- `just dogfood` (stdio MCP fast path; bounded workspace)
- `just dogfood_full` (includes quick checks via `bun run typecheck`)
- `just sync-ports` to align `.env` ports (if using MCP HTTP locally)

### Optional CLI helpers (local dogfooding)
- `bin/dogfood-explore.sh <symbol> [-f <path>] [--no-conceptual] [--precise] [--json]`
- `bin/self-apply.sh -f my.diff -- bun run build:all "bun test -q"`
- `bun run tmp/dogfood-safe-rename.ts`

### Local Testing (Sliced + Batched)

Use the Justfile runners for fast, predictable local feedback that mirrors CI:

- Fast default: `just test`
- Single slice: `just test-sliced <N> <K>` (e.g., `just test-sliced 6 2`)
- All slices: `just test-slices <N>` (e.g., `just test-slices 6`)
- CI‑like locally: `just test-ci-like`

Tunables:
- `SLICES` (total slices), `BATCH_SIZE` (files per batch), `TIMEOUT` (ms per batch)
- Recommend `BUN_JOBS=1` for stability and lower variance

See also: TESTING_STRATEGY.md (local workflow details) and README.md (quick examples).
