---
summary: "Troubleshooting the supported SCI Alpha source-checkout, MCP, HTTP, CLI, snapshot, and validation paths."
read_when:
  - "SCI fails to build, start, answer tool calls, stage snapshots, or pass the Alpha gate."
type: "runbook"
---

# Troubleshooting

This runbook covers the current source-checkout Alpha surface. Historical deployment, dashboard, learning-pipeline, and package-publication instructions are not supported troubleshooting paths.

## Establish the environment

```bash
bun --version
node --version
git status --short
bun install --frozen-lockfile
bun run typecheck
```

The canonical CI runtime is Bun 1.3.12. The package declares Bun 1.2+ and Node 18+ compatibility, but reproduce CI-only failures with the pinned CI version first.

## Run focused contract checks

```bash
bun run command-surface:check
bun run alpha:mvp:test
./scripts/ci/portable.sh
```

Run the complete Alpha evidence bundle only after focused checks pass:

```bash
bun run alpha:mvp:check
```

The full bundle writes generated files under `.test-results/` and snapshots under `.ontology/snapshots/`.

## Service startup

```bash
just start
just status
```

Defaults:

- HTTP API: `http://localhost:7000`
- MCP HTTP: `http://localhost:7001/mcp`
- LSP TCP: port 7002

Check health and current routes:

```bash
curl -sS http://localhost:7000/health | jq .
curl -sS http://localhost:7000/openapi.json | jq '.info'
curl -sS http://localhost:7001/health | jq .
```

If a port is occupied:

```bash
ss -ltnp | grep -E ':(7000|7001|7002)\b'
HTTP_API_PORT=8000 MCP_HTTP_PORT=8001 LSP_SERVER_PORT=8002 just start
```

## HTTP tool-call failures

Use the canonical endpoint and preserve the distinction between transport/tool errors and valid domain outcomes:

```bash
curl -sS -X POST http://localhost:7000/api/v1/tools/call \
  -H 'content-type: application/json' \
  -d '{"name":"read_file","arguments":{"path":"README.md","range":{"startLine":1,"endLine":10}}}' \
  | jq .
```

- `success:false` indicates a tool invocation error.
- A successful invocation may return a payload containing `ok:false` for a refused apply, failed check, or failed staging operation.
- Registered legacy tools are intentionally rejected by the Alpha membrane.

Use `GET /api/v1/stats`, not historical root `/stats`, `/concepts`, or `/patterns` examples.

## MCP stdio problems

Build before pointing a client at the generated stdio entrypoint:

```bash
bun run build:mcp-stdio
bun run dist/mcp/mcp.js
```

MCP stdio stdout must contain only protocol messages. Diagnostics belong on stderr. To isolate client configuration issues, run the protocol tests:

```bash
bun test tests/alpha-mvp-mcp-stdio-protocol.test.ts
```

For MCP HTTP session problems, run:

```bash
bun test tests/alpha-mvp-mcp-http-protocol.test.ts
```

A Streamable HTTP client must initialize first and retain the returned `Mcp-Session-Id`.

## CLI problems

Run from the target repository working directory and use target-relative paths:

```bash
semantic-code-intelligence workflow read_file \
  --args '{"path":"README.md","range":{"startLine":1,"endLine":10}}' \
  --json
```

If the global executable is not provisioned, use the built source-checkout entrypoint or establish the repo-local link described in `docs/project/target-repo-cli-usage.md`.

CLI check failures should exit nonzero. Domain output remains machine-readable on stdout; inspect stderr for invocation diagnostics.

## Snapshot and patch failures

Snapshots live under `.ontology/snapshots/`.

Common structured failures:

- invalid or ambiguous unified diff;
- path outside the workspace;
- staging failed, so checks were not run;
- unknown snapshot id;
- guarded apply refused because `ALLOW_SNAPSHOT_APPLY=1` is absent;
- checks failed;
- applied-state verification did not match the reviewed snapshot.

Inspect narrow artifacts through the supported workflow:

```bash
semantic-code-intelligence workflow extract_snapshot_artifacts \
  --args '{"snapshot":"<id>","includeContent":true}' \
  --json
```

Manual cleanup:

```bash
just snap_clean 25 3
```

To preserve diagnostic snapshots temporarily:

```bash
export SCI_SNAPSHOT_AUTO_CLEANUP=0
```

Do not commit `.ontology`, `.test-results`, database files, logs, or snapshot artifacts.

## Structural workflow failures

`structural_search` and `structural_patch_checks` require ast-grep:

```bash
command -v ast-grep || command -v sg
```

Absence should produce the structured `ast_grep_unavailable` status rather than an unhandled error. Run focused coverage with:

```bash
bun test tests/alpha-mvp-cli-parity.test.ts
```

## Graph results look sparse

This may be expected Alpha behavior. `graph_expand` is one-hop/best-effort and reports backend provenance, supported edges, limitations, and fallback status.

Check:

- the seed file or symbol is workspace-contained;
- the language/backend reports support for the requested edge;
- a SCIP index is available when the workflow expects one;
- limitations explain a syntactic or grep fallback.

Do not treat an empty or fallback-shaped result as proof that no dependency exists.

## Performance concerns

Current Alpha evidence detects coarse regressions but is not a production SLO system:

```bash
bun run alpha:evidence:history
bun run alpha:evidence:packet
```

Review `docs/project/interactive-slo-guidance.md`. Separate selected-command runtime from SCI overhead before attributing a slow snapshot check to SCI.

Current metrics:

```bash
curl -sS 'http://localhost:7000/metrics?format=json' | jq .
```

Do not rely on historical fixed latency tables or “never stale” cache guarantees.

## Repository-integrity failures

Portable checks:

```bash
./scripts/ci/portable.sh
```

This validates CI smoke, frozen task-scope snapshot structure, and migration hygiene without requiring an AK database.

Local authority reconciliation:

```bash
./scripts/ci/full.sh
```

The full check additionally requires installed Agent Kernel access and verifies live work-item and task-scope projection drift. A generic GitHub runner cannot truthfully substitute for this owner-authority check.

## Reporting an issue

Include:

- exact command and exit code;
- Bun/Node versions;
- interface used: CLI, HTTP, MCP stdio, or MCP HTTP;
- structured error code/status with secrets and machine-local paths redacted;
- whether the working tree changed;
- focused test result;
- snapshot id only when sharing it is safe and useful.

Track executable remediation in Agent Kernel rather than adding an item to historical `NEXT_STEPS.md` or `PROJECT_STATUS.md`.
