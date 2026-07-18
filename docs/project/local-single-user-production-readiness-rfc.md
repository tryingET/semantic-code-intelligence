---
summary: "RFC defining the bounded local single-user production-candidate target for SCI."
read_when:
  - "You are changing SCI packaging, release-readiness claims, or production-candidate validation."
  - "You need to distinguish local trusted use from hosted or multi-tenant deployment."
type: "rfc"
system4d:
  container: "SCI productization after closure of the harnessed-LLM Alpha substrate."
  compass: "Ship one reproducible, dogfooded local runtime artifact without claiming hosted-service readiness."
  engine: "A runtime tarball, isolated installation, CLI and MCP-stdio dogfood, payload manifest, and fail-closed unsupported deployment surfaces."
  fog: "Local trusted production candidacy does not establish network-service authentication, sandboxing, multi-tenancy, or production p95/p99 SLOs."
---

# RFC: Local single-user production candidate

Status: Accepted by explicit operator instruction to proceed with the recommended local single-user target
Date: 2026-07-18
Task: AK `4056`

## Problem

SCI has repeatable Alpha evidence, but its supported workflow still runs primarily from a source checkout. The repository also contains stale Docker and Compose surfaces that diverge from the canonical build and can be mistaken for supported deployment paths.

A production claim without a named user, artifact, trust boundary, and executable acceptance gate would overstate the evidence.

## Decision proposal

Establish a **local single-user production candidate** for a trusted operator and trusted repository. The distributable is a local runtime tarball installed from an explicit file. Its production-candidate interfaces are:

1. `semantic-code-intelligence` / `sci` CLI;
2. `semantic-code-mcp` over stdio.

The artifact must be built from the canonical `build:all` graph, contain only the declared runtime payload, install into an isolated directory, execute bounded discovery through the installed CLI, complete an MCP stdio initialize/list/read sequence, keep protocol stdout clean, and leave workspace source outside the declared `.ontology` runtime-state directory unchanged.

HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, npm publication, and hosted services remain outside this production-candidate claim. They retain their existing Alpha, development, or roadmap status.

## Trust boundary

The candidate assumes:

- one trusted OS user;
- a trusted repository whose configured checks may execute code;
- local filesystem access under that user's permissions;
- explicit review before guarded apply;
- no untrusted network clients or tenant isolation requirement.

`run_checks` is constrained orchestration, not a security sandbox. Network exposure needs a new decision covering authentication, authorization, TLS, rate limiting, command isolation, and tenant/workspace separation.

## Acceptance gates

A candidate is ready only when all are true:

- canonical Alpha validation remains green;
- package entrypoints are unique and present;
- two independently packed archives have identical per-file payload digests;
- the manifest rejects duplicate, source, test, and generated-evidence archive entries;
- isolated installation succeeds from the tarball;
- installed CLI version, bounded `read_file`, and `text_search` calls succeed;
- installed MCP stdio initializes, lists the supported tool surface, reads a bounded file, and emits no non-JSON stdout;
- the complete configured workspace root and source tree outside `.ontology` are inventoried by path, type, mode, content, and symlink target and remain identical;
- runtime-created state is contained under a real, non-symlinked `.ontology` directory and reported separately;
- the production-candidate evidence packet records artifact checksum, payload digest, source commit, cleanliness, calls, limitations, and non-effects;
- stale Docker/Compose production paths fail closed rather than presenting an unverified deployment;
- focused tests, typecheck, lint, docs strict, canonical CI, and independent review pass.

## Evidence semantics

Generated `.test-results/local-production-*` files are D2 local evidence. They become authority-durable only when their command and outcome are attached to AK evidence. The tarball is not published by this wave.

The candidate claim is tied to a commit. A dirty tracked worktree may produce diagnostic evidence, but it cannot set `candidateReady: true`.

## Rollback

Rollback is additive:

1. remove the production artifact/dogfood scripts and package commands;
2. restore Alpha-only product wording;
3. retain the canonical Alpha contract and source-checkout validation;
4. do not reactivate stale Docker or publication surfaces as rollback.

## Rejected alternatives

- **Hosted service first:** rejected because unauthenticated repository access and caller-selected checks require a larger security boundary.
- **Docker first:** rejected because the checked-in image uses a retired build command, divergent output paths, and a false LSP TCP claim.
- **npm publication first:** rejected because distribution and support policy are not yet authorized.
- **More Alpha dogfood only:** rejected because it would not prove an installed artifact.
