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
- CLI fallback can execute machine-readable tool calls through `semantic-code-intelligence workflow <tool> --args <json> --json`;
- self-hosted CLI dogfood uses SCI's own CLI workflow surface against this repo for navigation and preview-first patch planning;
- repeatable dogfood evidence can be emitted as machine-readable JSON;
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

## Navigation parity scope

Navigation parity currently means the same bounded tool names are exercised through HTTP tools/call, direct MCPAdapter calls, MCP HTTP JSON-RPC, and an MCP stdio smoke path. It does not mean every parser or graph backend returns rich semantic results in every environment; fallback shapes remain valid alpha evidence when they are structured and non-throwing.

MCP stdio parity currently means the server can initialize, list tools, execute representative bounded navigation and preview-first patch-check calls, and keep stdout free of non-JSON-RPC pollution. Stderr logs are acceptable for diagnostics and are not protocol payloads.

Patch-planning parity currently means `propose_patch` accepts a reviewable diff into an isolated snapshot and `run_checks` executes an explicit command against that snapshot. It deliberately does not apply the staged diff to the canonical working tree; `apply_snapshot` and direct-write workflows remain outside the Alpha MVP default path.

CLI fallback parity currently means local command-line execution can call the same tool registry through the generic `workflow` command with JSON arguments and machine-readable stdout. CLI invocations are process-local, so multi-step snapshot flows that require shared in-memory snapshot state should use composite workflow tools such as `patch_checks_in_snapshot` unless a future durable snapshot/session surface is promoted.

Self-hosted CLI dogfood currently means SCI CLI is used as a practical work loop on the SCI repo itself, not only as a protocol smoke test. See `docs/project/self-hosted-cli-dogfood.md`.

## Maintenance rule

When the Alpha MVP contract changes, update all of these in the same wave:

- `docs/project/alpha-mvp-contract.md`
- package scripts in `package.json`
- `just alpha-mvp-check`
- `scripts/dogfood-alpha-mvp.ts`
- `scripts/dogfood-self-hosted-cli.ts`
- Alpha MVP tests under `tests/alpha-mvp-*.test.ts`, including CLI fallback coverage
- `.github/workflows/alpha-mvp.yml`
