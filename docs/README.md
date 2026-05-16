---
summary: "Documentation Index for the Semantic Code Intelligence repo."
read_when:
  - "You need README information for Semantic Code Intelligence."
  - "You are changing docs/README.md or related behavior."
type: "reference"
---

# Documentation Index

This repository implements a protocol‑agnostic core with thin adapters for MCP (stdio/HTTP), HTTP API, LSP, and CLI. This index highlights how to run it, where to configure it, and how to use the primary workflows.

## Quick Start

- Start servers: `just start`
  - HTTP API: `http://localhost:7000` (override: `HTTP_API_PORT`)
  - MCP HTTP: `http://localhost:7001` (override: `MCP_HTTP_PORT`)
  - LSP: port 7002 or stdio
  - Health: `just health`, Ports: `just status`

- Stdio MCP for tools (for Codex/Claude): `./mcp-wrapper.sh` (lazy init, silent stdio)

## Configuration

- Central config: `src/core/config/server-config.ts`
- Env reference and adapter selection: see `CONFIG.md`
  - Storage: `LAYER4_ADAPTER=sqlite|postgres|triplestore` (default: sqlite)
  - DB path: `ONTOLOGY_DB_PATH` (applies to L3/L4/L5 when set)
  - MCP/HTTP/LSP ports: `HTTP_API_PORT`, `MCP_HTTP_PORT`, `LSP_SERVER_PORT`

## HTTP API (Selected Endpoints)

- Generic tools (MCP parity): `POST /api/v1/tools/call`
  - Body: `{ "name": "<tool>", "arguments": { ... } }`
- OpenAPI spec: `GET /openapi.json`
  - Example:
    ```bash
    curl -sS http://localhost:${HTTP_API_PORT:-7000}/openapi.json | jq .info
    ```
- AST Query: `POST /api/v1/ast-query`
- Graph Expand: `POST /api/v1/graph-expand`
- Snapshots: `GET /api/v1/snapshots`, `GET /api/v1/snapshots/{id}/diff`, `POST /api/v1/snapshots/clean`
- Metrics: `GET /metrics?format=json|prometheus`
- Health: `GET /health`

## CLI

- Explore: `ontology-lsp explore <symbol> [-f file] [--json]`
- Definitions: `ontology-lsp find <symbol> [-f file] [--json]`
- References: `ontology-lsp references <symbol> [-f file] [--json]`
- Planner: `ontology-lsp symbol-map <symbol> [-f file] [--json]`
- Plan rename: `ontology-lsp plan-rename <old> <new> [-f file] [--json]`
- Workflows:
  - Generic: `ontology-lsp workflow <name> --args '<json>' [--json]`
  - Rename safely: `ontology-lsp rename-safely <old> <new> [-f file] [--no-checks] [--cmd <...>] [-t sec] [--json]`
  - Patch + checks (snapshot‑safe): `ontology-lsp patch-checks-in-snapshot [-s snapshot] [-p patch.diff] [--cmd <...>] [-t sec] [--only-touched] [--json]`
  - Pipelines (L5):
    - List: `ontology-lsp pipelines list [--json]`
    - Run: `ontology-lsp pipelines run <id> [--json]`
    - Runs: `ontology-lsp pipelines runs <id> --limit 5 [--json]`

See `CONFIG.md` for env defaults like `FAST_STDIO_CHECKS=touched` and `SNAPSHOT_PARTIAL=1`.

## MCP

- Stdio (preferred for Codex/Claude): `./mcp-wrapper.sh`
- HTTP (Streamable): initialize at `POST /mcp`, use `Mcp-Session-Id` header; SDKs set `Accept: application/json, text/event-stream` automatically.

## Language Tech Stack

- Software Principles: ./software-principles.md
- TypeScript: ./tech-stack-ts.md
- Python: ./tech-stack-py.md
- Go: ./tech-stack-go.md

## Additional Docs

- Workflows & Recipes: ./WORKFLOWS.md
- Implementation Plan: ./IMPLEMENTATION_PLAN_CODE_BRAIN.md
