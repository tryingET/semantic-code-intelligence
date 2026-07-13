---
summary: "Accepted consumer handoff contract for bounded, read-only rendering of SCI normalized evidence review v1."
read_when:
  - "You are reviewing the SCI-to-Pi evidence review consumer boundary."
  - "You are validating semantic-code-intelligence.evidence_review.v1 fixtures or schema compatibility."
  - "You need the security, rendering, or cross-owner acceptance conditions for the current consumer."
type: "contract"
---

# Evidence review consumer handoff contract

Date: 2026-07-12

Status: accepted and implemented for the bounded read-only Pi consumer defined by ADR-0003

## Purpose and authority

This document defines the accepted handoff of an already normalized
`semantic-code-intelligence.evidence_review.v1` value from SCI to the bounded read-only Pi
consumer authorized by ADR-0003. It does not authorize a command runner, durable store,
interactive decision surface, broader dashboard, or other integration.

SCI remains the sole producer and normalizer. The consumer may validate and render the
normalized value; it must not reinterpret raw validation plans, alpha packets, command
receipts, or graph output into this schema. Decisions 46 and 47 remain superseded. This
contract does not revive them or advance AK state. ADR-0003 supersedes ADR-0002's temporary
host-handoff deferral while retaining its authority safeguards.

The canonical machine contract is
[`schemas/evidence-review-v1.schema.json`](../../schemas/evidence-review-v1.schema.json).
It accepts only the exact v1 discriminator and rejects unknown fields at every modeled
object boundary.

## Roles and trust boundary

| Role | Owns | Does not own |
|---|---|---|
| SCI producer | Raw evidence interpretation, normalization, claim construction, reference integrity, v1 emission | Host invocation, host rendering, operator decisions, Pi state |
| Transport/invoker | Delivering a bounded sequence of UTF-8 JSON bytes from an explicitly selected source | Normalization, implicit file discovery, command execution, URI fetching |
| Consumer | Pre-parse limits, schema and semantic validation, inert rendering, visible rejection diagnostics | Evidence generation, authority promotion, mutation, hidden recommendations |
| Operator | Any decision made after inspecting displayed evidence and limitations | Automatic acceptance attributed by SCI or the consumer |
| Pi/operator-workbench owner | The accepted bounded consumer implementation and any future host capability decision | SCI governance or producer semantics |

All input is untrusted at the consumer boundary, including values emitted by an SCI
process, committed fixtures, filenames, paths, URIs, commands, markdown, and purported
readiness fields. Schema conformance is necessary but not evidence authenticity or owner
acceptance.

## Accepted value and invocation posture

The consumer accepts exactly one complete normalized JSON object with discriminator
`semantic-code-intelligence.evidence_review.v1`.

An owner may choose one of these bounded delivery modes:

1. **In-memory value** — preferred when SCI and the consumer already share a bounded call.
2. **Standard input** — acceptable only as a single bounded UTF-8 JSON value; stdin is data,
   never a shell program or interactive protocol.
3. **Explicit file** — acceptable only when the operator/invoker names one regular JSON
   file contained by the selected workspace.
4. **Operator-requested bounded picker** — accepted for an empty interactive invocation only
   when traversal, candidates, full validations, and displayed matches are capped; symlinks
   and generated/heavy trees are skipped; every candidate passes the complete v1 reader and
   validator before display; and the selected file is revalidated before rendering.

There is no unbounded search, newest-file auto-selection, clipboard import,
environment-variable expansion, or URI input. Headless invocation must fail before picker
discovery or file access. The consumer must not invoke the SCI producer itself. It must not
treat raw `validationPlan`, alpha evidence packet, target-dogfood packet, markdown, JSONL,
or partial object input as normalizable. Those are producer inputs and must be rejected by
the consumer.

### File containment

Before parsing a file delivery, the invoker/consumer must fail closed unless all checks
succeed:

- the lexical path resolves beneath the explicitly selected workspace root;
- the resolved target is beneath that root and is a regular file, not a directory, device,
  pipe, or socket;
- symlink and hard replacement races do not change the opened identity;
- the opened descriptor remains the checked file through the bounded read;
- file growth cannot bypass the byte cap;
- unreadable, missing, escaped, or indeterminate files produce a generic rejection without
  reflecting hostile content or leaking host paths.

Picker traversal applies the same containment posture to each opened directory and candidate. The accepted Pi implementation additionally bounds traversal to 256 directories, 4,096 entries, 512 JSON candidates, 128 full validations, and 50 displayed matches.

An in-memory or stdin delivery has no authority to name a workspace. Path-like strings in
the payload remain inert display text.

## Resource limits

Limits apply before expensive parsing where possible and again while validating the parsed
value. A stricter host limit is compatible. A larger host limit is not.

| Resource | Maximum | Enforcement |
|---|---:|---|
| UTF-8 encoded input | 1,048,576 bytes | Bounded read with one-byte overflow detection before parse |
| JSON nesting depth | 32 | Reject the entire value |
| Items in one array | 256 | Schema/validator; narrower arrays may cap at 64 or 128 |
| Aggregate object members plus array items | 4,096 | Semantic resource walk |
| One general string | 8,192 Unicode code points | Schema/validator |
| Aggregate strings, including member names | 262,144 Unicode code points | Semantic resource walk |
| Identifier | 128 Unicode code points | Restricted ASCII identifier grammar in schema |
| Command text | 2,048 Unicode code points | Data-only; never executable |
| Path or URI text | 2,048 Unicode code points | Data-only; never dereferenced by default |

The schema's `x-sci-resourceCaps` records these aggregate limits. The extension is
normative for this handoff even though draft-07 does not execute extension keywords.
Rejection is atomic: no partial rendering, truncated acceptance, or fallback to an
unvalidated view.

## Validation and reference integrity

Validation order is:

1. enforce transport byte and file-containment limits;
2. decode strict UTF-8 and parse one complete JSON value;
3. enforce depth, aggregate item, and aggregate string limits;
4. validate against the canonical draft-07 schema;
5. enforce identifier uniqueness and cross-array references;
6. render only if every check succeeds.

The semantic reference pass must require unique IDs within each ID-bearing array and the
following targets:

| Reference | Must resolve to |
|---|---|
| `limitations[].sourceArtifact` | `evidenceArtifacts[].id` |
| `limitations[].affectsClaims[]` | `claims[].id` |
| `limitations[].affectsDecisionPoints[]` | `operatorDecisionPoints[].id` |
| `claims[].supportedBy[]` | `evidenceArtifacts[].id` |
| `claims[].limitedBy[]` | `limitations[].id` |
| `claims[].authorityBoundaries[]` | `authorityBoundaries[].id` |
| `claims[].operatorDecisionPoints[]` | `operatorDecisionPoints[].id` |
| decision-point supporting/limiting claims | `claims[].id` |

Draft-07 cannot express general cross-array joins, aggregate depth, or aggregate string
budgets; they are mandatory companion validation rather than consumer discretion.

## Capability denial

Consuming or rendering a review must perform no effects beyond bounded reads and display.
In particular, the handoff grants no capability to:

- spawn a subprocess or shell;
- execute, recommend, rewrite, copy-as-executed, or approve commands;
- make network, DNS, socket, browser, or remote-resource requests;
- mutate source, snapshots, target repositories, worktrees, or files;
- write durable Pi session, preference, history, cache, approval, task, evidence, AK, or DB
  state;
- install packages or load executable plugins from the payload;
- auto-continue a workflow, apply a patch, update a decision, or report readiness.

Command fields, next actions, options, paths, and links are quoted evidence text. A future
copy control, link activation, command action, persistence feature, or network fetch is a
separate owner-reviewed capability and is outside this contract.

## Rendering contract

A renderer presents normalized producer facts; it does not recompute claims. It must:

- preserve visible distinctions among selected commands, observed receipts, and advisory
  recommendations;
- show outcome, preview/applied posture, production boundary, limitations, claim status,
  authority boundaries, durability, citation requirements, and producer-reported handoff
  readiness without rewriting it;
- show absent/null/unknown/inapplicable states explicitly rather than omit or turn them
  green;
- keep source order where meaningful and use IDs to make references inspectable;
- render all payload strings as text nodes or fully escaped terminal cells;
- present a safe generic rejection screen instead of partially rendering invalid input;
- never infer owner acceptance from `handoffReadiness`, claims, options, or text.

### Hostile terminal and markdown text

The schema rejects C0/C1 controls other than tab, LF, and CR, plus ANSI escape and Unicode
bidi embedding/isolate controls. The renderer must still apply output defenses because
terminal behavior and fonts vary:

- strip or visibly escape ANSI/OSC/CSI sequences and all remaining non-printing controls;
- normalize CR/LF for the selected surface and prevent cursor movement or line overwrite;
- preserve ordinary printable punctuation in a plain-text TUI; if a future surface uses
  Markdown or HTML, escape for that surface and never parse payload markup;
- do not allow headings, code fences, emphasis, tables, images, or status badges to be
  created by payload text;
- expose suspicious or replaced text without echoing it into a terminal control channel;
- preserve logical left-to-right field labels and neutralize bidi spoofing.

Renderer-owned labels and status styling must come from validated enum values, never from
payload prose.

### URI and link policy

URI/path values are inert text by default. Automatic linkification, preview, fetch,
dereference, browser opening, editor opening, filesystem probing, and image loading are
denied. This includes `http:`, `https:`, `file:`, `data:`, `javascript:`, `command:`, editor
schemes, and `snapshot:`.

A `snapshot://` value may be labeled as an ephemeral pointer but is not clickable or
durable proof. A workspace-relative materialized path may be displayed after validation,
but activating it requires a separate explicit operator action and a future owner-approved
containment contract. Unsupported, absolute, or escaped paths remain plain text and must
not be probed.

## Operator decision points

Only decision points actually present in validated
`operatorDecisionPoints[]` may be displayed. The consumer must not synthesize options,
preselect one, rank one as recommended, auto-submit, or translate prose/`nextActions` into
buttons. Supporting and limiting claims and residual uncertainty must appear with the
options.

Displaying a decision point records no decision. Any future input control and decision
recording path requires a separately owned contract defining authority, confirmation,
audit destination, cancellation, and failure behavior. Until then, the surface is
read-only.

## Compatibility and versioning

The discriminator and checked-in schema jointly define v1. Compatibility rules are:

- producers may not add fields to v1 without a schema revision because unknown fields fail
  closed;
- removing a required field, changing nullability, enum values, caps, reference semantics,
  or meaning is breaking;
- a compatible clarification may tighten documentation without changing accepted values;
- adding an optional field still requires coordinated schema and consumer review;
- a breaking shape uses a new discriminator and schema file (for example, `.v2`), not a
  silent `$id` replacement;
- consumers advertise exact supported discriminators and reject unsupported versions;
- dual-version migration must validate and render each version independently; consumers
  must not guess, coerce, downgrade, or normalize versions;
- fixture and current-producer-output conformance tests gate any schema change.

The schema `$id` is an identifier, not a network retrieval instruction. Consumers use the
vendored reviewed schema and must not resolve remote `$ref` or `$id` locations.

## Cross-owner acceptance matrix

“Accepted” below means the named owner has explicitly reviewed its row outside SCI. The
presence of this document or a green SCI test does not satisfy another owner's row.

| Contract area | SCI producer owner | Pi/operator-workbench owner | Operator/security review | Required before host work |
|---|---|---|---|---|
| Normalized fields, enums, nulls, references | Proposes and verifies | Reviews consumability | Reviews spoofing/authority risk | All three accept |
| Byte/depth/item/string limits | Verifies producer fixture fits | Owns equal-or-stricter enforcement | Reviews denial-of-service posture | All three accept |
| File/stdin/in-memory/picker transport | Documents producer output only | Owns invocation, bounded discovery, and containment | Reviews TOCTOU/path/resource boundary | Host and security accept |
| Inert terminal/web rendering | Supplies adversarial fixture | Owns escaping and accessibility | Reviews ANSI/control/bidi/link behavior | Host and security accept |
| Displayed-only decision points | Supplies normalized data | Owns read-only presentation | Operator accepts no hidden/preselected action | Host and operator accept |
| Any interaction, persistence, command, or link activation | No authority granted | Must propose a separate contract | Explicit capability/security review | Not accepted by this contract |
| Governance/AK/production readiness | No change | No change | Existing authority remains controlling | Out of scope |

The bounded implementation cites explicit acceptance and validation evidence through ADR-0003, Pi tasks `3843`, `3853`, and `3855`, and SCI task `3866`. Generated handoff gates remain producer-local facts and do not certify external acceptance. Silence, code availability, schema readiness, peer reports, or superseded decisions 46/47 are not acceptance for any broader capability.

## Golden evidence and review checks

- `tests/fixtures/evidence-review-handoff-valid.json` is a conforming normalized golden.
- `tests/fixtures/evidence-review-handoff-adversarial.json` combines an unknown field,
  dangling reference, hostile terminal/bidi text, and command-shaped content and must be
  rejected atomically.
- `tests/fixtures/evidence-review-claim-model-sample.json` is the current committed SCI
  normalized output fixture and must continue to conform or expose an explicit producer
  mismatch before review proceeds.
- `tests/evidence-review-handoff-contract.test.ts` checks the schema boundary, both goldens,
  the current fixture, hostile text, references, null/unknown fields, and resource limits.

These artifacts continue to gate the accepted bounded consumer and future compatible changes. ADR-0003 records package and runtime-panel authorization for this scope only. They do not authorize publication, broader UI, interaction, persistence, command execution, release, or another governance transition.
