# `explore_symbol_impact` compact-output evidence campaign

## Claim boundary

This is a frozen, bounded deterministic **producer-disclosure** probe corpus. Its reductions and retention results are representative evidence only. They are not a universal byte-reduction, language-coverage, backend-accuracy, semantic-precision, native-consumer, or production guarantee.

The corpus exercises the real `SymbolWorkflowService` progressive-disclosure and structural-parser paths with exact source locations plus frozen dependency evidence. It deliberately does not characterize live index freshness, real definition/reference recall, or graph accuracy; those require separate live-backend evidence. Language labels therefore identify parser/source strata, not end-to-end backend support claims.

The source strata follow the current graph characterization: TypeScript/TSX, JavaScript/JSX, Python, Rust, and Go; one symbol-only request is included. Clojure, Markdown, and an unknown extension are unsupported-confidence controls. The corpus covers confirmed, unconfirmed, and indeterminate resolution; exported and internal definitions; class, function, method, variable, and type declarations; low/high fanout with real source occurrences; multiple definitions; graph/backend degradation; an unusual Unicode/space path; a conventional-name negative control; and public API, state, registry, and test risks.

## Frozen procedure

1. Verify `freeze.json` against one-byte-read SHA-256 receipts for this procedure, `manifest.json`, the campaign test implementation, and every corpus file. Verify the same receipt after execution.
2. Load the manifest only after the freeze preflight. Resolve every injected location from an actual symbol occurrence in its frozen source; high-fanout files contain real source occurrences.
3. Run every case twice in the fixed order `compact`, `standard`, `debug` through `SymbolWorkflowService.exploreSymbol` with deterministic frozen dependency evidence and a deterministic monotonic clock. Require byte-identical run identities. This isolates progressive-disclosure behavior from index freshness and wall-clock noise while exercising the real structural parsers.
4. Define the model-visible **producer** JSON as UTF-8 bytes of `JSON.stringify(payload)`, excluding CLI/MCP/HTTP/native-consumer envelopes and trailing newlines. Record exact bytes and SHA-256 for every payload.
5. Count items as the total number of array elements recursively present in that model-visible payload. Count truncation markers as recursively observed `truncated: true` or `byteTruncated: true` fields; also record disclosure omissions when present.
6. For each comparison mode, calculate `100 * (comparisonBytes - compactBytes) / comparisonBytes`. Calculate p50/p90/p95 by nearest rank over ascending reductions: rank `ceil(p * N)`, one-indexed. The worst case is the minimum reduction. No per-case or out-of-corpus reduction is claimed.
7. Check the compact result against independent manifest/source oracles: exact resolution/`ok`/degraded posture, definition count/path/line, next-read existence and impact membership, fanout truncation, multiple-definition inclusion, naming-fallback control, and complete expected signal state.
8. Write bounded raw payloads to `.test-results/symbol-impact-compact-campaign/outputs.jsonl` and measurements plus an explicit accepted/rejected verdict to `.test-results/symbol-impact-compact-campaign/measurements.json`. Fail if raw payload JSONL exceeds 3 MiB or any producer packet exceeds 48 KiB.

## Pre-run fact-retention rubric

### Confirmed facts

For each standard/debug comparison, compact must exactly retain every applicable decision fact: schema/workflow, `ok`, `status`, `degraded`, symbol, message/evidence for unresolved cases, confirmed definition, definition count, impact summary/files/truncation, edit-risk level/reasons, limitations, and the structural-analysis receipt. Retention is equal facts divided by applicable comparison facts.

### Risk signals

Compact must exactly retain all four signal objects (`publicApi`, `state`, `registry`, `tests`), including status, detected flag, confidence, reasons, files/hidden files, provenance, and naming fallback. The manifest supplies the expected status for each confirmed case.

### Actionable next reads

Compact must exactly retain the complete ordered `nextReads` array from standard/debug. Path, line, action, and reason are all material.

### Safety failures

- **False confirmation:** compact reports `ok: true` or `status: confirmed` when the manifest expects `unconfirmed` or `indeterminate`.
- **Unsupported confidence:** a manifest-expected `unknown` risk signal is emitted as detected, or with confidence other than `unknown`; this includes the unsupported-language control. A manifest-expected detection that is absent is also a corpus correctness failure, but is reported separately as an expected-signal mismatch.

## Acceptance thresholds fixed before execution

- p50 reduction: at least 50% versus standard and 60% versus debug;
- confirmed-fact retention: 100% for both comparisons;
- risk-signal retention: 100% for both comparisons;
- actionable-next-read retention: 100% for both comparisons;
- false confirmations: zero;
- unsupported-confidence failures: zero;
- expected-signal, resolution, and source-oracle mismatches: zero;
- two independent in-process runs: byte-identical;
- frozen inputs: unchanged before/after execution;
- complete producer packet: at most 48 KiB;
- raw payload artifact: at most 3 MiB.

p90, p95, and worst-case reductions are measured and reported, not promoted into universal acceptance claims. A failed acceptance criterion may justify investigation; product mutation is not authorized by this campaign. A reproducible correctness defect requires a separate scoped AK task and exact authority before behavior changes.

## Execution transparency

Two setup defects were corrected without changing thresholds or product behavior:

1. The first execution aborted before measurements because the multiple-definition case chose a fanout file without that symbol. Reference selection was corrected to use all definition files before shared fanout files.
2. The next complete execution reported Python's module assignment `PUBLIC_PY_VARIABLE = 1` as a state write. Source inspection showed this is supported structural write evidence, so the mistaken corpus oracle was changed from `unknown` to `detected`.

The predeclared 50%/60% p50 thresholds were not changed. Earlier rejected artifacts were overwritten only after recording these corrections here; the final raw artifact and freeze identify the corrected corpus.
