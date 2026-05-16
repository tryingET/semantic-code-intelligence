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

Navigation parity currently means the same bounded tool names are exercised through HTTP tools/call, direct MCPAdapter calls, and MCP HTTP JSON-RPC. It does not mean every parser or graph backend returns rich semantic results in every environment; fallback shapes remain valid alpha evidence when they are structured and non-throwing.

## Maintenance rule

When the Alpha MVP contract changes, update all of these in the same wave:

- `docs/project/alpha-mvp-contract.md`
- package scripts in `package.json`
- `just alpha-mvp-check`
- `scripts/dogfood-alpha-mvp.ts`
- Alpha MVP tests under `tests/alpha-mvp-*.test.ts`
- `.github/workflows/alpha-mvp.yml`
