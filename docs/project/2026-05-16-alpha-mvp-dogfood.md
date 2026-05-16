---
summary: "Dogfood evidence for the Phase 1 harnessed-LLM Alpha MVP tool surface."
read_when:
  - "You need evidence for the Phase 1 harnessed-LLM MVP contract."
  - "You are changing or validating the Alpha MVP tool surface."
type: "evidence"
---

# Alpha MVP dogfood — harnessed LLM code navigation

## Purpose

Validate that a harnessed-LLM-style workflow can use the Phase 1 HTTP tools surface to navigate this repo without raw shell probing for every step.

This is evidence for `docs/project/alpha-mvp-contract.md` and AK task `3019`.

## Scenario

Question simulated:

> Where is the new `read_file` capability declared and implemented, and can the tool surface retrieve the contract document that describes it?

The workflow used HTTP `/api/v1/tools/call`, which is the deterministic parity surface for MCP tool behavior.

## Command

A temporary Bun script started `HTTPServer` on `127.0.0.1:7031` and called these tools in sequence:

1. `get_snapshot`
2. `read_file`
3. `text_search`
4. `symbol_search`
5. `find_definition`
6. `find_references`
7. `ast_query`
8. `graph_expand`
9. `get_snapshot` for an isolated patch-planning snapshot
10. `propose_patch`
11. `run_checks`

Raw JSON was captured outside the repo at:

```text
/tmp/semantic-dogfood-3019.clean.json
```

## Result summary

| Tool | Status | Success | Elapsed |
|---|---:|---:|---:|
| `get_snapshot` | 200 | true | 135ms |
| `read_file` | 200 | true | 47ms |
| `text_search` | 200 | true | 784ms |
| `symbol_search` | 200 | true | 803ms |
| `find_definition` | 200 | true | 378ms |
| `find_references` | 200 | true | repeatable harness |
| `ast_query` | 200 | true | repeatable harness |
| `graph_expand` | 200 | true | 60ms |
| `get_snapshot` (patch planning) | 200 | true | repeatable harness |
| `propose_patch` | 200 | true | repeatable harness |
| `run_checks` | 200 | true | repeatable harness |

Overall result: **pass**.

## Observations

- `read_file` retrieved `docs/project/alpha-mvp-contract.md` lines 1–30 with path/range metadata.
- `text_search` and `symbol_search` found `handleReadFile` in `src/adapters/mcp-adapter.ts`.
- `find_definition` returned a successful response for `handleReadFile` with the file hint.
- `find_references` returns bounded reference candidates for local impact estimation.
- `ast_query` is included in the repeatable harness to prove structural-query fallback stability even when a parser returns no rich matches.
- `graph_expand` returned a stable fallback shape for `src/adapters/mcp-adapter.ts`; it did not fail when graph expansion was unavailable.
- `propose_patch` stages a reviewable diff in an isolated snapshot, and `run_checks` executes an explicit command against that staged snapshot.
- The patch-planning section verifies the target file is unchanged after the harness, preserving the alpha preview-first mutation posture.

## What this proves

- The Phase 1 tool surface can support a bounded harnessed-LLM navigation loop over this repo.
- The HTTP parity surface is adequate for deterministic dogfood evidence.
- Search, symbol, definition, reference, AST, and graph tools compose into a code-navigation workflow.
- Patch-planning tools can stage and check a diff without mutating the canonical working tree.
- The newly added `read_file` operation closes the biggest gap between the documented Alpha MVP contract and the actual tool registry.

## What this does not prove

- It does not prove production readiness.
- It does not prove full MCP client compatibility in every host.
- It does not prove graph expansion has rich semantic edges for this repo yet.
- It does not promote VS Code, dashboard, CI, Kubernetes, marketplace, analytics, or AI-training surfaces into Phase 1 support.

## Repeatable harness

The ad-hoc workflow has been promoted into a committed harness:

```bash
bun run scripts/dogfood-alpha-mvp.ts --json
```

Use `--pretty` with `--json` for human-readable JSON formatting.

The harness starts the local HTTP server, executes the Phase 1 navigation and preview-first patch-planning loop through `/api/v1/tools/call`, emits machine-readable evidence, and exits non-zero when any required call fails or when the patch-planning target file is mutated.

The broader one-command Phase 1 validation paths are:

```bash
bun run alpha:mvp:check
just alpha-mvp-check
```

See `docs/project/alpha-mvp-validation.md` for the full validation bundle.
