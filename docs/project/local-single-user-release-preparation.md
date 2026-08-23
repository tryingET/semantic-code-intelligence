---
summary: "Preparation contract for a uniquely identified SCI 2.1.0-rc.1 local single-user candidate without granting distribution authority."
read_when:
  - "You are preparing, validating, landing, or reviewing the next SCI local runtime candidate."
  - "You need to distinguish release preparation from tag, upload, publication, or deployment authority."
  - "You are interpreting the SCI 2.1.0-rc.1 version, artifact set, support boundary, or release task stack."
type: "contract"
system4d:
  container: "Release preparation for the ADR-0004 trusted-local CLI and MCP-stdio runtime artifact."
  compass: "Give one reviewed candidate immutable identity and lifecycle evidence without converting preparation into distribution authority."
  engine: "Bounded docs and hardening slices -> tracked-clean exact-SHA gates -> separately authorized remote CI -> fresh distribution decision."
  fog: "A version, checksum, green gate, pushed commit, or Git tag does not by itself authorize distribution or broaden product support."
---

# SCI 2.1.0-rc.1 local release-candidate preparation

Status: proposed while AK task `4893` is active; effective only when that task reaches `done` with its required evidence

Runtime authority: AK task `4893`

Productization authority: [ADR-0004](../adr/0004-local-single-user-production-candidate.md)

Executable runtime contract: [local-single-user-production-readiness.md](local-single-user-production-readiness.md)

## Purpose

Prepare one uniquely identified Semantic Code Intelligence runtime candidate for the already accepted ADR-0004 boundary:

- one trusted local operator;
- one trusted repository at a time;
- a versioned local `.tgz` artifact;
- installed CLI and MCP stdio behavior;
- preview-first mutation posture;
- no public or network-production claim.

This contract sequences preparation and proof. It does **not** authorize a Git tag, push, package publication, GitHub release, release-asset upload, container, deployment, or transfer to a recipient. After task `4899` receives explicit external-effect confirmation, the existing validation workflow may upload only the sanitized, explicitly allowlisted CI evidence named by task `4897`; that validation evidence is not the candidate tarball, manifest, checksum bundle, or a distribution channel.

## Why the candidate identity changes

The repository currently has no Git tags and no GitHub releases. `package.json` identifies the runtime as `2.0.0`, while materially different local artifacts have been built from later commits. There is therefore no authoritative released `2.0.0` baseline and no lawful changelog range that can be inferred from a tag.

The next prepared artifact uses:

```text
2.1.0-rc.1
```

This is a unique candidate identity, not a claim that `2.0.0` was publicly released. The minor prerelease boundary is appropriate because the candidate includes additive composite workflows and a materially revised progressive `explore_symbol_impact` result contract. During tasks `4894`–`4897`, the identity is reserved while tracked bytes may still change. Task `4898` is the immutability point: once its final AK evidence binds `2.1.0-rc.1` to one commit and archive checksum, that version must never identify different bytes, whether or not distribution later occurs.

## Audience, owner surfaces, and channel

| Concern | Owner / boundary |
|---|---|
| Runtime source, package contract, artifact builder, and candidate evidence | Semantic Code Intelligence repository |
| Candidate acceptance and exact task/evidence state | Agent Kernel plus accountable operator review |
| Native Pi bridge activation and model/operator rendering | `pi-extensions/packages/pi-semantic-code-intelligence` |
| Target repository mutation and checks | Target repository owner and its exact task authority |
| Prepared artifact channel under this contract | Local ignored `.test-results/` storage only |
| Remote validation evidence | Only sanitized files explicitly allowlisted by task `4897`, and only after task `4899` receives push/external-CI confirmation |
| Distribution channel | None until a fresh accepted decision names one |

The SCI owner may build and inspect local candidate bytes. Confirmed remote CI may retain bounded validation evidence, but no candidate tarball, manifest/checksum bundle, recipient transfer, public registry, GitHub release, package registry, container registry, or deployment target is authorized here.

## Supported candidate

| Dimension | Candidate support |
|---|---|
| User | One trusted local operator |
| Workspace | One trusted local repository at a time |
| Artifact | `semantic-code-intelligence-2.1.0-rc.1.tgz` |
| Runtime bins | `semantic-code-intelligence`, `sci`, `semantic-code-mcp` |
| Production-candidate interfaces | CLI and MCP stdio only |
| Mutation | Preview first; guarded apply remains explicit |
| Runtime state | Local `.ontology` state under the configured trusted workspace |
| Checks | Trusted repository commands; not a hostile-code sandbox |
| Evidence durability | Local packet until exact results are recorded through AK |

HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, npm publication, hosted operation, untrusted repository execution, multiple users, multiple tenants, production p95/p99, availability SLOs, and a durable session/evidence service are explicitly unsupported.

## Candidate contents and notes range

Because no release tag exists, release notes must not describe a conventional `previous-tag..candidate` range. They must say that this is the first uniquely identified local candidate and curate the owner-verified changes since the initial local production-candidate implementation at commit `1aca36c8`.

User-visible candidate highlights:

1. first-class composite workflows for impact, definition confirmation, rename, and preview/check work;
2. compact, standard, and debug progressive disclosure for `explore_symbol_impact`;
3. decision-first unconfirmed packets with exact `locate_confirm_definition` recovery arguments;
4. structural edit-risk evidence with bounded receipts and explicit semantic limitations;
5. stable sanitized `outside_workspace` recovery for definition workflows;
6. truthful MCP application-failure telemetry when transport succeeds but a tool result is `isError:true`;
7. the installed local tarball, CLI, and MCP-stdio candidate gate from ADR-0004.

Compatibility notes must include:

- standard `explore_symbol_impact` details use versioned normalized schema `2`;
- unconfirmed graph evidence distinguishes observed backend claims from normalized usable evidence;
- no-definition remains a non-error empty result;
- outside-workspace definition input remains an error with bounded reason/remediation and no submitted or host path;
- test hermeticity and governance snapshots are internal reliability, not user-facing features;
- structural evidence export and repository closeout receipts remain experimental or source-checkout-only where their package contract says so;
- native Pi use requires a compatible `pi-semantic-code-intelligence` bridge, prepared separately under AK task `4901`.

## Artifact and authenticity commitment

The final local candidate set is:

- `semantic-code-intelligence-2.1.0-rc.1.tgz`;
- `artifact-manifest.json` with source commit and sorted payload entries;
- archive SHA-256;
- repeatable per-file payload digest from two independently packed archives;
- sanitized `local-production-candidate.json` evidence;
- curated release notes and known limitations;
- AK evidence binding the exact commit, commands, review, and artifact digests.

A checksum detects byte drift after the candidate is built. It does not establish producer identity for a recipient. Any later distribution decision must define how the recipient authenticates the producer and obtains the checksum. Green CI, a local path, or an unsigned checksum alone is not an authenticity model for public distribution.

The candidate artifact remains ignored local evidence until task `4903` records a fresh accepted release-channel decision and the accountable operator explicitly authorizes creation of a newly scoped release-execution task for the exact bytes. No release-execution task exists before those gates. Sanitized allowlisted CI validation JSON may be retained remotely after task `4899` confirmation, but it is not candidate distribution. Generated packets do not become canonical release authority by existing locally or as CI artifacts.

## Claim calibration from IW77

AK task `4697` closed the IW77 acquisition window as `acquisition_closed_incomplete_no_go`:

- six eligible episodes;
- zero terminal-valid episodes;
- zero packaged-interface successes admissible under the study contract;
- five owner tasks advanced independently, but those outcomes did not repair the invalid study cohort.

Therefore this candidate may claim executable contract and packaged-behavior proof. It may **not** claim broad first-user adoption, improved call economy across real tasks, general repository effectiveness, or evidence-backed product-market readiness. The incomplete cohort is a measurement limitation, not proof that the five owner tasks failed.

No synthetic or confidence-only adoption task is added to this release stack. A future prospective cohort requires its own authority and validity contract.

## Ordered execution stack

| Order | AK task | Commitment |
|---:|---:|---|
| 1 | `4893` | Bind this preparation, support, identity, and authority contract. |
| 2 | `4894` | Replace stale release guidance and document installed-runtime install, upgrade, rollback, and uninstall. |
| 3 | `4895` | Set `2.1.0-rc.1` and curate changelog/release notes without tagging or publishing. |
| 4 | `4896` | Harden artifact path containment, MCP child shutdown, and failure-evidence redaction. |
| 5 | `4897` | Allowlist CI evidence uploads and align validation documentation. |
| 6 | `4898` | Run tracked-clean exact-SHA local gates and record final artifact evidence. |
| 7 | `4899` | After explicit external-effect confirmation, land the lineage, permit only allowlisted sanitized CI evidence retention, and obtain exact-SHA green remote CI; no tag or release. |
| 8 | `4903` | Obtain and record a fresh distribution decision; close truthfully as rejected/deferred when no channel is accepted. This task performs no release effect. |
| 9 | not pre-created | If and only if task `4903` records an accepted decision and the accountable operator explicitly authorizes it, create a separately scoped task to distribute the exact frozen bytes and record release/post-release receipts. |

Companion task `4901` follows task `4895`. It prepares the private native Pi SCI bridge while preserving unrelated `pi-extensions` worktree changes. The local CLI/MCP-stdio tarball is not blocked by companion publication; any native Pi announcement is blocked until the companion lineage is verified and landed.

Each implementation task owns only its frozen scope. A failure that needs out-of-scope repair creates a new task rather than silently widening the active task. The scopes for post-freeze tasks `4899` and `4903` are exported before task `4898`; they permit only ignored task-specific review scratch, while durable remote-CI and decision receipts remain in AK.

## Local validation gate

Task `4898` must start from a tracked-clean final candidate commit and run:

```bash
./scripts/ci/portable.sh
bun run alpha:mvp:check
just ci
bun run production:candidate:check
git status --porcelain=v2 --untracked-files=all
```

The final evidence must record:

- exact commit and version;
- `ok:true` and `candidateReady:true`;
- archive SHA-256 and repeatable payload digest;
- installed CLI version/read/search results;
- MCP-stdio initialize/list/read results and stdout cleanliness;
- source unchanged and runtime state contained;
- explicit `doesNotProve` claims;
- independent review disposition.

Task `4898` completion freezes the version-to-bytes binding. Any tracked source change before completion invalidates the candidate checksum and requires the gate to run again. Any tracked source change after completion requires a new candidate version; `2.1.0-rc.1` may not be rebound even when it was never distributed.

## Remote CI gate

Current `origin/main` does not contain the complete candidate lineage, and the last observed GitHub workflow failed before executing steps. That zero-step result is infrastructure-indeterminate, not a source-code failure or pass.

Task `4899` must pause immediately before push or external settings mutation. If the operator confirms the bounded push, it may land the reviewed main-first lineage and must obtain a workflow whose `headSha` equals the final candidate commit and whose jobs actually execute:

- portable repository integrity;
- Alpha MVP validation;
- local production-candidate packaged-runtime validation.

Task `4899` may permit the workflow to retain only the sanitized evidence files explicitly allowlisted under task `4897`. It performs no tracked repository mutation. If exact-SHA CI reveals that a tracked workflow or source repair is required, task `4899` stops and routes a new pre-freeze repair and candidate-version stack; it never repairs and rebinds `2.1.0-rc.1` after task `4898`. It may not force-push, tag, create a release, upload candidate/release assets, publish a package/image, deploy, or change account/billing settings.

## Distribution decision and execution gates

Task `4903` obtains and records a fresh decision naming all of:

- accountable release owner;
- exact audience and recipient boundary;
- distribution channel;
- producer-authenticity and checksum-delivery mechanism;
- support and incident expectations;
- upgrade, rollback, withdrawal, and retention policy;
- exact artifact checksum and candidate commit;
- whether any tag or GitHub release is authorized.

Task `4903` is decision-only. A missing, rejected, superseded, or deferred decision is a truthful no-go outcome supported by decision and review evidence; it requires no release receipt, post-release smoke, or release-execution task. If the decision is accepted, the accountable operator must separately authorize creation of a newly scoped release-execution task. That task may execute only the named channel and exact frozen bytes, then record release and post-release receipts.

ADR-0004, task completion, local candidate readiness, a pushed commit, green CI, or a Git tag does not substitute for the task `4903` decision. Task `4903` acceptance does not itself authorize effects or prove that any release effects occurred.

## Rollback and stop conditions

Before distribution, rollback is additive and local:

1. stop at the failing task;
2. retain truthful AK evidence;
3. remove only ignored candidate scratch owned by the task when safe;
4. revert candidate-specific tracked changes through a reviewed additive commit if required;
5. never restore stale Docker/Kubernetes release instructions;
6. after task `4898` freezes the binding, never reuse `2.1.0-rc.1` for different bytes, distributed or not.

Stop and route rather than proceed when:

- scope, commit, version, checksum, or support boundary drifts;
- the worktree is not tracked-clean for final candidate proof;
- output containment or redaction cannot be proven;
- remote CI does not execute the expected jobs;
- push or distribution authorization is absent or ambiguous;
- a distribution decision is missing, rejected, superseded, or names a different channel/artifact;
- companion preparation would touch unrelated dirty `pi-extensions` paths.

## Non-authorizations

This preparation contract does not authorize:

- push before the task `4899` confirmation gate;
- any tag, GitHub release, candidate/release-asset upload, registry upload, package publication, container, or deployment;
- any remote upload before task `4899` confirmation, or any CI upload outside task `4897`'s sanitized exact-file allowlist;
- HTTP, MCP HTTP, or LSP production promotion;
- hosted, network-exposed, untrusted-code, multi-user, or multi-tenant operation;
- a production availability or p95/p99 claim;
- a durable service/session/evidence store;
- Phase 2 UI, IDE, dashboard, interaction, approval, or mutation semantics;
- task, decision, evidence, release, or governance authority inside SCI runtime state.
