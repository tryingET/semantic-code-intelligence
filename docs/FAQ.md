---
summary: "Frequently asked questions for the supported Semantic Code Intelligence Alpha surface."
read_when:
  - "You need installation, interface, safety, language, or product-boundary answers for SCI."
type: "reference"
---

# Frequently asked questions

## What is Semantic Code Intelligence?

SCI is a local-first code-navigation and change-planning substrate for harnessed coding agents. It exposes bounded reads/search, definition and reference navigation, graph-impact hints, check recommendations, preview-first snapshot patches, explicit checks, and guarded application through MCP, HTTP, and CLI.

It is not a replacement for language-specific compilers or type checkers, and its Alpha graph evidence is not a complete whole-program semantic model.

## Who is the current user?

The Phase 1 user is a harnessed LLM coding session running in Pi, Claude Code, Cursor, or a comparable tool host. Human IDE polish, dashboards, CI review products, deployment, and package publication are later-phase concerns.

See `docs/project/product-posture.md`.

## How do I install it?

Use a source checkout unless your environment has explicitly provisioned the CLI:

```bash
git clone https://github.com/tryingET/semantic-code-intelligence.git
cd semantic-code-intelligence
bun install --frozen-lockfile
bun run build:all
bun run alpha:mvp:check
```

The public npm registry is not currently an assumed distribution channel, so do not rely on `npm install -g` or `bunx` in portable instructions.

## Which interfaces are supported?

In order:

1. MCP stdio or MCP Streamable HTTP;
2. HTTP `POST /api/v1/tools/call`;
3. CLI `workflow <name>`.

LSP and VS Code implementation code exists but is not a polished or supported Phase 1 product commitment.

## Which tools are supported?

The canonical 20-tool list is maintained in `docs/project/alpha-mvp-contract.md` and `src/core/tools/alpha-mvp-contract.ts`. The runtime registry also contains legacy and experimental tools, but protocol adapters do not expose those through the default Alpha membrane.

## What languages are supported?

Support varies by operation and backend:

- text and bounded file workflows are language-neutral;
- Tree-sitter-backed AST behavior is strongest where a configured parser exists;
- graph expansion has characterized TypeScript/JavaScript, Python, Rust, Go, and fallback behavior;
- ast-grep structural workflows support languages available in the installed ast-grep runtime.

A structured fallback or explicit unsupported status is valid Alpha behavior. Do not infer uniform semantic richness across languages.

## Does SCI write files automatically?

Preview is the default. Patch workflows stage a diff in a snapshot and run caller-selected checks without changing the canonical working tree.

Application requires an apply-capable workflow, passing checks, explicit apply intent, and:

```bash
export ALLOW_SNAPSHOT_APPLY=1
```

`safe_write` additionally verifies the applied tree against the reviewed snapshot and returns rollback evidence.

## What HTTP endpoints should I use?

Current primary endpoints include:

- `GET /health`
- `GET /metrics?format=json|prometheus`
- `GET /openapi.json`
- `POST /api/v1/tools/call`
- `GET /api/v1/stats`
- `GET /api/v1/snapshots`
- `POST /api/v1/snapshots/clean`
- MCP Streamable HTTP at port 7001 under `/mcp`

Treat older `/concepts`, `/patterns`, `/analyze`, `/suggest`, `/export`, and `/import` examples as historical unless they appear in the current OpenAPI document and supported Alpha contract.

## How do I integrate SCI with CI?

The repository’s current Alpha gate is:

```bash
bun run alpha:mvp:check
```

This validates SCI itself. SCI is not yet a supported general-purpose pull-request annotation or autonomous review product.

## Where is configuration documented?

See `CONFIG.md`. Default local ports are:

- HTTP API: 7000 (`HTTP_API_PORT`)
- MCP HTTP: 7001 (`MCP_HTTP_PORT`)
- LSP TCP: 7002 (`LSP_SERVER_PORT`)

## How are snapshots retained?

Snapshots live under `.ontology/snapshots/`. Automatic cleanup defaults to 25 snapshots per workspace and a three-day age bound. See the snapshot-retention section in `README.md` for environment overrides and manual cleanup.

## Is generated evidence durable?

`.test-results/*.json` and snapshot artifacts are local run evidence. They do not become canonical task, decision, direction, or durable evidence truth. Agent Kernel owns those facts and must receive any explicit evidence promotion.

## Is SCI production ready?

No. Phase 1 is closed as an Alpha MVP substrate. Passing validation does not establish production p95/p99, cross-machine stability, complete graphs, polished IDE UX, package publication, or production deployment readiness.

## Where should I report or plan work?

Use Agent Kernel tasks for executable work and deferments. Do not use `NEXT_STEPS.md`, `PROJECT_STATUS.md`, session TODOs, or generated evidence files as a parallel backlog.
