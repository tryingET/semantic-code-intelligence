---
summary: "Contract and experimental CLI producer for exporting read-only SCI structural evidence."
read_when:
  - "You are producing or consuming structural evidence outside SCI."
  - "You are changing structural evidence receipt schema, validation, or provenance."
type: "design"
---

# Structural evidence export contract (Phases A–B)

Status: Phase A contract plus a bounded experimental Phase B CLI producer.

## Purpose and authority boundary

SCI owns the semantics and content-integrity contract for structural code evidence. The v1 receipt lets a future consumer verify exactly what request was evaluated, against which repository state, by which declared producer/backend, under which limits, and what evidence was observed. SHA-256 detects content mismatch; it does not authenticate producer identity.

The receipt **describes evidence**. It does not rank candidates, select context, allocate a consumer token budget, assemble a packet, or decide what an agent should read. It is not canonical task/evidence authority and does not make a `snapshot://` pointer durable proof.

Canonical artifacts:

- JSON Schema: `schemas/structural-evidence-receipt.v1.schema.json`
- TypeScript contract and cross-field validator: `src/core/workflows/structural-evidence-contract.ts`
- Curated repo-durable sample: `tests/fixtures/structural-evidence-receipt.v1.json`

## Phase boundary

### Phase A (this change)

Phase A defines only:

- a versioned receipt envelope;
- normalized request/question/seeds/operations/limits;
- repository-relative candidate identities;
- opaque snapshot, base, and observed fingerprints plus a stable-across-execution claim;
- SCI producer version/workflow and backend/executable name, version, and outcome;
- explicit result counts, byte accounting, caps, limitations, and completeness;
- canonical SHA-256 request and whole-receipt integrity bindings;
- fail-closed TypeScript validation and focused fixtures/tests.

Phase A does **not** add a workflow, tool registration, adapter, Alpha MVP operation, index, ontology, or generated evidence.

### Phase B (experimental CLI producer)

Phase B adds one deliberately narrow producer for controlled local ablations:

```bash
semantic-code-intelligence experimental structural-evidence-receipt \
  --request-file /path/to/prepared-request.json
```

The command is CLI-only and experimental. It is not registered as an Alpha MCP/HTTP tool and does not widen the supported 20-tool contract. It accepts exactly one `structural_search` operation with one `seed:language` text seed, one `seed:pattern` text seed, and optional repository-relative path seeds.

The producer requires the target repository root to be clean at a full Git commit. Every Git invocation disables replacement objects and optional locks and scrubs ambient repository/index/object routing variables before using the explicit target root. It inventories that unreplaced commit with `git ls-tree` and independently materializes exact `git cat-file` blob bytes into separate temporary query and verification workspaces. It does not use checkout or archive, so replacement refs, `.gitattributes` smudge, `ident`, EOL, and `export-subst` transformations cannot change the fingerprinted or searched bytes. No Git metadata is placed in either capture. Ast-grep sees only the query copy; candidate path components, exact raw source bytes, UTF-8 ranges, snippets, and Unicode-scalar line/column positions are checked against the separate verification copy. Symlink and non-regular evidence paths fail closed. The target is rechecked around status inspection, after cleanup, and immediately before publication.

The producer invokes ast-grep with `--` before every path list and a fixed complete-scan policy that disables hidden, `.ignore`, repository exclude, global ignore, parent ignore, and VCS ignore sources (`--no-ignore hidden|dot|exclude|global|parent|vcs`). This policy is part of the declared `structural-evidence-export-v1` workflow behavior and is receipt-bound through producer provenance; it is not caller-selectable. Requested path bounds still apply.

Cleanup completes before the receipt is returned. Producer-specific POSIX process-group supervision keeps termination timers referenced, sends SIGTERM, escalates to SIGKILL after a grace period, and uses a fixed final confirmation deadline. The experimental producer fails closed on Windows, where this implementation cannot confirm descendant termination. Normal cancellation/timeout publication requires confirmed process-group termination. If confirmation reaches its deadline, the outcome fails closed, no receipt is published, and temporary-root cleanup is still attempted; the producer does not claim that an unconfirmed process is gone. Failures, dirty state, drift, malformed backend output, invalid receipts, abort, and cleanup failure publish no receipt. Temporary roots must be distinct and outside the target. The target worktree is not written, target Git inspection disables optional locks, no SCI index is read or built, and no target `.ontology` path is created.

Receipt publication has one cooperative-signal commit point. A SIGINT/SIGTERM observed before that point aborts collection, waits for backend termination and cleanup, emits no receipt bytes, and exits 130/143. Once the single stdout write is committed, later cooperative signals cannot flip a successful publication to 130/143; the write is allowed to drain under backpressure and success exits 0. A transport failure or non-cooperative hard kill can still truncate bytes, so consumers must require exit 0 plus exactly one valid receipt.

This is an evidence producer, not a repository-wide candidate ranker. Backend encounter order is preserved only as deterministic observation order while receipt count/per-file/byte caps are applied; it carries no relevance semantics. No score, rank, relevance, selection, token budget, or packet policy is emitted. Context-packer owns ranking, selection, token budgets, deduplication across receipts, packet assembly, and ablation metrics. It must not reinterpret SCI completeness, evidence order, or provenance as a ranking score.

The v1 receipt remains unchanged. `requestDigest` already binds the normalized question and operation inputs; producer/backend names and versions are declared and receipt-bound. Those hashes provide integrity, not authentication. A consuming harness must independently pin the launched SCI/backend artifacts, bind the expected normalized request, inventory target `.ontology`/index state before and after execution, retain process and cleanup evidence, and decide durability. Self-asserted authentication, no-index, or cleanup booleans are intentionally not added to the receipt.

## Canonical binding

Canonical JSON follows RFC 8785 JSON Canonicalization Scheme behavior for schema-valid values: valid Unicode scalar-value strings, recursively lexicographic UTF-16 object-key order, preserved array order, ECMAScript JSON string/finite-number serialization, no insignificant whitespace, and UTF-8 encoding. Digests hash those bytes with SHA-256 and use `sha256:<64 lowercase hex>`. Non-finite numbers and non-JSON values are rejected.

- `requestDigest` hashes the normalized `request` object and therefore binds the exact normalized question, ordered seeds, ordered requested operations, and limits.
- Candidate IDs use `candidate:<sha256 digest of identity>`. Match/definition/reference identities bind required ranges; definition/reference identities also bind symbols; graph nodes bind symbols and optional ranges; graph edges bind source and related repository-relative paths/symbols plus edge type.
- `receiptDigest` hashes the complete receipt except `receiptDigest` itself. It binds request, repository posture, producer/backend provenance and outcome, evidence, counts, limitations, and completeness.

Array order is meaningful. Seed IDs, operations, and candidate IDs must be unique. Producers must emit the normalized request, not merely hash a normalized hidden copy.

Evidence kinds are operation-bound: `structural_search`/`ast_query` emit matches, definition/reference operations emit their corresponding identity kinds, and `graph_expand` emits graph nodes or fully identified graph edges.

## Repository and path safety

Path-bearing fields are slash-separated, normalized, repository-relative paths. Absolute paths, drive-qualified paths, `file://` URIs, empty/dot segments, and traversal are rejected. Portable request/outcome/limitation metadata also rejects common machine-local absolute-path forms. Evidence snippets are exact source evidence and may contain path-like source text; consumers must not interpret snippet text as a path. Backend executable provenance records a portable executable name and version, never `command -v` output or a host-specific executable path.

Snapshot identifiers and fingerprints are opaque portable tokens. They intentionally do not prescribe git, overlay, or content-tree implementation. `stableAcrossExecution: true` requires equal base and observed fingerprints. Drifted evidence cannot be marked complete.

## Completeness and limitations

`returnedCount` equals the number of evidence candidates. `totalObservedCount` cannot be lower. `evidenceBytes` equals the UTF-8 snippet byte total. Returned candidates and bytes must remain within the request caps, including the per-file candidate cap; the per-file cap cannot exceed the total candidate cap. `capped` is true exactly when observed candidates exceed returned candidates.

`complete` is a derived field and is true exactly when all of the following hold:

1. the repository remained stable and base/observed fingerprints match;
2. backend outcome is `succeeded`;
3. the receipt is not capped;
4. no limitation has `affectsCompleteness: true`.

Completeness means complete for the bound request and declared operations under this contract. It is not a whole-program semantic accuracy claim.

Backend outcomes are internally consistent: `succeeded` uses exit code `0`, `failed` uses a non-zero exit code, and `timed_out`/`unavailable` use a null exit code.

## Consumer responsibilities

A consumer must:

1. run `validateStructuralEvidenceReceipt` before using any field;
2. reject unknown fields, malformed evidence, digest mismatch, duplicate identities, missing/mismatched provenance, unsafe paths, inconsistent caps/counts, and invalid completeness claims;
3. treat a failed, timed-out, unavailable, drifted, capped, or completeness-limited receipt as partial/failed evidence, never silently as complete;
4. preserve receipt and candidate identities when reporting ablation results;
5. keep ranking, budgeting, selection, and packet assembly outside SCI;
6. avoid resolving repository-relative paths against any root other than the explicitly chosen target repository;
7. apply the durability rules in `docs/project/durable-snapshot-evidence-boundary.md` when citing receipts.

Consumers must not repair or normalize an invalid received receipt in place. A producer must issue a new receipt with recomputed content digests. Digests are not signatures; producer trust must come from the transport/execution boundary or a future separately governed authentication mechanism.

## Rollback

Phase A remains an additive contract. Phase B can be rolled back independently by removing the experimental CLI command registration and signal delegate, `structural-evidence-cli-command.ts`, the exporter plus its raw-Git/process-supervision modules, and focused tests while retaining the v1 schema/validator/fixture. The defensive `--` terminators in the pre-existing shared structural search/rewrite workflows are not producer behavior and should remain as independent path-safety hardening. If the version-aware backend finder becomes unused after removal, it may be restored separately to the prior binary finder. The producer writes only temporary query/verification workspaces and completes or attempts cleanup before any successful publication; it creates no target index, `.ontology`, generated evidence, or source mutation that requires target rollback cleanup.
