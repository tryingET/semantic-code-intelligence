---
summary: "Semantic Code Intelligence: bounded code navigation, snapshot patching, and validation evidence for harnessed coding agents."
read_when:
  - "You need the supported Semantic Code Intelligence product surface or source-checkout workflow."
  - "You are changing README.md, public commands, protocols, or Alpha behavior."
type: "reference"
---

# Semantic Code Intelligence

Semantic Code Intelligence (SCI) is a local-first code-navigation and change-planning substrate for **harnessed LLM coding sessions**. It gives coding agents bounded repository reads, symbol and graph context, preview-first patches, explicit checks, and reviewable evidence through MCP, HTTP, and CLI contracts.

Phase 1 is closed as an **Alpha MVP substrate**. SCI is not a production-ready deployment product, polished IDE product, canonical task/evidence store, or whole-program semantic oracle.

Read first:

- [Product posture](docs/project/product-posture.md)
- [Alpha MVP contract](docs/project/alpha-mvp-contract.md)
- [Alpha MVP validation](docs/project/alpha-mvp-validation.md)
- [Phase 1 closure review](docs/project/phase-1-closure-review.md)
- [Interface choice guide](docs/project/interface-choice-guide.md)

## Supported Alpha surface

The supported interface order is:

1. MCP tools over stdio or Streamable HTTP;
2. HTTP `POST /api/v1/tools/call` for deterministic parity and non-MCP harnesses;
3. CLI `workflow <name>` for local verification and fallback.

The supported 20-tool contract is:

| Concern | Tools |
|---|---|
| Snapshot and bounded reads | `get_snapshot`, `read_file`, `extract_snapshot_artifacts` |
| Search and navigation | `text_search`, `symbol_search`, `ast_query`, `find_definition`, `find_references` |
| Impact and validation planning | `graph_expand`, `recommend_checks`, `explore_symbol_impact`, `locate_confirm_definition` |
| Preview-first changes | `propose_patch`, `patch_checks_in_snapshot`, `structural_search`, `structural_patch_checks`, `rename_safely` |
| Checks and guarded mutation | `run_checks`, `apply_snapshot`, `safe_write` |

The runtime contains additional legacy, diagnostic, pipeline, LSP, and experimental functionality. Those surfaces are not Alpha commitments unless promoted into the contract above.

## Safety model

SCI is designed around these boundaries:

- repository paths are lexically and physically contained;
- reads and searches are bounded by explicit limits;
- changes are represented as reviewable diffs before application;
- checks are explicit and return structured receipts;
- failed staging prevents checks or apply from being reported as successful;
- snapshot apply requires `ALLOW_SNAPSHOT_APPLY=1`;
- `safe_write` also verifies the applied working tree against the reviewed snapshot;
- learned patterns can advise but do not become hidden policy;
- Agent Kernel remains the owner of canonical task, decision, direction, and evidence truth.

Graph results are best-effort planning evidence. Recursive whole-program graph expansion and uniform semantic richness across languages are not Alpha guarantees.

## Architecture

```text
CLI / MCP stdio / MCP HTTP / HTTP / LSP
                    |
          protocol adapters
                    |
 Tool registry -> workflow router -> workflow services
                    |
        protocol-independent CodeAnalyzer
                    |
 fast search -> AST -> planner -> ontology -> pattern learning
                    |
       configured storage + snapshot overlays
```

The five layers are architectural groupings and metric boundaries, not a guarantee that every operation traverses one strict pipeline:

1. fast search;
2. Tree-sitter AST analysis;
3. symbol-map and rename planning;
4. ontology and semantic graph;
5. pattern learning and propagation.

Primary source entrypoints are built from:

- `src/core/index.ts`
- `src/servers/cli.ts`
- `src/servers/http.ts`
- `src/servers/mcp-stdio-entry.ts`
- `src/servers/mcp-http.ts`
- `src/servers/lsp.ts`

## Source checkout

Prerequisites:

- Bun 1.2 or newer;
- Node.js 18 or newer for Node-compatible tooling;
- `ast-grep`/`sg` only when using structural workflows;
- an MCP client only when exercising MCP integration.

```bash
git clone https://github.com/tryingET/semantic-code-intelligence.git
cd semantic-code-intelligence
bun install --frozen-lockfile
bun run build:all
bun run alpha:mvp:check
```

Equivalent repository command:

```bash
just alpha-mvp-check
```

The public npm package is not currently an assumed distribution channel. Use the source checkout or an explicitly provisioned local/global CLI. For target-repository usage, see [docs/project/target-repo-cli-usage.md](docs/project/target-repo-cli-usage.md).

## Run local services

```bash
just start
```

Default local addresses:

| Surface | Address | Override |
|---|---|---|
| HTTP API | `http://localhost:7000` | `HTTP_API_PORT` |
| MCP Streamable HTTP | `http://localhost:7001/mcp` | `MCP_HTTP_PORT` |
| LSP TCP | port `7002` | `LSP_SERVER_PORT` |

Useful checks:

```bash
curl -sS http://localhost:7000/health
curl -sS 'http://localhost:7000/metrics?format=json' | jq .
curl -sS http://localhost:7001/health
just status
```

Runtime configuration and storage adapter settings are documented in [CONFIG.md](CONFIG.md).

## MCP configuration

Build first, then point an MCP stdio client at the generated entrypoint:

```json
{
  "mcpServers": {
    "semantic-code-intelligence": {
      "command": "bun",
      "args": [
        "run",
        "/absolute/path/to/semantic-code-intelligence/dist/mcp/mcp.js"
      ]
    }
  }
}
```

For a long-lived MCP host, initialize Streamable HTTP at `POST http://localhost:7001/mcp` and retain the returned `Mcp-Session-Id` header.

A client that supports Streamable HTTP can use:

```json
{
  "mcpServers": {
    "semantic-code-intelligence-http": {
      "type": "streamable-http",
      "url": "http://localhost:7001/mcp"
    }
  }
}
```

## CLI examples

Run the CLI from the repository being inspected so paths remain target-relative.

Bounded file read:

```bash
semantic-code-intelligence workflow read_file \
  --args '{"path":"README.md","range":{"startLine":1,"endLine":40}}' \
  --json
```

Text search:

```bash
semantic-code-intelligence workflow text_search \
  --args '{"query":"alpha-mvp-check","path":"."}' \
  --json
```

Definition and references:

```bash
semantic-code-intelligence find CodeAnalyzer --json
semantic-code-intelligence references CodeAnalyzer --json
```

Generic HTTP call:

```bash
curl -sS -X POST http://localhost:7000/api/v1/tools/call \
  -H 'content-type: application/json' \
  -d '{
    "name": "read_file",
    "arguments": {
      "path": "README.md",
      "range": {"startLine": 1, "endLine": 40}
    }
  }' | jq .
```

## Preview-first patch workflow

The primary autonomous-safe path is `safe_write`. Preview remains the default. A caller supplies the patch and explicit commands; check recommendations are advisory and do not silently alter the selected commands.

```bash
semantic-code-intelligence workflow safe_write \
  --args "$(jq -n \
    --rawfile patch change.diff \
    '{patch:$patch,commands:["bun run typecheck"],recommendChecks:true,apply:false}')" \
  --json
```

Guarded apply additionally requires:

```bash
export ALLOW_SNAPSHOT_APPLY=1
```

Do not enable guarded apply until the returned diff and checks have been reviewed.

## Snapshot retention

Snapshot materialization lives under `.ontology/snapshots/`. To prevent dogfood and test loops from accumulating stale snapshots, `OverlayStore.createSnapshot()` performs best-effort local cleanup by default:

- target at most `SCI_SNAPSHOT_MAX_KEEP` snapshots per workspace root (default `25`), while preserving snapshots with active materialization locks;
- delete unlocked snapshots older than `SCI_SNAPSHOT_MAX_AGE_DAYS` (default `3`);
- throttle routine age scans with `SCI_SNAPSHOT_CLEANUP_INTERVAL_MS` (default `300000`) and `SCI_SNAPSHOT_CLEANUP_EVERY` (default `25` snapshot creations); count pressure bypasses the throttle;
- set `SCI_SNAPSHOT_AUTO_CLEANUP=0` only when deliberately preserving diagnostic snapshots.

Manual cleanup:

```bash
just snap_clean 25 3
```

Or, with the HTTP server running:

```bash
curl -sS -X POST http://localhost:7000/api/v1/snapshots/clean \
  -H 'content-type: application/json' \
  -d '{"maxKeep":25,"maxAgeDays":3}' | jq .
```

Snapshot metadata and narrow artifacts may persist across CLI processes. SCI does not claim a general durable session or canonical evidence database; promote durable execution evidence through Agent Kernel.

## Validation and dogfooding

Canonical Alpha validation:

```bash
bun run alpha:mvp:check
# or
just alpha-mvp-check
```

Focused development checks:

```bash
bun run typecheck
bun run command-surface:check
bun run alpha:mvp:test
just test
just test-slices 6
```

Dogfood and evidence producers:

```bash
bun run alpha:mvp:dogfood
bun run self:dogfood:cli
bun run structural:dogfood
bun run graph:dogfood
bun run recommend-checks:dogfood
bun run safe-write:dogfood
bun run alpha:evidence:check
bun run alpha:evidence:history
bun run alpha:evidence:packet
```

Generated `.test-results/*.json` evidence proves the current tested run only. It is not canonical AK evidence, a production SLO history, or a guarantee for every target repository.

Repository integrity checks:

```bash
./scripts/ci/portable.sh
./scripts/ci/full.sh  # additionally requires live AK authority access
```

## Current status and non-goals

Phase 1 is closed as an Alpha MVP substrate for bounded harnessed coding sessions. Current work should be limited to:

- concrete maintenance and regression fixes;
- targeted hardening tied to a named closure gap;
- explicit review before Phase 2 IDE, dashboard, or workbench work.

Not currently supported as product commitments:

- production Kubernetes or hosted deployment;
- polished VS Code or human IDE workflows;
- complete whole-program call graphs;
- production p95/p99 or cross-machine SLOs;
- marketplace, analytics, or AI-training claims;
- autonomous unreviewed writes;
- canonical task, decision, direction, or evidence authority.

Historical production, deployment, roadmap, and benchmark documents are retained only as historical material where marked. Current authority for scope and runtime work is Agent Kernel plus the project posture and Alpha contract linked at the top of this README.

## Contributing

Normal work follows the repository’s main-first policy and an AK-backed scoped task when operational work is being tracked.

Before closeout, run the narrowest relevant checks and then the canonical gate appropriate to the change. Do not report generated SCI evidence as durable AK evidence without explicit promotion through the AK evidence surface.

See:

- [AGENTS.md](AGENTS.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [TESTING_STRATEGY.md](TESTING_STRATEGY.md)
- [docs/engineering.local.md](docs/engineering.local.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
