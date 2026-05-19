---
summary: "Alpha graph_expand language-support and fallback characterization."
read_when:
  - "You are changing graph_expand, impactSummary, or graph dogfood evidence."
  - "You need to understand graph limitations by language/source kind."
  - "You are working on AK task 3165."
type: "reference"
---

# Graph language characterization

Date: 2026-05-19
Wave: IW71 — Graph fallback language characterization
Task: AK `3165` — Alpha maintenance: characterize graph limits by language
Status: Alpha characterization; not whole-program graph accuracy

## Purpose

Make `graph_expand` limitations predictable for harnessed LLM coding sessions. The goal is not complete call graph accuracy. The goal is for the operator and LLM to know what graph evidence means by source kind, when it is fallback-shaped, and when to verify with `find_references`, direct file reads, or targeted checks.

## Current support matrix

| Source kind | Extensions | Support posture | Best-supported edges | Known limitations |
|---|---|---|---|---|
| TypeScript | `.ts`, `.tsx` | Tree-sitter best effort | imports, exports, in-file callers, in-file/file-scoped callees | Symbol-only callees are not implemented; caller context is best effort; not whole-program typed graph |
| JavaScript | `.js`, `.jsx` | Tree-sitter best effort | imports, exports, in-file callers, in-file/file-scoped callees | Same as TypeScript, without TypeScript type semantics |
| Python | `.py` | Tree-sitter best effort | imports, callers, callees | Export extraction is not implemented; caller/callee extraction is syntactic and not Python import-resolution aware |
| Symbol-only seed | no file | Grep-seeded best effort | callers | Callees and import/export extraction require file context; results depend on symbol-map/grep seed coverage |
| Unsupported source | `.rs`, `.clj`, `.cljs`, `.cljc`, `.md`, and unknown extensions | Unsupported or unknown-extension fallback | none by file seed | Return structured empty/limited evidence; use text/symbol search and target-specific tools instead |

## Impact summary contract

`impactSummary` now includes `languageSupport` and backend provenance:

```json
{
  "languageSupport": {
    "language": "typescript | javascript | python | symbol_seed | unknown | <extension>",
    "support": "tree_sitter_best_effort | symbol_seed_best_effort | unsupported_extension | unknown_extension | scip_index",
    "supportedEdges": ["imports", "exports", "callers", "callees"]
  },
  "backend": "tree_sitter | scip | fallback",
  "freshness": "current | unknown",
  "discoveryBackend": "rg | null",
  "provenance": {
    "backend": "tree_sitter | scip | fallback",
    "freshness": "current | unknown",
    "discoveryBackend": "rg | null",
    "indexPath": null,
    "generatedAt": null,
    "workspaceRoot": "<cwd>",
    "metadataSource": null
  }
}
```

The provenance shape is forward-compatible with future `live_lsp` backends. Current automatic behavior remains tree-sitter or fallback only, while callers may opt into `backend: "scip"` by passing an explicit existing workspace-contained `scipIndexPath` artifact. Invalid, oversized, malformed, out-of-workspace, symlink-escaping, or post-open containment-failing explicit SCIP artifacts fail closed instead of silently returning fallback evidence. SCI does not generate SCIP indexes from `graph_expand`.

Requested edges that are unsupported for the inferred language appear as `limited` evidence with limitations such as:

```text
exports: python graph extraction is tree_sitter_best_effort; supported edges: imports, callers, callees
```

Unsupported or unknown file extensions must not be hidden behind a green check.

## Operator interpretation

- Non-empty edge counts are useful planning evidence, not proof of complete impact.
- `limited` edge status means the edge was requested but the language/source kind cannot currently produce reliable evidence for it.
- `empty_or_unavailable` means no evidence was observed and no specific limitation was available; do not infer no impact.
- File+symbol caller evidence may include best-effort `caller`/`callerKind`; confirm broad edits with `find_references`.
- For Python, treat imports as useful and exports as unavailable/limited.
- For Rust/Clojure/Markdown/unknown files, use text search, symbol search, AST/structural tools when available, or target-specific checks instead of graph evidence.

## Dogfood coverage

`scripts/dogfood-graph-impact.ts` now covers:

1. TypeScript file impact with imports/callees/planning hints;
2. symbol-seed caller/callee limitations;
3. file+symbol caller context;
4. Python support plus export limitation;
5. unsupported/unknown extension fallback using a markdown seed.

`alpha:evidence:check` requires these graph characterization assertions before alpha evidence passes.

## Non-goals

This characterization does not claim:

- complete whole-program graph accuracy;
- typed call graph behavior;
- rich graph support for Rust/Clojure/Markdown;
- Python import-resolution semantics;
- production readiness.

## Future hardening candidates

Only add these when a real workflow needs them:

- richer Python export/module relationship extraction;
- Rust/Clojure graph support behind explicit language adapters;
- content-addressed graph evidence snapshots;
- SCIP/LSIF-backed definition/reference enrichment;
- language-server-assisted typed graph edges behind feature flags.
