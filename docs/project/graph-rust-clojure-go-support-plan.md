---
summary: "Investigation plan for adding graph_expand support for Rust, Clojure, and Go."
read_when:
  - "You are considering Rust, Clojure, or Go support for graph_expand."
  - "You are changing graph language characterization after IW71."
  - "You need a bounded implementation sequence for graph language support."
type: "plan"
---

# graph_expand support plan for Rust, Clojure, and Go

Date: 2026-05-19
Task: AK `3224` — investigate graph_expand support plan for Rust/Clojure/Go
Posture: Rust/Go syntactic tree-sitter support implemented; Clojure remains investigation-only; no automatic SCIP generation

## Current limitation summary

`graph_expand` is currently implemented as a best-effort tree-sitter-backed graph helper for TypeScript, JavaScript, Python, Rust, and Go file seeds, plus a grep-seeded symbol fallback. Clojure is still characterized as unsupported-extension fallback in `docs/project/graph-language-characterization.md` and `src/adapters/mcp-adapter.ts`.

That limitation is mostly a current tooling and query-coverage gap, not an inherent language impossibility:

- `package.json` now includes `tree-sitter`, `tree-sitter-typescript`, `tree-sitter-javascript`, `tree-sitter-python`, `tree-sitter-rust`, and `tree-sitter-go`.
- `src/core/code-graph.ts` `loadLanguageForFile()` loads `.ts/.tsx`, `.js/.jsx`, `.py`, `.rs`, and `.go` grammars.
- `src/adapters/mcp-adapter.ts` `inferGraphLanguage()` marks `.rs` and `.go` as `tree_sitter_best_effort`; `.clj/.cljs/.cljc` remains `unsupported_extension`.
- Graph extraction defines Rust and Go import/export/caller/callee queries, while keeping the results syntactic and file-local.
- Existing graph dogfood covers TypeScript, symbol fallback, Python export limitation, Rust syntactic limitations, Go syntactic limitations, and unsupported/unknown extension behavior.

The support target should stay honest: syntactic, file-local, best-effort graph evidence for harnessed LLM coding sessions. It must not claim whole-program graph accuracy.

## Package/runtime findings

Registry metadata is available for all three candidate grammars without adding them to this repo:

| Language | npm package | Observed version | Package/runtime notes |
|---|---|---:|---|
| Rust | `tree-sitter-rust` | `0.24.0` | Official tree-sitter grammar; package includes `bindings/node`, TypeScript types, `node-gyp-build`, and linux/darwin/win32 prebuilds. |
| Clojure | `tree-sitter-clojure` | `0.4.0` | Older community grammar; `main` is `index.js`; package has `binding.gyp`/`src/parser.c` but no prebuilds in the packed artifact; likely needs local native build validation under Bun. |
| Go | `tree-sitter-go` | `0.25.0` | Official tree-sitter grammar; package includes `bindings/node`, TypeScript types, `node-gyp-build`, and linux/darwin/win32 prebuilds. |

No repo install was performed during this investigation. Tarball inspection in `/tmp` confirmed grammar files, node-types for Rust/Go, and upstream tag queries for Rust/Go.

## SCIP and semantic-index findings

Follow-up Codex web research confirmed that Rust and Go should not be treated as tree-sitter-only if SCI wants better-than-syntactic `graph_expand` evidence. Tree-sitter is still a useful file-local fallback, but SCIP is the more appropriate durable interchange path for definitions/references when an index is available.

| Language | Better semantic path | Finding | SCI implication |
|---|---|---|---|
| Go | `scip-go` | Sourcegraph's current precise-code-navigation docs point Go indexing at `scip-go`; `lsif-go` is archived/deprecated in favor of SCIP. | Prefer a generic SCIP reader plus a `scip-go` producer for serious Go graph support. Use tree-sitter Go only for cheap file-local fallback. |
| Rust | `rust-analyzer scip` | `rust-analyzer` has in-tree `lsif` and `scip` CLI subcommands; `scip-rust` appears to be a thin wrapper around rust-analyzer rather than the core semantic engine. | Prefer native `rust-analyzer scip`; treat `scip-rust` as optional packaging convenience. Use tree-sitter Rust for fallback and for cases where no Rust toolchain/index exists. |
| Clojure | no mainstream SCIP/LSIF path found | No practical Sourcegraph-supported Clojure SCIP/LSIF indexer was identified. `clojure-lsp` and `clj-kondo` are the stronger semantic tools; `rewrite-clj` is structural/edit-preserving; `tree-sitter-clojure` is syntax-only. | Do not wait for SCIP. Build a Clojure-specific analysis adapter around `clj-kondo` output, optionally with `clojure-lsp` live boosts and tree-sitter/rewrite-clj structural fallback. |

Grounding sources from the web pass:

- SCIP protocol and TypeScript bindings: <https://github.com/scip-code/scip>
- Sourcegraph precise code navigation and indexer matrix: <https://sourcegraph.com/docs/code-navigation/precise-code-navigation>, <https://sourcegraph.com/docs/code-navigation/writing-an-indexer>
- Go indexing with SCIP: <https://sourcegraph.com/docs/code-navigation/how-to/index-a-go-repository>, <https://github.com/scip-code/scip-go>
- Legacy Go LSIF: <https://github.com/sourcegraph/lsif-go>
- Rust analyzer SCIP/LSIF CLI source: <https://rust-lang.github.io/rust-analyzer/src/rust_analyzer/cli/flags.rs.html>, <https://rust-lang.github.io/rust-analyzer/src/rust_analyzer/cli/scip.rs.html>
- `scip-rust`: <https://github.com/sourcegraph/scip-rust>
- Clojure LSP and feature surface: <https://clojure-lsp.io/>, <https://clojure-lsp.io/features/>
- clj-kondo analysis data: <https://cljdoc.org/d/clj-kondo/clj-kondo/2026.04.15/doc/analysis-data>
- rewrite-clj: <https://cljdoc.org/d/rewrite-clj/rewrite-clj/1.2.54/api/rewrite-clj.zip>

This changes the recommended architecture for Rust/Go from "add tree-sitter grammar and queries only" to a bounded layered backend. For the current Rust/Go plan, ignore Clojure, do not add embeddings, and do not make a file index the first layer.

Recommended Rust/Go backend layers:

0. **Discovery helper — candidate selection, not graph evidence**
   - Use `rg` or `fff` only when `graph_expand` starts from a symbol/no-file seed or needs bounded candidate files.
   - Choose between `rg` and `fff` through a small benchmark/compatibility spike before adopting either as the default discovery helper.
   - Discovery output is only a list of candidate files/locations; graph evidence must still come from tree-sitter, SCIP, or live LSP.
1. **Layer 1 — direct syntax backend, not a file index**
   - Use tree-sitter on the requested file or explicitly bounded candidate files.
   - Use `tags.scm`/language query constants for file-local definitions, imports, exports, and syntactic callees.
   - Do not introduce a persistent file index, fff index, vector index, or broad grep-first graph substrate as the base layer.
2. **Layer 2 — cached SCIP semantic backend**
   - Consume a fresh local `index.scip` when present.
   - Use `scip-go` for Go and native `rust-analyzer scip` for Rust.
   - Prefer SCIP over tree-sitter for cross-file definitions, references, and caller evidence.
3. **Layer 3 — optional live LSP booster**
   - Use `gopls` or `rust-analyzer` only behind explicit feature/budget gates for live semantic questions when SCIP is missing, stale, or insufficient.
   - Do not start LSPs as an implicit side effect of ordinary `graph_expand` unless a later implementation wave explicitly authorizes that behavior.
4. **Metadata sidecar, not a graph layer**
   - Use `cargo metadata` or `go list`/`go/packages` to understand workspace/package boundaries and freshness inputs.
   - Do not treat package metadata alone as call/reference graph evidence.

`graph_expand` should expose backend provenance and freshness before returning richer Rust/Go evidence, for example `backend: "tree_sitter" | "scip" | "live_lsp"`, `freshness: "current" | "stale" | "unknown"`, `metadataSource: "cargo_metadata" | "go_packages" | null`, and when applicable `discoveryBackend: "rg" | "fff" | null`.

### `rg` vs `fff` discovery comparison

`rg` and `fff` are discovery helpers, not semantic graph backends. For the initial Rust/Go backend, choose **`rg` as the default discovery helper** and keep `fff` as an optional experiment.

Local comparison snapshot:

- `rg` is installed in this environment and remains the conservative one-shot CLI discovery default.
- `fff-search` is a Rust crate/SDK; `cargo install fff-search` does not install a binary because the crate has no CLI target.
- The available installable artifact is `fff-mcp`; after explicit operator request, `fff-mcp 0.8.1` was installed locally and `fff-mcp --healthcheck --no-update-check` passed in this repo.
- The Pi-native route is `pi install npm:@ff-labs/pi-fff`; that package is now installed globally and provides `ffgrep`/`fffind` tools plus `/fff-mode`, `/fff-health`, and `/fff-rescan` in new/reloaded Pi sessions.
- `fff-mcp`/`pi-fff` are MCP/Pi extension discovery surfaces, not drop-in `rg` CLI replacements for simple subprocess calls from SCI.

| Candidate | Strength | Risk/unknown | Selection |
|---|---|---|---|
| `rg` | Mature, installed locally, excellent text search, predictable ignore handling, already familiar in SCI workflows. | Process-spawn overhead and repeated searches can still be wasteful for long-running sessions. | **Default one-shot discovery helper now.** |
| `fff-mcp` / `pi-fff` / `fff` | Purpose-built fast/fuzzy file-search surface for editor/AI-agent loops; local `fff-mcp` healthcheck passes and `npm:@ff-labs/pi-fff` is installed. | MCP/Pi-extension lifecycle, mode selection, ignore/path semantics, determinism, and portability still need validation before SCI depends on it. | Optional future experiment for long-running/Pi-mediated discovery only. |

Future `fff` adoption gate:

- choose an integration path: Pi extension tools (`ffgrep`/`fffind`) for harness-mediated discovery, MCP client calls to `fff-mcp`, a stable Bun-callable CLI wrapper, or a native/FFI wrapper;
- run the same query set over Rust/Go fixtures and one larger local repo;
- compare cold and warm latency;
- verify ignore-file/path behavior;
- verify max-result determinism;
- measure spawn vs library integration cost from Bun;
- define failure behavior when the tool is missing.

Until that evidence exists, use `rg` for bounded symbol/no-file candidate discovery inside SCI itself, then parse candidates with tree-sitter or resolve them through SCIP/LSP. In Pi sessions, `pi-fff` can be benchmarked with `ffgrep`/`fffind` as a harness-mediated discovery helper, but do not treat either `rg` or `fff` output as graph evidence.

## Current implementation status

Landed after the initial plan:

- `graph_expand` impact summaries expose backend provenance/freshness fields for current `tree_sitter` and `fallback` behavior.
- Rust and Go file seeds now return syntactic tree-sitter best-effort imports, exports, in-file callers, and file-scoped callees with explicit no-type-resolution limitations.
- Rust and Go fixtures and dogfood assertions cover non-empty edge evidence, exported-symbol filtering, and caller-controlled symbol literal handling.
- `src/core/scip-reader.ts` provides a read-only generic SCIP reader spike that can load an existing `index.scip`, summarize documents/occurrences/languages, and query definitions, references, and file-local occurrences.
- `graph_expand` can optionally consume an explicit workspace-contained `scipIndexPath` and return `backend: "scip"` evidence for file imports/exports and symbol definitions/references.
- Explicit SCIP artifact ingestion now fails closed for invalid, malformed, oversized, out-of-workspace, symlink-escaping, or post-open containment-failing indexes instead of silently falling back.
- Direct HTTP `/api/v1/graph-expand` routes through MCP graph semantics for SCIP/provenance parity.
- `graph_expand` still does not generate SCIP indexes automatically; SCIP remains a consumed artifact.

## Current code surfaces to change later

The Rust/Go syntactic implementation wave touched:

1. `package.json` and lockfile — added Rust/Go grammar dependencies and build externals.
2. `src/core/code-graph.ts` — loads Rust/Go grammars by extension and routes per-language query sets.
3. `src/adapters/mcp-adapter.ts` — updates `inferGraphLanguage()` support matrix after extractor and dogfood assertions exist.
4. `scripts/dogfood-graph-impact.ts` and `scripts/check-alpha-evidence.ts` — add Rust/Go language characterization assertions.
5. `docs/project/graph-language-characterization.md` — updates the support matrix and interpretation text.

Remaining future implementation surfaces for richer semantics are SCIP/LSP producers/consumers, Clojure-specific analysis, and any AST-query-wide language support expansion. `src/layers/tree-sitter.ts` and `src/core/ast-query.ts` are separate AST/search surfaces and were not broadened by this narrow graph slice.

`src/layers/tree-sitter.ts` and `src/core/ast-query.ts` are separate AST/search surfaces. They do not have to change for a narrow `graph_expand` slice unless the implementation deliberately broadens language support for `ast_query`/Layer 2 too.

## Per-language support plan

### Rust

Dependency: `tree-sitter-rust` for file-local fallback; `rust-analyzer scip` for the preferred semantic index tier.

File extensions: `.rs`.

SCIP/backend plan:

- Use a generic SCIP reader in SCI rather than embedding Rust-specific semantic logic into `src/core/code-graph.ts`.
- Produce Rust indexes with native `rust-analyzer scip` where available.
- Treat `scip-rust` as optional wrapper packaging, not the primary semantic authority.
- Use SCIP for definitions/references/cross-file callers when fresh; fall back to tree-sitter for local imports/exports/callees and when no Rust toolchain/index exists.
- Keep limitations visible: Rust SCIP still depends on rust-analyzer, Cargo/workspace configuration, proc-macro/build-script behavior, and index freshness; it is not whole-program runtime call graph proof.

Grammar/node-name findings:

- Tarball includes `src/node-types.json` and `queries/tags.scm`.
- Relevant node names are present: `use_declaration`, `visibility_modifier`, `function_item`, `struct_item`, `enum_item`, `trait_item`, `impl_item`, `mod_item`, `call_expression`, `field_expression`, `scoped_identifier`, `macro_invocation`, `identifier`, `type_identifier`.
- Upstream tags already model definitions and references for functions, methods, ADTs, traits, modules, macros, calls, and impls.

Imports query target:

```scheme
(use_declaration) @import.declaration
```

This should initially capture the whole `use` declaration text rather than attempting module resolution.

Exports query target:

```scheme
(function_item (visibility_modifier)? @export.visibility name: (identifier) @export.func)
(struct_item (visibility_modifier)? @export.visibility name: (type_identifier) @export.struct)
(enum_item (visibility_modifier)? @export.visibility name: (type_identifier) @export.enum)
(trait_item (visibility_modifier)? @export.visibility name: (type_identifier) @export.trait)
(mod_item (visibility_modifier)? @export.visibility name: (identifier) @export.module)
```

Implementation should treat `visibility_modifier` text as evidence. Public/exported semantics remain approximate because Rust visibility includes `pub`, `pub(crate)`, `pub(super)`, module-private defaults, re-exports, and workspace/module boundaries.

Callees query target:

```scheme
(call_expression function: (identifier) @call.func)
(call_expression function: (scoped_identifier name: (identifier) @call.func))
(call_expression function: (field_expression field: (field_identifier) @call.method))
(macro_invocation macro: (identifier) @call.macro)
```

Callers/enclosing context strategy:

- For file+symbol, find syntactic call sites matching identifier, method field, scoped identifier name, or macro name.
- Walk parents to the nearest `function_item`; if inside an `impl_item`, include `impl` context when easily available.
- If no enclosing function exists, return `caller: null` and a limitation rather than inventing context.

Limitations to keep visible:

- No type-aware method resolution.
- No trait dispatch or generic specialization.
- No module/crate/workspace import resolution.
- Macro expansion is not performed; macro invocations are only syntactic call-like evidence.
- `pub` visibility is not equivalent to exported API without module context.

Minimal fixture:

`tests/fixtures/graph/rust/sample.rs` with:

- `use std::collections::HashMap;`
- `pub struct Widget`
- `pub enum Mode`
- `pub trait Renderable`
- `impl Widget { pub fn render(&self) { helper(); self.draw(); } }`
- `fn helper() {}`
- a macro invocation such as `println!(...)`

Dogfood/assertion:

- `graph_expand` on the Rust fixture reports `languageSupport.support === "tree_sitter_best_effort"`.
- Imports count is greater than zero.
- Export evidence includes at least one public function/type candidate.
- Callee evidence includes `helper`, `draw`, and/or a macro invocation depending on final query scope.
- Limitations mention syntactic/no type-aware Rust analysis.

### Go

Dependency: `tree-sitter-go` for file-local fallback; `scip-go` for the preferred semantic index tier.

File extensions: `.go`.

SCIP/backend plan:

- Add a generic SCIP reader first if the goal is precise Go graph expansion rather than only syntax hints.
- Produce Go indexes with `scip-go`; do not invest in new `lsif-go` support because `lsif-go` is archived/deprecated in favor of `scip-go`.
- Use SCIP for definitions/references/cross-file callers when fresh; use tree-sitter Go for local imports/exports/callees and as an offline fallback.
- Treat `gopls` as an optional live booster, not the durable graph substrate. `gopls` can be useful for on-demand semantic queries, but it may depend on module state/toolchain behavior and should remain feature-flagged/budgeted.

Grammar/node-name findings:

- Tarball includes `src/node-types.json` and `queries/tags.scm`.
- Relevant node names are present: `import_declaration`, `import_spec`, `function_declaration`, `method_declaration`, `type_declaration`, `type_spec`, `const_declaration`, `var_declaration`, `call_expression`, `selector_expression`, `identifier`, `field_identifier`, `package_identifier`.
- Upstream tags already model function/method/type definitions, import specs, var/const declarations, and call references.

Imports query target:

```scheme
(import_declaration (import_spec path: (_) @import.path name: (_)? @import.name))
```

The first slice can capture path text and optional alias/dot/blank package name.

Exports query target:

```scheme
(function_declaration name: (identifier) @export.func (#match? @export.func "^[A-Z]"))
(method_declaration name: (field_identifier) @export.method (#match? @export.method "^[A-Z]"))
(type_declaration (type_spec name: (type_identifier) @export.type (#match? @export.type "^[A-Z]")))
(const_declaration (const_spec name: (identifier) @export.const (#match? @export.const "^[A-Z]")))
(var_declaration (var_spec name: (identifier) @export.var (#match? @export.var "^[A-Z]")))
```

Go's exported symbol convention makes this relatively straightforward for syntactic top-level evidence.

Callees query target:

```scheme
(call_expression function: (identifier) @call.func)
(call_expression function: (selector_expression field: (field_identifier) @call.method))
```

Callers/enclosing context strategy:

- Find call sites matching either identifier calls or selector method fields.
- Walk parents to nearest `function_declaration` or `method_declaration`.
- Return method receiver text only if easy to extract; otherwise keep `callerKind: "method_declaration"` as best-effort context.

Limitations to keep visible:

- No type-aware selector resolution (`x.Do()` is only a field name match).
- No interface dispatch, embedding, build tags, generated files, or module/package import graph resolution.
- Export detection is name-based and file-local; it does not prove public API usage.

Minimal fixture:

`tests/fixtures/graph/go/sample.go` with:

- package clause;
- grouped imports with alias and standard package path;
- exported `func BuildWidget()`;
- unexported `func helper()`;
- exported `type Widget struct{}`;
- exported method `func (w Widget) Render() { helper(); fmt.Println(...) }`.

Dogfood/assertion:

- `graph_expand` on the Go fixture reports `tree_sitter_best_effort`.
- Imports count is greater than zero.
- Exports include capitalized top-level candidates and exclude/does not rely on unexported lowercase names.
- Callees include identifier and selector method/function names.
- Caller context exists for a known called symbol.

Go is the best first implementation slice because the official grammar has prebuilds, stable node-types, upstream tags, and simple exported-name conventions.

### Clojure

Dependency: `tree-sitter-clojure` for syntax-only fallback if native loading works; prefer `clj-kondo` output for the first durable Clojure graph adapter.

File extensions: `.clj`, `.cljs`, `.cljc`.

Semantic/backend plan:

- Do not assume a SCIP/LSIF path for Clojure; no practical mainstream Clojure SCIP/LSIF indexer was identified.
- Add a `clj-kondo` analysis adapter before claiming semantic Clojure graph support. Normalize `:namespace-definitions`, `:namespace-usages`, `:var-definitions`, and `:var-usages` into SCI's internal graph shape.
- Use `clojure-lsp` as an optional live booster for definition/reference/rename/call-hierarchy behavior when a workflow needs it.
- Use `tree-sitter-clojure` only for file-local structural hints if the native package builds under Bun.
- Use `rewrite-clj` for structure-preserving Clojure edits later; it is not a graph source by itself.

Grammar/node-name findings:

- Package version inspected: `0.4.0`.
- The grammar has explicit `defn` support with `function_name`, but many other top-level forms are generic `list` plus `symbol` nodes.
- Relevant rules from `grammar.js`: `list`, `symbol`, `qualified_symbol`, `keyword`, `defn`, `function_name`, `function_body`, `params`, reader conditionals, metadata, var quote, deref, tagged literal.
- Unlike Rust/Go packages, the packed Clojure artifact did not include prebuilds or `src/node-types.json`; native build and actual parse output need fixture validation before repo dependency adoption.

Imports/namespaces query target:

```scheme
(list . (symbol) @ns.head (#eq? @ns.head "ns")) @ns.form
```

The first slice should capture the whole `ns` form and optionally extract nested `:require`/`:import` keyword sections by scanning captured text. A tree-sitter-only query can find keyword/symbol children, but preserving enough grouping for aliases and vectors is easier with a small post-processing pass.

Exports query target:

```scheme
(defn (function_name (symbol) @export.defn))
(list . (symbol) @form.head (#match? @form.head "^(def|defmacro|defrecord|deftype|defprotocol)$") . (symbol) @export.name)
```

Because only `defn` is a dedicated grammar rule, non-`defn` forms should be treated as generic list-head matches.

Callees query target:

```scheme
(list . (symbol) @call.head)
(list . (qualified_symbol) @call.qualified)
```

Post-processing must filter out definition heads such as `def`, `defn`, `fn`, `let`, `ns`, `comment`, and special forms when the result is meant as callee evidence.

Callers/enclosing context strategy:

- For a symbol, find list head or symbol occurrences matching the requested name.
- Walk parents to the nearest `defn`; capture its `function_name` when available.
- For generic definitions (`def`, `defmacro`, `defrecord`, etc.), walk to the nearest top-level list and infer the defining symbol from list head + second symbol.

Limitations to keep visible:

- No macro expansion.
- No dynamic var, multimethod, protocol, namespace alias, reader conditional, or runtime dispatch resolution.
- Full graph accuracy is not achievable with simple tree-sitter alone for macro-heavy Clojure; results are syntactic evidence only.
- Native package/build compatibility under Bun is less certain than Rust/Go and must be validated before claiming support.

Minimal fixture:

`tests/fixtures/graph/clojure/sample.clj` with:

- `(ns sample.core (:require [clojure.string :as str]) (:import [java.time Instant]))`
- `(def value 1)`
- `(defn greet [name] (str/upper-case name))`
- `(defmacro with-log [& body] ...)`
- `(defrecord Widget [name])`
- a call to `greet` inside another `defn`.

Dogfood/assertion:

- Only after native grammar load is proven, `graph_expand` on the Clojure fixture reports `tree_sitter_best_effort`.
- Namespace/import evidence captures the `ns` form.
- Export evidence includes `defn` and at least one generic `def*` form.
- Callee evidence includes list-head symbols while filtering obvious defining/special forms.
- Limitations explicitly mention no macro expansion and syntactic-only Clojure analysis.

Clojure should not be the first implementation slice unless a real Clojure workflow is the trigger.

## Implementation sequencing

Recommended bounded sequence depends on the support target.

### Track A — syntactic language characterization

Use this track when the goal is only to stop treating files as unsupported and provide honest file-local hints:

1. **Fixture/query exploration only**
   - Add tiny fixtures or scratch fixtures for one language.
   - Use `tree.rootNode.toString()` and focused `Query` experiments to confirm actual node shapes under Bun.
   - Do not update `inferGraphLanguage()` support until extraction is proven.
2. **Add grammar dependency for one language**
   - Prefer Go first if choosing this track.
   - Update `package.json`, lockfile, and build externals.
   - Confirm `require(findModulePath(...))` works under Bun in this repo.
3. **Add `loadLanguageForFile()` branch**
   - Return `{ id: "go" | "rust" | "clojure", lang }`.
   - Keep unsupported fallback for languages not implemented in that slice.
4. **Add per-language query constants and routing**
   - Do not reuse TypeScript call queries for new languages.
   - Keep query compile failures visible as limitations rather than green success.
5. **Add graph dogfood cases**
   - Add one language-specific call in `scripts/dogfood-graph-impact.ts`.
   - Add assertions in `scripts/check-alpha-evidence.ts` only for implemented behavior.
6. **Update characterization docs**
   - Update `docs/project/graph-language-characterization.md` to move the implemented extension from unsupported fallback to tree-sitter best-effort.
   - Include visible limitations per language.

### Track B — semantic Rust/Go graph support

Use this track when the goal is better cross-file definition/reference/caller evidence for Rust or Go. Clojure and embeddings are intentionally out of scope for this track, and the first layer is not a file index.

1. **Define backend provenance and freshness fields**
   - Add fields such as `backend`, `freshness`, `indexPath`, `generatedAt`, `workspaceRoot`, `metadataSource`, and `limitations` to graph evidence or impact summaries.
   - Accepted Rust/Go backend values for this track: `tree_sitter`, `scip`, `live_lsp`.
2. **Keep Layer 1 direct and structural**
   - Parse only the requested file or bounded candidate files with tree-sitter.
   - Use language-specific queries for local imports/exports/callees/caller context.
   - Do not create a persistent file index or fff/rg-backed graph index as the base graph layer.
3. **Compare `rg` and `fff` as discovery helpers, not graph layers**
   - Use this only for symbol/no-file seeds or bounded candidate selection.
   - Keep `rg` as the conservative default until `fff` wins a small benchmark on latency, ignore semantics, determinism, and Bun integration cost.
   - Record `discoveryBackend` separately from graph `backend`.
4. **Implement a generic SCIP reader as Layer 2**
   - Normalize SCIP occurrences, symbols, definitions, references, documents, and packages into SCI graph edges.
   - Use SCIP protocol TypeScript bindings if they fit Bun runtime needs.
   - Keep it read-only and local-first: consume an existing `index.scip`; do not auto-run toolchains on arbitrary repos by default.
5. **Add Go SCIP producer guidance first**
   - Document/optionally wrap `scip-go` index generation.
   - Map SCIP definitions/references to `graph_expand` definitions, references, callers, and import-ish/package neighbors before adding live `gopls` boosts.
6. **Add Rust SCIP producer guidance second**
   - Document/optionally wrap `rust-analyzer scip`.
   - Keep `scip-rust` as optional wrapper compatibility only.
7. **Add metadata sidecars for boundaries/freshness**
   - Use `go list`/`go/packages` for Go package/module boundaries.
   - Use `cargo metadata` for Rust workspace/crate/feature boundaries.
   - Treat metadata as routing/freshness context, not as graph evidence by itself.
8. **Add optional Layer 3 live LSP only after SCIP is useful**
   - Use `gopls` or `rust-analyzer` behind feature flags and strict budgets.
   - Return `backend: "live_lsp"` and visible limitations when used.
9. **Fallback routing**
   - If fresh SCIP exists, prefer it for definitions/references/callers.
   - If no fresh SCIP exists, use tree-sitter best-effort for file-local evidence and mark unsupported cross-file edges as limited.
   - If live LSP is enabled and within budget, use it only for explicitly requested semantic boosts.
10. **Dogfood and characterization**
   - Add fixture/index samples small enough to commit or generation commands reproducible enough to validate.
   - Update `impactSummary.languageSupport` or a new backend field to distinguish `scip` from `tree_sitter_best_effort`.

### Track C — Clojure semantic graph support

Out of scope for the current refined Rust/Go backend. Keep Clojure as unsupported or separately planned until a concrete Clojure workflow asks for it.

### Common validation

- `bun run graph:dogfood`
- `bun run alpha:evidence:check`
- `bun run typecheck`
- `node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs --docs . --strict`
- `git diff --check`
- `ak direction check --repo . --machine`

## Recommended first implementation slice, if requested later

If the operator wants a **quick syntactic slice**, prefer Go tree-sitter first:

- Official grammar with prebuilds.
- Upstream tags query already covers calls and definitions.
- Export semantics are simple enough for syntactic best-effort (`^[A-Z]`).
- Fixture and dogfood assertions can stay narrow and meaningful.

If the operator wants **serious Rust/Go graph support**, prefer:

1. direct tree-sitter fallback fields/provenance for requested files;
2. an `rg` vs `fff` discovery-helper benchmark for symbol/no-file candidate selection;
3. a generic SCIP-reader spike;
4. Go via `scip-go`;
5. Rust via `rust-analyzer scip`;
6. metadata sidecars for `go list`/`go/packages` and `cargo metadata` freshness/boundary context;
7. optional live `gopls`/`rust-analyzer` boosters only after the cached SCIP path is useful.

Do not add embeddings, a persistent file index, or fff/rg-backed graph indexing as part of this Rust/Go support slice. `rg`/`fff` may be compared and used only as bounded discovery helpers. Clojure remains out of scope for this refined backend.

## Non-goals

- No whole-program graph accuracy claim.
- No type-aware Rust or Go analysis.
- No Rust trait dispatch/generic specialization/module resolution.
- No Go interface dispatch/build-tag/package graph resolution.
- No claim that SCIP indexes are always fresh, complete, or dependency-complete.
- No automatic external toolchain execution or network/module fetches from `graph_expand` by default.
- No embeddings/vector index for this Rust/Go graph support slice.
- No persistent file index, fff index, or rg-backed graph index as Layer 1.
- No Clojure work in this refined Rust/Go backend slice.
- No broad durable state layer or graph database.
- No external repo mutation.
- No Pi/operator-workbench handoff or UI work.
- No AK decision lifecycle advancement.

## Validation performed for this doc-only investigation

- Read current graph, adapter, dogfood, alpha evidence, product-posture, durable evidence, and ADR-0002 surfaces.
- Confirmed current repo dependencies lack Rust/Clojure/Go grammars.
- Checked npm metadata for candidate grammar packages.
- Inspected packed grammar artifacts in `/tmp` without adding dependencies to this repo.
- Asked `codex exec` with live web search for Rust/Go SCIP and Clojure semantic-index options; integrated the findings as architecture guidance, not implementation proof.
- Confirmed current AK direction check and workspace DB preflight passed before repo docs mutation.
