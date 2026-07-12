---
summary: "Phase A contract for exporting read-only SCI structural evidence to future consumers."
read_when:
  - "You are producing or consuming structural evidence outside SCI."
  - "You are changing structural evidence receipt schema, validation, or provenance."
type: "design"
---

# Structural evidence export contract (Phase A)

Status: contract-first Phase A; no runtime exporter is authorized by this document.

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

### Phase B (future, separately authorized)

A future Phase B may implement an SCI exporter only after current structural operations can establish a snapshot-consistent base and observed fingerprint. That work must separately decide runtime exposure, capture lifecycle, and performance. It must not weaken the Phase A receipt to conceal drift.

A future context-packer ablation may consume valid receipts. Context-packer owns ranking, selection, token budgets, deduplication across receipts, packet assembly, and ablation metrics. It must not reinterpret SCI completeness or provenance as a ranking score.

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

This phase is additive and has no runtime exposure. Rollback is one commit reverting the five contract/schema/test/fixture/doc files. No index, `.ontology`, parent checkout, or generated evidence cleanup is required.
