---
summary: "Semantic Code Intelligence: bounded code navigation, snapshot patching, and validation evidence for harnessed coding agents."
read_when:
  - "You need the supported Semantic Code Intelligence product surface or source-checkout workflow."
  - "You are changing README.md, public commands, protocols, or Alpha behavior."
type: "reference"
---

# Semantic Code Intelligence

Semantic Code Intelligence (SCI) is a local-first code-navigation and change-planning substrate for **harnessed LLM coding sessions**. It gives coding agents bounded repository reads, symbol and graph context, preview-first patches, explicit checks, and reviewable evidence through MCP, HTTP, and CLI contracts.

Phase 1 is closed as an **Alpha MVP substrate**. ADR-0004 additionally defines a bounded **local single-user production candidate** for an installed runtime tarball used through CLI or MCP stdio by a trusted operator on a trusted repository. SCI is not a hosted or multi-tenant production service, polished IDE product, canonical task/evidence store, or whole-program semantic oracle.

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

The public npm package is not currently an assumed distribution channel. Use the source checkout or an explicitly provisioned local candidate. For target-repository usage, see [docs/project/target-repo-cli-usage.md](docs/project/target-repo-cli-usage.md).

## Local single-user production candidate

### Build and validate (source checkout only)

From a tracked-clean source checkout, build and dogfood the exact local runtime artifact with:

```bash
bun run production:candidate:check
```

This source-only command creates an ignored versioned tarball and manifest, installs it into an isolated directory, and exercises the installed CLI and MCP stdio bins against a non-mutating fixture. The evidence packet is written to `.test-results/local-production-candidate.json`; `candidateReady: true` additionally requires a tracked-clean source commit. Repository scripts, `just` recipes, tests, and source files are not included in the installed tarball.

The candidate trust boundary is one trusted local operator and one trusted repository. Repository checks are not sandboxed hostile-code execution. HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, package publication, hosted operation, and multiple tenants remain unsupported production claims. See [the production-candidate contract](docs/project/local-single-user-production-readiness.md).

### Installed local single-user candidate

The installed path does not require a source checkout. It does require Bun 1.2 or newer, `jq`, GNU coreutils (`sha256sum`, `readlink -f`, and `rm --one-file-system`), and an explicitly provisioned trusted local candidate set containing:

- `semantic-code-intelligence-2.1.0-rc.1.tgz`;
- `artifact-manifest.json` from the same candidate build;
- the expected producer/authenticity information supplied by the accountable operator.

The SCI archive itself is installed from a local file; SCI is not fetched from or published to a registry by this procedure. The archive does **not** vendor its runtime dependencies, however. `bun add` resolves them from the configured Bun registry or local cache, and `--no-save` retains no dependency lock. Installation is therefore not network-free or a hermetic dependency closure. Use only an operator-approved registry/cache and stop if dependency provenance or availability is unacceptable.

Verify the archive before installing it:

```bash
set -euo pipefail
export SCI_VERSION=2.1.0-rc.1
export SCI_ARCHIVE=/trusted/path/semantic-code-intelligence-2.1.0-rc.1.tgz
export SCI_MANIFEST=/trusted/path/artifact-manifest.json

test -f "$SCI_ARCHIVE"
test -f "$SCI_MANIFEST"
EXPECTED_SHA256="$(jq -er '.artifact.sha256' "$SCI_MANIFEST")"
ACTUAL_SHA256="$(sha256sum "$SCI_ARCHIVE" | awk '{print $1}')"
test "$ACTUAL_SHA256" = "$EXPECTED_SHA256"
```

Install each candidate into a fresh version directory with package lifecycle scripts disabled:

```bash
# lifecycle-install-v1
set -euo pipefail
: "${SCI_VERSION:?set SCI_VERSION after checksum verification}"
: "${SCI_ARCHIVE:?set SCI_ARCHIVE after checksum verification}"
case "$SCI_VERSION" in ''|*/*|.|..) echo 'invalid version identifier' >&2; exit 2 ;; esac

REQUESTED_SCI_ROOT="${SCI_ROOT:-${XDG_DATA_HOME:-$HOME/.local/share}/semantic-code-intelligence}"
case "$REQUESTED_SCI_ROOT" in /*) ;; *) echo 'SCI_ROOT must be absolute' >&2; exit 2 ;; esac
if [ -L "$REQUESTED_SCI_ROOT" ]; then echo 'SCI_ROOT must not be a symlink' >&2; exit 2; fi
install -d -m 700 "$REQUESTED_SCI_ROOT"
export SCI_ROOT="$(cd "$REQUESTED_SCI_ROOT" && pwd -P)"
if [ -L "$SCI_ROOT/versions" ]; then echo 'versions root must not be a symlink' >&2; exit 2; fi
install -d -m 700 "$SCI_ROOT/versions"
SCI_VERSIONS="$(cd "$SCI_ROOT/versions" && pwd -P)"
test "$SCI_VERSIONS" = "$SCI_ROOT/versions"

export SCI_VERSION_ROOT="$SCI_VERSIONS/$SCI_VERSION"
if [ -e "$SCI_VERSION_ROOT" ] || [ -L "$SCI_VERSION_ROOT" ]; then
  echo 'version directory already exists; refusing overwrite' >&2
  exit 2
fi
install -d -m 700 "$SCI_VERSION_ROOT"
test "$(cd "$SCI_VERSION_ROOT" && pwd -P)" = "$SCI_VERSION_ROOT"
printf '{"name":"sci-local-install","private":true}\n' > "$SCI_VERSION_ROOT/package.json"
bun add --cwd "$SCI_VERSION_ROOT" --no-save --production --ignore-scripts "$SCI_ARCHIVE"

SCI_BIN="$SCI_VERSION_ROOT/node_modules/.bin"
test "$("$SCI_BIN/semantic-code-intelligence" --version)" = "$SCI_VERSION"
test "$("$SCI_BIN/sci" --version)" = "$SCI_VERSION"
test -x "$SCI_BIN/semantic-code-mcp"
```

Activate the reviewed version through one local symlink, prepend its bin directory to `PATH`, and verify discovery. Add the `PATH` export to the trusted operator's shell profile only if persistent CLI activation is desired.

```bash
set -euo pipefail
: "${SCI_ROOT:?run the checked installation block first}"
: "${SCI_VERSION_ROOT:?run the checked installation block first}"
if [ -e "$SCI_ROOT/current" ] && [ ! -L "$SCI_ROOT/current" ]; then
  echo 'current activation path exists and is not a symlink' >&2
  exit 2
fi
ln -sfn "$SCI_VERSION_ROOT" "$SCI_ROOT/current"
test "$(readlink -f "$SCI_ROOT/current")" = "$SCI_VERSION_ROOT"
export PATH="$SCI_ROOT/current/node_modules/.bin:$PATH"
hash -r
command -v semantic-code-intelligence
command -v sci
command -v semantic-code-mcp
test "$(semantic-code-intelligence --version)" = "$SCI_VERSION"
```

Run CLI calls from the trusted target repository and bind the workspace explicitly:

```bash
export TARGET_REPO=/absolute/path/to/trusted/repository
cd "$TARGET_REPO"
SEMANTIC_CODE_WORKSPACE="$TARGET_REPO" \
  semantic-code-intelligence workflow read_file \
  --args '{"path":"README.md","range":{"startLine":1,"endLine":40}}' \
  --json
```

For MCP stdio, resolve the installed wrapper and copy the command's exact absolute output into the client configuration; do not use a source `dist/` path:

```bash
SCI_MCP_COMMAND="$(readlink -f "$SCI_ROOT/current/node_modules/.bin/semantic-code-mcp")"
test -x "$SCI_MCP_COMMAND"
printf '%s\n' "$SCI_MCP_COMMAND"
```

Replace the example `command` and repository paths below with actual absolute local paths. Bun must be available in the MCP client's process environment because the installed wrapper uses a Bun shebang.

```json
{
  "mcpServers": {
    "semantic-code-intelligence": {
      "command": "/absolute/path/reported/by/readlink/semantic-code-mcp",
      "args": [],
      "env": {
        "SEMANTIC_CODE_WORKSPACE": "/absolute/path/to/trusted/repository",
        "MCP_LOG_DIR": "/absolute/path/to/trusted/repository/.ontology/logs"
      }
    }
  }
}
```

#### Upgrade

Verify the new archive and manifest first, then repeat the installation into a **new** `versions/<version>` directory. Exercise the new version's absolute CLI and MCP-stdio paths before switching `current`. Stop or disconnect MCP clients, switch the symlink, and restart them:

Set `SCI_VERSION`, `SCI_ARCHIVE`, and `SCI_MANIFEST` to the new reviewed candidate, then repeat the checksum and `lifecycle-install-v1` blocks above. Before activation, validate the exact absolute candidate bin and fail closed if `current` is not a symlink:

```bash
set -euo pipefail
: "${SCI_VERSION:?set the new reviewed version}"
: "${SCI_VERSION_ROOT:?install the new reviewed version first}"
NEW_SCI_BIN="$SCI_VERSION_ROOT/node_modules/.bin/semantic-code-intelligence"
test -x "$NEW_SCI_BIN"
test "$("$NEW_SCI_BIN" --version)" = "$SCI_VERSION"
# Exercise this version's absolute CLI and MCP-stdio paths before switching.
if [ -e "$SCI_ROOT/current" ] && [ ! -L "$SCI_ROOT/current" ]; then
  echo 'current activation path exists and is not a symlink' >&2
  exit 2
fi
ln -sfn "$SCI_VERSION_ROOT" "$SCI_ROOT/current"
test "$(readlink -f "$SCI_ROOT/current")" = "$SCI_VERSION_ROOT"
hash -r
test "$(semantic-code-intelligence --version)" = "$SCI_VERSION"
```

Keep the previous reviewed version directory until the upgrade has been accepted. Never overwrite a version directory or reuse one version for different bytes. Upgrading the runtime does not migrate or delete target-repository `.ontology` state.

#### Rollback

Select a previously retained and reviewed version, switch only `current`, and restart MCP clients. Do not roll back by replacing bytes inside an existing version directory.

Set `ROLLBACK_VERSION` to the retained version identifier, then run:

```bash
set -euo pipefail
: "${SCI_ROOT:?set SCI_ROOT to the checked install root}"
: "${ROLLBACK_VERSION:?set ROLLBACK_VERSION to a reviewed retained version}"
case "$ROLLBACK_VERSION" in ''|*/*|.|..) echo 'invalid version identifier' >&2; exit 2 ;; esac
if [ -L "$SCI_ROOT" ]; then echo 'SCI_ROOT must not be a symlink' >&2; exit 2; fi
export SCI_ROOT="$(cd "$SCI_ROOT" && pwd -P)"
if [ -L "$SCI_ROOT/versions" ]; then echo 'versions root must not be a symlink' >&2; exit 2; fi
SCI_VERSIONS="$(cd "$SCI_ROOT/versions" && pwd -P)"
test "$SCI_VERSIONS" = "$SCI_ROOT/versions"
export ROLLBACK_ROOT="$SCI_VERSIONS/$ROLLBACK_VERSION"
test -d "$ROLLBACK_ROOT"
test ! -L "$ROLLBACK_ROOT"
test "$(cd "$ROLLBACK_ROOT" && pwd -P)" = "$ROLLBACK_ROOT"
ROLLBACK_BIN="$ROLLBACK_ROOT/node_modules/.bin/semantic-code-intelligence"
test -x "$ROLLBACK_BIN"
test "$("$ROLLBACK_BIN" --version)" = "$ROLLBACK_VERSION"
if [ -e "$SCI_ROOT/current" ] && [ ! -L "$SCI_ROOT/current" ]; then
  echo 'current activation path exists and is not a symlink' >&2
  exit 2
fi
ln -sfn "$ROLLBACK_ROOT" "$SCI_ROOT/current"
test "$(readlink -f "$SCI_ROOT/current")" = "$ROLLBACK_ROOT"
hash -r
test "$(semantic-code-intelligence --version)" = "$ROLLBACK_VERSION"
```

Rollback preserves each target repository's `.ontology` directory. If runtime-state compatibility is in doubt, stop and back up that directory under the target repository owner's policy rather than deleting it.

#### Uninstall

Remove the MCP client entry and any persistent `PATH` line first. Then remove only the selected versioned runtime. The containment check and non-symlink check below intentionally fail closed:

Set `REMOVE_VERSION` to the exact installed version identifier, then run:

```bash
# lifecycle-uninstall-v1
set -euo pipefail
: "${SCI_ROOT:?set SCI_ROOT to the checked install root}"
: "${REMOVE_VERSION:?set REMOVE_VERSION to the installed version to remove}"
case "$REMOVE_VERSION" in ''|*/*|.|..) echo 'invalid version identifier' >&2; exit 2 ;; esac
case "$SCI_ROOT" in /*) ;; *) echo 'SCI_ROOT must be absolute' >&2; exit 2 ;; esac
if [ -L "$SCI_ROOT" ]; then echo 'SCI_ROOT must not be a symlink' >&2; exit 2; fi
export SCI_ROOT="$(cd "$SCI_ROOT" && pwd -P)"
if [ -L "$SCI_ROOT/versions" ]; then echo 'versions root must not be a symlink' >&2; exit 2; fi
SCI_VERSIONS="$(cd "$SCI_ROOT/versions" && pwd -P)"
test "$SCI_VERSIONS" = "$SCI_ROOT/versions"
export REMOVE_ROOT="$SCI_VERSIONS/$REMOVE_VERSION"
test -d "$REMOVE_ROOT"
test ! -L "$REMOVE_ROOT"
test "$(cd "$REMOVE_ROOT" && pwd -P)" = "$REMOVE_ROOT"
if [ -e "$SCI_ROOT/current" ] && [ ! -L "$SCI_ROOT/current" ]; then
  echo 'current activation path exists and is not a symlink' >&2
  exit 2
fi
if [ -L "$SCI_ROOT/current" ] && [ "$(readlink -f "$SCI_ROOT/current")" = "$REMOVE_ROOT" ]; then
  rm -- "$SCI_ROOT/current"
fi
rm -rf --one-file-system -- "$REMOVE_ROOT"
```

Uninstalling SCI does **not** authorize deletion of `.ontology`, source files, snapshots, logs, or databases inside any target repository. Data retirement requires a separate owner-approved backup and deletion action.

## Run local services (source checkout Alpha only)

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

## MCP configuration (source checkout Alpha)

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

Phase 1 is closed as an Alpha MVP substrate for bounded harnessed coding sessions. The separate ADR-0004 local production candidate is limited to the installed CLI/MCP-stdio artifact and its executable dogfood contract. Current work should be limited to:

- concrete maintenance and regression fixes;
- targeted hardening tied to a named closure gap;
- explicit review before Phase 2 IDE, dashboard, or workbench work.

Not currently supported as product commitments:

- HTTP/MCP HTTP/LSP production service support;
- production Docker, Compose, Kubernetes, or hosted deployment;
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
