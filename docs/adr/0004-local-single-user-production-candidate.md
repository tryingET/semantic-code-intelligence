---
summary: "ADR-0004: Adopt a tarball-based local single-user SCI production candidate."
read_when:
  - "You need the accepted SCI local production-candidate boundary."
  - "You are changing packaged-runtime validation or deployment claims."
type: "adr"
system4d:
  container: "Productization of the closed SCI Alpha substrate for a trusted local operator."
  compass: "Prefer one verified local artifact over premature hosted or container deployment claims."
  engine: "Canonical runtime tarball plus isolated CLI/MCP-stdio dogfood and authority-durable closeout evidence."
  fog: "Production candidate is narrower than production service: network, multi-tenant, durable-service, and public-release claims remain unsupported."
---

# ADR-0004: Adopt a local single-user production candidate

Status: Accepted
Date: 2026-07-18
Accepted: explicit operator instruction to proceed with the recommended local single-user production-readiness target
Task: AK `4056`
RFC: [`local-single-user-production-readiness-rfc.md`](../project/local-single-user-production-readiness-rfc.md)

## Context

Phase 1 is closed as an Alpha MVP substrate, not as a production deployment product. Existing evidence proves source-checkout and globally provisioned target-cwd workflows, while the root Docker and Compose surfaces diverge from the canonical build and are not validated.

The operator explicitly selected the recommended next direction: make the smallest truthful local single-user target complete and verify it through dogfooding.

## Decision

Adopt a **local single-user production candidate** with these boundaries:

- trusted operator, trusted repository, and local OS-account isolation;
- a versioned runtime tarball as the candidate artifact;
- CLI and MCP stdio as production-candidate interfaces;
- isolated artifact installation and executable dogfood as the acceptance proof;
- payload manifest and per-file repeatability digest rather than a claim of hermetic dependency resolution;
- no publication, deployment, hosted service, or multi-tenant claim;
- Docker and Compose remain unsupported until a separate container decision and executable gate exist.

The accepted implementation and evidence contract is maintained in [`local-single-user-production-readiness.md`](../project/local-single-user-production-readiness.md).

## Consequences

Positive:

- operators can install and exercise the exact built artifact without relying on repository source paths;
- package omissions, duplicate entries, stale bins, and protocol pollution fail closed;
- product claims identify a concrete trust boundary and evidence level;
- stale container surfaces cannot masquerade as supported production deployment.

Trade-offs:

- dependency installation is reproducible only against the declared package metadata and current resolver inputs; it is not a hermetic vendored closure;
- HTTP and MCP HTTP remain Alpha interfaces even though loopback defaults and ingress protections exist;
- no durable service/session/evidence database is introduced;
- no public release channel is activated.

## Security boundary

Repository checks may execute trusted project code. SCI is not a hostile-code sandbox. Any network or multi-user use requires a fresh threat model and controls for authentication, authorization, encryption, rate limiting, command isolation, storage isolation, and incident response.

## Validation

The acceptance command is:

```bash
bun run production:candidate:check
```

It must produce `.test-results/local-production-candidate.json` with `ok: true` and `candidateReady: true` from a tracked-clean commit. Canonical Alpha validation and repository CI remain separate required gates.

## Rollback

Revert the artifact, dogfood, contract, and command-surface additions. Preserve the existing Alpha contract and do not restore unverified deployment claims.

## Not authorized

- npm, registry, container, or marketplace publication;
- Docker, Compose, Kubernetes, or hosted deployment support;
- non-loopback service exposure;
- untrusted repositories or callers;
- multi-user or multi-tenant operation;
- production p95/p99 or availability SLO claims;
- new persistence, approval, governance, or mutation authority.
