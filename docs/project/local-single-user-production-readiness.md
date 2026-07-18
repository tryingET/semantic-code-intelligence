---
summary: "Executable acceptance contract for SCI's local single-user production candidate."
read_when:
  - "You are building or validating the local SCI runtime artifact."
  - "You need to interpret local production-candidate dogfood evidence."
type: "contract"
---

# Local single-user production-candidate contract

Authority: [ADR-0004](../adr/0004-local-single-user-production-candidate.md)  
Implementation task: AK `4056`

## Supported candidate

| Dimension | Supported boundary |
|---|---|
| User | One trusted local operator |
| Workspace | One trusted local repository at a time |
| Artifact | Versioned runtime `.tgz` built from the canonical build graph |
| Interfaces | Installed CLI and MCP stdio |
| Mutation | Preview first; guarded apply remains explicit |
| Evidence | Local JSON packet, promoted through AK when used for task closeout |

HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, hosted operation, public package publication, untrusted code, and multiple tenants are not part of this candidate.

## Build

```bash
bun run production:artifact
```

This command:

1. runs the canonical public runtime build/check;
2. creates two archives from the same built state;
3. rejects duplicate or forbidden archive members;
4. compares sorted per-file SHA-256 payload manifests;
5. retains one tarball and writes an artifact manifest under `.test-results/local-production-artifact/`.

A matching payload digest proves repeatable archive contents for the current source, Bun version, and environment. It does not prove hermetic future dependency resolution.

## Dogfood

```bash
bun run production:dogfood
```

Dogfood installs the tarball into a fresh isolated directory and executes only installed bins. It verifies:

- CLI version;
- bounded file read and text search against an isolated target;
- MCP stdio initialization, tool discovery, and bounded file read;
- JSON-RPC stdout cleanliness;
- complete configured workspace-source inventory unchanged outside declared `.ontology` runtime state;
- runtime-created files contained under a real, non-symlinked `.ontology` directory and reported separately;
- archive checksum and payload repeatability;
- tracked-clean source posture for `candidateReady`.

The retained evidence path is:

```text
.test-results/local-production-candidate.json
```

## Full local candidate gate

```bash
bun run production:candidate:check
bun run alpha:mvp:check
just ci
```

The candidate is accepted only when the evidence packet reports both:

```json
{
  "ok": true,
  "candidateReady": true
}
```

`ok` means the packaged-runtime behavior passed. `candidateReady` additionally requires a tracked-clean source commit.

## Installation model

This wave does not publish the artifact. An operator may install an explicitly reviewed local tarball with Bun from a trusted path. The dogfood installation is ephemeral and removed after validation; the tarball and JSON evidence remain under ignored `.test-results/` paths.

## Operational limits

- `run_checks` executes constrained commands from a trusted repository; it is not a sandbox.
- Snapshot artifacts are locally retained under the existing Alpha policy and are not a durable session database.
- Evidence JSON is local until recorded through AK.
- Performance evidence remains coarse Alpha latency evidence, not p95/p99 production SLO proof.
- Network services remain Alpha-only and should stay loopback-bound.

## Promotion beyond this boundary

A separate decision is required for any of:

- public package or container release;
- HTTP/MCP HTTP production support;
- non-loopback binding;
- hosted or multi-tenant deployment;
- untrusted repository execution;
- durable service/session/evidence storage;
- availability or p95/p99 SLO commitments.
