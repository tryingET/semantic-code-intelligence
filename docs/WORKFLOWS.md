---
summary: "Workflows & Recipes for the Semantic Code Intelligence repo."
read_when:
  - "You need WORKFLOWS information for Semantic Code Intelligence."
  - "You are changing docs/WORKFLOWS.md or related behavior."
type: "reference"
---

# Workflows & Recipes

Run high-value workflows deterministically through the Semantic Code Intelligence Alpha surface. Prefer MCP for harnessed clients, HTTP tools/call for deterministic parity, and CLI for local fallback.

## Quick Start

- Endpoint: `POST /api/v1/tools/call` with `{ name, arguments }`
- UI: `/ui` — dashboard with snapshots, workflows, and pipelines run‑stream
- OpenAPI: `/openapi.json` — schemas include named workflow results

Transports
- HTTP tools (recommended in CI/scripts); MCP HTTP (JSON‑RPC) and MCP stdio work equally for local dev (keep stdio stdout clean).

## Workflows

### Locate & Confirm Definition
- Purpose: fast locate with precise retry if ambiguous.
- HTTP:
  - `POST /api/v1/tools/call` with `{ "name":"locate_confirm_definition", "arguments": { "symbol":"TestClass", "file":"tests/fixtures/example.ts" } }`
- Returns (LocateConfirmDefinitionResult): `{ ok, symbol, attempts:[{mode,count}], definitions:[...], decision }`
- Note: HTTP returns parsed JSON under `result`.

### Explore Symbol Impact
- Purpose: confirm a definition before edit planning, rank bounded impact, and expose a lawful recovery call when confirmation fails.
- Prefer compact first:
  - `POST /api/v1/tools/call` with `{ "name":"explore_symbol_impact", "arguments": { "symbol":"TestClass", "file":"tests/fixtures/example.ts" } }`
- Modes:
  - `compact` returns the decision packet only.
  - `standard` adds sparse `details.schemaVersion: 2` evidence with `observed` and `usable` counts; empty audit sections and duplicate counts are omitted.
  - `debug` retains the full bounded audit sections, shape failures, subcall status, timings, and sanitized raw fragments.
- Unconfirmed behavior:
  - `ok:false` is a domain decision, not necessarily a transport failure.
  - `evidence.graphImpact:true` means at least one graph item was normalized to a workspace-contained location.
  - A backend-only impact claim with no usable item is degraded and indeterminate rather than actionable.
  - `nextReads[0]` contains `action:"locate_confirm_definition"` and complete bounded `arguments`; when a file filter prevented confirmation, retry without `file`.
- Seed-local path rule: only edge-appropriate tree-sitter import/export/callee records may inherit the already-contained graph seed file; any supplied source position must be a nonnegative safe integer pair. Empty, edge-mismatched, invalid-position, and explicit rejected-path records never inherit that fallback.
- Failed, thrown, or unstructured subcalls contribute bounded debug diagnostics only; their payload data never becomes usable standard or compact evidence.

### Safe Rename (Snapshot + Optional Checks)
- Purpose: plan rename, stage unified diff to snapshot, optionally run checks (no working‑tree writes).
- HTTP:
  - `POST /api/v1/tools/call` with `{ "name":"rename_safely", "arguments": { "oldName":"HTTPServer", "newName":"HTTPServerX", "file":"src/servers/http.ts", "runChecks": false } }`
- Returns (SafeRenameResult): `{ ok, snapshot, filesAffected, totalEdits, elapsedMs?, outputTail?, next_actions }`

### Patch + Checks in Snapshot
- Purpose: stage a unified or `apply_patch` diff and run checks in the snapshot.
- HTTP:
  - `POST /api/v1/tools/call` with `{ "name":"patch_checks_in_snapshot", "arguments": { "patch":"<diff>", "onlyTouched": true, "timeoutSec": 180 } }`
- Returns (PatchChecksInSnapshotResult): `{ ok, snapshot, stage?, checks? }`

#### Common error: invalid_patch
Occurs when the payload is not a recognized diff. Accepted formats are:
- apply_patch format (`*** Begin Patch` … `*** End Patch`)
- git diff (`diff --git a/... b/...`)
- unified diff headers (`--- a/...` and `+++ b/...`)

Examples
- CLI (stdio):
  ```bash
  echo "console.log('oops')" > not-a-diff.txt
  semantic-code-intelligence patch-checks-in-snapshot --patch-file not-a-diff.txt
  # → {"ok":false,"reason":"invalid_patch","message":"Expected unified diff or apply_patch format. Use apply_patch heredoc or pass a diff file (-f)."}
  ```
- HTTP:
  ```bash
  curl -sS -X POST -H 'content-type: application/json' \
    http://localhost:7000/api/v1/tools/call \
    -d '{"name":"patch_checks_in_snapshot","arguments":{"patch":"console.log(\"oops\")"}}' | jq .
  # → { "success": false, "error": { "message": "invalid_patch: Expected unified diff or apply_patch format..." } }
  ```

### Explore Codebase
- Purpose: retrieve definitions, references, and optionally conceptual hints.
- HTTP:
  - `POST /api/v1/tools/call` with `{ "name":"explore_codebase", "arguments": { "symbol":"TestClass", "file":"tests/fixtures/example.ts", "conceptual": true } }`
- Returns: `{ definitions, references, (optional) concepts }`

### Learning Pipelines (L5)
- Purpose: trigger and inspect learning pipelines during dev/dogfooding.
- Scheduled execution is feature-gated: set `PIPELINES_ENABLE=1` to run scheduled pipelines in-process.
- Supported `schedule` formats:
  - Daily cron: `<minute> <hour> * * *` (example: `0 9 * * *`)
  - Hourly cron: `<minute> * * * *` (example: `15 * * * *`)
  - Every N minutes: `*/<N> * * * *` (example: `*/5 * * * *`)
  - Every N hours: `<minute> */<N> * * *` (example: `0 */6 * * *`)
  - Dev interval: `@every <N><s|m|h>` (example: `@every 30s`)
  - Aliases: `@hourly`, `@daily`
- HTTP:
  - List: `{ "name":"list_pipelines", "arguments":{} }`
  - Run: `{ "name":"run_pipeline", "arguments": { "id":"pattern_feedback_cycle" } }`
  - Runs: `{ "name":"list_pipeline_runs", "arguments": { "id":"pattern_feedback_cycle", "limit": 5 } }`
- Stream run output (NDJSON): `POST /api/v1/pipelines/run-stream` and incrementally read lines.

- CLI:
  - `semantic-code-intelligence pipelines list`
  - `semantic-code-intelligence pipelines run pattern_feedback_cycle`
  - `semantic-code-intelligence pipelines runs pattern_feedback_cycle --limit 5`

#### Troubleshooting (timeouts & budgets)
- `run-stream` times out client-side after `timeoutSec` (default: 30, max: 600); re-run with a larger `timeoutSec` or tune `pollMs` (100–2000).
- If a run id is returned but never appears in `/runs`, verify you’re querying the same server/workspace DB and check `.ontology/logs/http-api.log` and `.ontology/logs/mcp-server-<date>.log`.
- If runs are consistently slow, prefer non-stream polling (`/api/v1/pipelines/run` then `/status`/`/runs`) and keep pipelines small during dogfooding.

#### HTTP Endpoints (non-tools parity)
- Start run (non-stream):
  - `POST /api/v1/pipelines/run` body `{ id: "pattern_feedback_cycle" }`
  - Returns `{ success: true, data: { ok: boolean, runId: string } }`
- Run detail (poll-once):
  - `GET /api/v1/pipelines/run?id=pattern_feedback_cycle&runId=<uuid>`
  - Returns `{ success: true, data: { pipelineId, runId, run: { ... } | null } }`
- Pipeline status:
  - `GET /api/v1/pipelines/status?id=pattern_feedback_cycle`
  - Returns `{ success: true, data: { id, name, trigger, schedule, enabled, stats, lastRunAt, nextRunAt, scheduleNote } }`
- Recent runs:
  - `GET /api/v1/pipelines/runs?id=pattern_feedback_cycle&limit=10`
  - Returns `{ success: true, data: { runs: [ { id, pipeline_id, started_at, finished_at, status, metrics } ] } }`
- List pipelines:
  - `GET /api/v1/pipelines`
  - Returns `{ success: true, data: { pipelines: [ { id, name, trigger, schedule?, enabled } ] } }`
- Register pipeline (dev-only):
  - `POST /api/v1/pipelines` body `{ id, name, components:[...], trigger:'manual|automatic|scheduled|event_driven', schedule?, description?, eventTriggers?, enabled? }`
  - Returns `{ success: true, data: { id } }`

Examples:
```bash
curl -sS -X POST -H 'content-type: application/json' \
  http://localhost:7000/api/v1/pipelines/run \
  -d '{"id":"pattern_feedback_cycle"}' | jq .

# Stream run output (NDJSON):
curl -N -sS -X POST -H 'content-type: application/json' \
  http://localhost:7000/api/v1/pipelines/run-stream \
  -d '{"id":"pattern_feedback_cycle","timeoutSec":120,"pollMs":300}'

curl -sS 'http://localhost:7000/api/v1/pipelines/status?id=pattern_feedback_cycle' | jq .
curl -sS 'http://localhost:7000/api/v1/pipelines/runs?id=pattern_feedback_cycle&limit=5' | jq .
curl -sS 'http://localhost:7000/api/v1/pipelines/run?id=pattern_feedback_cycle&runId=<uuid>' | jq .

# Dev-only (register):
curl -sS -X POST -H 'content-type: application/json' \
  http://localhost:7000/api/v1/pipelines \
  -d '{
    "id":"dev_example_1",
    "name":"Dev Example Pipeline",
    "components":["pattern_learning","feedback_loop"],
    "trigger":"manual",
    "enabled": true
  }' | jq .

# Dev-only (register scheduled):
curl -sS -X POST -H 'content-type: application/json' \
  http://localhost:7000/api/v1/pipelines \
  -d '{
    "id":"dev_example_scheduled",
    "name":"Dev Scheduled Pipeline",
    "components":["pattern_learning"],
    "trigger":"scheduled",
    "schedule":"0 9 * * *",
    "enabled": true
  }' | jq .
curl -sS 'http://localhost:7000/api/v1/pipelines/dev_example_1' | jq .
```

## MCP Prompts (MCP stdio/HTTP)

Prompts suggest tool sequences; they do not execute tools.

### plan-safe-rename
- Args: `oldName`, `newName`, `file?`, `runChecks?`, `command?`
- Sequence: `plan_rename` → `rename_safely`
```json
{ "oldName": "HTTPServer", "newName": "HTTPServerX", "file": "src/servers/http.ts", "runChecks": true, "command": "bun run build:all" }
```

### investigate-symbol
- Args: `symbol`, `file?`, `conceptual?`
- Sequence: `explore_codebase` → `build_symbol_map` (astOnly) → `graph_expand` (imports/exports)
```json
{ "symbol": "CodeAnalyzer", "file": "src/core/unified-analyzer.ts", "conceptual": false }
```

### quick-patch-checks
- Args: `command?`, `timeoutSec?`
- Sequence: `get_snapshot` → `propose_patch` → `run_checks` (or `patch_checks_in_snapshot`)
```json
{ "command": "bun run build:all", "timeoutSec": 180 }
```

### locate-confirm
- Args: `symbol`, `file?`
- Sequence: `locate_confirm_definition`
```json
{ "symbol": "HTTPServer", "file": "src/servers/http.ts" }
```

## Snapshot Resources
- Diff: `GET /api/v1/snapshots/{id}/diff` → `{ success, data: { id, diff } }`
- Status: `GET /api/v1/snapshots/{id}/status` → includes `lastApply` summary
- Progress: `GET /api/v1/snapshots/{id}/progress` → progress.log text (when DOGFOOD_PROGRESS=1)
- UI: `/ui` → Snapshots panel with client‑side diff highlighting
- CLI: `just snap_diff_cli <SNAP_ID>` uses `delta` when available

## Outputs & Schemas
- OpenAPI `/openapi.json` includes named schemas for workflow outputs:
  - `LocateConfirmDefinitionResult`
  - `SafeRenameResult`
  - `PatchChecksInSnapshotResult`
- Tool call response (HTTP): `{ success, result, error? }` (result is parsed JSON for workflows)

### Alpha CI evidence artifacts

The canonical `.github/workflows/alpha-mvp.yml` runs `bun run alpha:mvp:check` and uploads generated `.test-results/*.json` artifacts. The dogfood producers and evidence boundaries are documented in `docs/project/alpha-mvp-validation.md`.

`just dogfood_ci` and `docs/dogfood-summary.schema.json` remain local/legacy diagnostic surfaces; they are not the current automatic CI contract.

## Tips
- Prefer HTTP tools in CI; for local dev, MCP stdio via `./mcp-wrapper.sh` is convenient (ensure clean stdout).
- `FAST_STDIO_CHECKS=touched` keeps snapshot checks fast (typecheck touched TS files).
- Use `just safe-apply <file> -- <commands>` or pipe via `just safe-apply-stdin` to stage patches safely inside snapshots.

## Unified Diff Guidance (recommended)

For edits intended to be applied (apply_after_checks / apply_snapshot), prefer git-style unified diffs:

- Modify existing file
  ```diff
  diff --git a/src/file.ts b/src/file.ts
  --- a/src/file.ts
  +++ b/src/file.ts
  @@ -10,2 +10,3 @@
   export function fn() {
  +  // added line
     return 1;
  }
  ```

- Add new file
  ```diff
  diff --git a/new/file.ts b/new/file.ts
  --- /dev/null
  +++ b/new/file.ts
  @@ -0,0 +1,2 @@
  +// new file content
  +export const X = 1;
  ```

Notes
- Parent directories must exist in the working tree for new files; create them first (e.g., `mkdir -p tests/temp`).
- The server accepts `apply_patch` format (`*** Begin Patch` … `*** End Patch`) and converts accepted patches to valid unified diffs for staging. Update hunks are matched against workspace-contained files; stale, unmatched, or ambiguous sparse hunks fail before an invalid overlay diff is accepted.
- Applying to working tree is guarded by `ALLOW_SNAPSHOT_APPLY=1`. Without it, workflows only stage and run checks in snapshots.
- Reverting: use `apply_snapshot` with `{ reverse: true }` and the same snapshot id.

## Apply after checks

- Purpose: Stage patch → run checks → optionally apply to working tree when allowed.
- HTTP/MCP tool: `apply_after_checks` with arguments `{ patch, commands?: string[], timeoutSec?: number }`.
- Guard: Requires `ALLOW_SNAPSHOT_APPLY=1` to write to working tree.
- Domain outcomes such as failed checks or refused/non-applied patches are returned as structured tool results (for example `ok:false`, `applied:false`), not as HTTP transport failures unless the tool invocation itself is invalid.
- Patch workflows fail closed before checks when staging fails; do not treat a clean check receipt as meaningful unless the workflow reports `stage.accepted:true` / staged verification.
- Typical flow:
  1) `get_snapshot` (optional convenience)
  2) `propose_patch` (stage)
  3) `run_checks` (typecheck/build/tests)
  4) `apply_snapshot` (dev only; guard enforced)
