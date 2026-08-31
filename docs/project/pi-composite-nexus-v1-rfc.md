---
summary: "RFC for workspace-bound references and revision-exact snapshot evidence across SCI's private Pi composite profile."
read_when:
  - "You are changing SCI workspace identity, path references, composite recovery, or snapshot/check/apply lineage."
  - "You are changing the private Pi companion contract for SCI composite workflows."
type: "rfc"
system4d:
  container: "The trusted local single-user SCI producer and its private Pi companion."
  compass: "Remove ambient workspace meaning without weakening one-workspace containment."
  engine: "Server-minted workspace identity -> bound paths/state -> revision-exact snapshots -> Pi handshake and proof."
  fog: "A workspace reference is identity and lineage, not authority, authentication, or permission to rebind roots."
---

# RFC: Pi Composite NEXUS v1

Status: Proposed for architecture decision
Date: 2026-08-31
Task: AK `5230`

## Problem

SCI currently gives a relative path meaning through ambient process/session state. A path such as
`runtime/example.ts` does not name a file by itself; it means the pair `(configured workspace,
relative path)`. That pair is not represented in the five producer workflows consumed by the
private Pi companion.

A real first-user episode exposed the consequence:

1. a Pi session was rooted in repository A while the operator task targeted repository B;
2. `explore_symbol_impact` received a B-relative path that was syntactically valid in A;
3. file-scoped subcalls failed and produced no usable evidence;
4. the workflow returned `indeterminate` but still prescribed fileless
   `locate_confirm_definition` in A;
5. the agent supplied an absolute B path to compensate;
6. the Pi companion correctly rejected the cross-workspace path.

The visible rejection was correct containment. The preceding recovery was wrong because workspace
identity had been lost.

A separate source review found a related lineage defect: snapshot UUIDs identify mutable snapshot
heads. Staging can append diffs without the usage lease used by checks and apply. A checked snapshot
can therefore change before apply while retaining the same UUID. A workspace identifier without an
exact snapshot revision would leave that race intact.

## Decision proposal

Adopt **Pi Composite NEXUS v1** for the trusted local single-user producer/companion corridor.

The profile has four invariants:

1. **One immutable workspace binding per producer process and Pi session.**
2. **Every machine-actionable path, recovery edge, state receipt, snapshot, and artifact in the
   profile carries that workspace identity.**
3. **Navigation results describe one verified workspace state; mutation/check/apply results consume
   one exact immutable snapshot revision.**
4. **A reference is identity and lineage, not bearer authorization and never a request to select a
   filesystem root.**

This decision does not authorize automatic workspace discovery, cross-repo absolute paths, dynamic
root rebinding, multi-workspace servers, network trust, or public Pi-companion distribution.

## Truthful completion boundary

The v1 implementation is complete when:

- the five producer workflows behind the private Pi companion are workspace-bound:
  `explore_symbol_impact`, `locate_confirm_definition`, `rename_safely`,
  `patch_checks_in_snapshot`, and `structural_patch_checks`;
- the companion continues to expose four native Pi doors, with its preview door routing to two
  producer workflows;
- navigation results and recovery arguments carry a verified workspace-state receipt;
- snapshot-producing/checking/applying profile results carry an exact revisioned snapshot
  reference;
- checked snapshot material cannot change before an apply that cites the check;
- wrong-root or stale-reference failures are structured, bounded, and path-redacted;
- restart, wrong-root, stale-revision, deterministic interleaving, cross-interface, packaged
  candidate, and live installed-Pi proofs pass.

The claim is **not** that every legacy raw path in SCI has been removed. Legacy primitives, HTTP/LSP
routes outside the profile, compatibility aliases, internal analyzer entrypoints, and broad
read/search migration remain explicit deferred surfaces.

## Reference contracts

### WorkspaceRefV1

```json
{
  "schema": "semantic-code-intelligence.workspace_ref.v1",
  "workspaceId": "wsp_0123456789abcdef0123456789abcdef"
}
```

Rules:

- `workspaceId` matches `^wsp_[0-9a-f]{32}$`;
- the producer mints it for its already configured workspace;
- clients may echo it but cannot register, map, or select roots with it;
- it is model-visible and path-free;
- direct clients discover it from the current-workspace handshake;
- the Pi companion obtains and injects it; the model never selects it.

### WorkspacePathRefV1

```json
{
  "schema": "semantic-code-intelligence.workspace_path_ref.v1",
  "workspaceId": "wsp_0123456789abcdef0123456789abcdef",
  "path": "src/example.ts"
}
```

Rules:

- `path` is normalized, POSIX, repo-relative, and non-empty (`.` only on contracts that explicitly
  allow the root);
- the workspace ID is validated before filesystem access;
- existing lexical, realpath, symlink, opened-file-descriptor, and TOCTOU checks remain mandatory;
- crossing a nested repository boundary requires another workspace binding;
- human-readable relative paths may be rendered, but machine-actionable fields use the bound
  reference.

### WorkspaceStateRefV1

```json
{
  "schema": "semantic-code-intelligence.workspace_state_ref.v1",
  "workspaceId": "wsp_0123456789abcdef0123456789abcdef",
  "digest": "sha256:<64 lowercase hexadecimal characters>"
}
```

Navigation captures the state digest before and after all subcalls. A changed digest returns
`workspace_state_changed` and no actionable definition, impact, or recovery action. Results and
valid recovery arguments carry the verified state reference. This is an observational-state receipt,
not a durable snapshot and not replay authority.

### SnapshotRefV1

```json
{
  "schema": "semantic-code-intelligence.snapshot_ref.v1",
  "workspaceId": "wsp_0123456789abcdef0123456789abcdef",
  "snapshotId": "<existing snapshot UUID>",
  "revision": 1,
  "baseDigest": "sha256:<64 lowercase hexadecimal characters>",
  "overlayDigest": "sha256:<64 lowercase hexadecimal characters>"
}
```

Rules:

- revision is a non-negative safe integer;
- base and overlay digests bind exact reviewed bytes and are not signatures;
- staging requires an exact current ref and creates a new immutable revision under a cross-process
  lease;
- checks persist a receipt bound to workspace ID, snapshot ID, revision, both digests, and selected
  commands;
- apply requires the exact checked ref when check evidence is claimed;
- stale stage/check/apply calls return `stale_snapshot_ref`;
- artifact reads resolve an exact revision rather than a floating snapshot head.

## Workspace binding persistence

Persist one binding under:

```text
<workspace>/.ontology/nexus/workspace-binding.json
```

The internal record contains:

- schema/version and opaque workspace ID;
- canonical real root;
- root device/inode identity where the platform supplies it;
- selected repository boundary identity;
- creation timestamp.

The producer creates or reads it through a non-symlinked, physically contained, restrictive,
atomic-write path. It freezes the binding in memory and verifies root identity before profile
operations. A mismatch fails closed; the producer never silently rebinds.

The internal canonical path is never returned in the public reference. This new local persistence
is narrowly authorized only for identity and lineage metadata. It is not a registry, durable
session database, evidence authority, or cross-repo mapping service.

## Repository boundary

Filesystem containment alone permits a nested repository physically located beneath a parent.
NEXUS repository mode additionally binds the selected repository boundary. Explicit paths and
bounded traversal must reject entry into a different nested `.git` boundary, including worktree
`.git` files and submodule roots. An intentionally selected nested repository receives its own
workspace reference from a target-root process/session.

## Recovery semantics

The profile distinguishes:

- `unconfirmed`: successful bounded lookup with no confirmed definition; a workspace-bound locate
  recovery may be offered;
- `indeterminate`: failed, rejected, unusable, or drifting evidence; no semantic escalation is
  executable until context is repaired;
- `workspace_ref_required` / `workspace_ref_mismatch`: caller omitted or supplied another workspace;
- `workspace_path_unresolved`: a supplied context path does not resolve in the bound workspace;
- `workspace_state_changed`: navigation did not observe one stable state;
- `stale_snapshot_ref`: requested snapshot revision/digest is no longer current;
- `legacy_unbound_snapshot`: historical metadata lacks trustworthy workspace/revision identity.

An all-zero file-context failure must not prescribe fileless locate. Recovery tells the caller to
verify the current session root or use a target-root session. Fixed messages expose no submitted or
host path.

## Snapshot revision and check/apply lineage

A mutable UUID is insufficient evidence. The implementation must:

1. place staging under the same cross-process exclusion membrane as check/apply;
2. publish immutable revision metadata and overlay bytes atomically;
3. make current-head movement compare-and-swap against an expected ref;
4. bind check receipts to exact revision and command digest;
5. reject apply-after-checks when the ref or receipt differs;
6. preserve add/delete/touched-file verification and repeated-apply idempotence;
7. keep prior revisions readable until normal retention safely removes the entire lineage.

Legacy snapshots are marked `legacy_unbound`. They may be inspected under the explicitly selected
current workspace but cannot be staged further, cited as NEXUS check evidence, or applied. Migration
creates a fresh v1 snapshot; it never rewrites legacy metadata in place.

## Interface and compatibility sequence

The change is additive during one compatibility wave:

1. SCI adds discovery plus optional reference inputs and emits bound reference fields alongside
   legacy fields.
2. The Pi companion learns the handshake, validation, persistence, and reference injection.
3. Native Pi calls always use the NEXUS profile and reject missing/mismatched refs.
4. Legacy direct CLI/MCP/HTTP strings remain explicitly non-NEXUS compatibility inputs.
5. A later major contract may remove raw fields after adoption evidence and a new decision.

Schema negotiation must separate model-visible inputs from bridge-injected required fields so the
companion's strict MCP compatibility check remains fail closed without exposing workspace selection
to the model.

Recommended candidate identities are SCI `2.2.0-rc.1` and private companion `0.2.0-rc.1`. Version
changes and distribution remain later execution/release tasks; this RFC does not publish anything.

## Pi companion contract

The companion:

- pins the first canonical `ctx.cwd` for the session;
- obtains the producer-minted workspace ref during connection handshake;
- persists only the bounded opaque ref in a TUI-only custom entry for session restore validation;
- injects workspace/path refs behind existing model-facing repo-relative path fields;
- retains exact snapshot refs and requires explicit revision selection for continuation;
- rejects root drift instead of closing and reconnecting to another workspace;
- never infers a target root from an absolute path or repository marker;
- validates and renders producer references without becoming their semantic owner.

## Security and authority boundary

The accepted threat model remains one trusted local OS user and trusted repositories. The reference
prevents accidental identity confusion and stale lineage; it is not authentication against a hostile
same-UID process or a signature over evidence.

Existing safety remains:

- no apply without the existing explicit guard;
- no cross-workspace path access;
- no network or multi-user support;
- no automatic AK/evidence promotion;
- no target-repository instruction or authority inference from filesystem shape.

HMACs, machine-global registries, hosted authorization, relocation/rebind UX, and multi-workspace
servers require later decisions.

## Validation

Required focused proof:

- binding creation/restart stability, restrictive atomic storage, symlink/tamper/root-identity
  rejection, and redacted mismatch errors;
- wrong-root A/B test with an identically named symbol in A and a B-relative-looking missing path:
  no A definition and no fileless locate recovery;
- pre/post navigation digest drift test;
- nested-repository rejection;
- deterministic two-stage CAS conflict;
- stage-during-check and stage-between-check/apply rejection;
- restart and exact-revision artifact read;
- legacy snapshot inspection-only quarantine;
- MCP, HTTP tools/call, CLI, and private Pi profile parity;
- companion unit/check/dogfood plus package reinstall, fresh Pi process, and real native tool calls;
- canonical SCI Alpha and local-production-candidate gates.

Passing evidence remains local until recorded through AK. Snapshot references remain pointers whose
durability follows the durable snapshot evidence boundary.

## Rollout slices

1. Workspace/reference primitives and discovery.
2. Revision-exact snapshot lineage and deterministic race tests.
3. Five producer workflow bindings and recovery correction.
4. Private Pi companion handshake/injection/validation.
5. Cross-interface, packaged-candidate, and live installed-Pi proof.

Each slice must stay independently reviewable. A failed blocker stops later slices rather than
weakening containment or silently reverting to ambient workspace semantics.

## Rejected alternatives

### Improve prompts and error prose only

Rejected because it leaves path meaning ambient and cannot bind caches, recoveries, snapshots, or
evidence.

### Accept cross-workspace absolute paths

Rejected because it bypasses target-root instructions, state partitioning, and repository authority.

### Derive/rebind the root from each path

Rejected because root selection becomes order-dependent; the current shared bridge connection can
race across roots, and model-provided paths become authority selectors.

### Process-random token

Rejected as the primary reference because fresh CLI processes and persisted snapshot inspection need
restart-stable identity.

### Deterministic hash of the host path

Rejected because it leaks a stable path-derived correlation, treats path reuse as identity, and
cannot distinguish delete/recreate at the same pathname.

### HMAC or global workspace registry now

Rejected because the current local trusted-user threat model does not justify the new secret or
global authority surface.

## Deferred inventory

- raw path replacement across every legacy primitive and internal analyzer entrypoint;
- LSP and broad HTTP route migration;
- broad `read_file`, search, diagnostics, and pipeline migration;
- hosted, network, multi-user, or multi-workspace operation;
- relocation/rebind and copied-workspace UX;
- cross-repo semantic graph composition;
- machine-local tamper-resistant signatures;
- durable evidence/session databases;
- public Pi-companion distribution.

## Decision request

Accept Pi Composite NEXUS v1 as the narrow identity/lineage foundation for the private producer/
companion corridor, authorize its minimal local binding and snapshot-revision persistence, and keep
all deferred surfaces outside the completion claim.
