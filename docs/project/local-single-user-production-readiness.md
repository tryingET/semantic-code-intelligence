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
5. rejects output roots outside the physical repository-owned `.test-results/` tree, including symlinked ancestors, before recursive deletion or write;
6. retains one tarball and writes an artifact manifest under `.test-results/local-production-artifact/`.

A matching payload digest proves repeatable archive contents for the current source, Bun version, and environment. It does not prove hermetic future dependency resolution.

The builder revalidates real directories and regular files immediately before and after recursive cleanup, child pack/extract activity, archive rename, and manifest write. This is a trusted-local race boundary, not a hostile concurrent-filesystem sandbox: the operator and child processes must not replace validated path components during the gap between a check and its following filesystem operation. Direct builder failures use the same fixed typed default stderr posture as dogfood; raw producer diagnostics require explicit local opt-in.

## Dogfood

```bash
bun run production:dogfood
```

Dogfood installs the tarball into a fresh isolated directory and executes only installed bins. It verifies:

- CLI version;
- bounded file read and text search against an isolated target;
- MCP stdio initialization, tool discovery, and bounded file read;
- JSON-RPC stdout cleanliness;
- bounded MCP-stdio shutdown with close-race detection, SIGTERM/SIGKILL escalation, and a final deadline;
- complete configured workspace-source inventory unchanged outside declared `.ontology` runtime state;
- runtime-created files contained under a real, non-symlinked `.ontology` directory and reported separately;
- archive checksum and payload repeatability;
- tracked-clean source posture for `candidateReady`.

The retained evidence path is:

```text
.test-results/local-production-candidate.json
```

Before each dogfood run, the prior canonical evidence file is invalidated through a physically checked path. Every success or failure packet carries a fresh `runId` and is written atomically under a physically verified real `.test-results/` directory, so a failed current write cannot leave an older successful packet at the canonical file path. A failure packet contains only a typed stage code, fixed bounded message, and `diagnosticsPromoted: false`; child stdout/stderr, submitted/local paths, credentials, stack details, and raw producer diagnostics are not written into the packet. Full raw diagnostics remain available only on the non-promoted local stderr surface when the operator explicitly sets `SCI_LOCAL_PRODUCTION_DIAGNOSTICS=1`.

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

The bundled `README.md` is the installed-runtime lifecycle authority. It must remain executable without a source checkout and cover checksum verification, fresh version-directory installation with lifecycle scripts disabled, bin/PATH discovery, CLI use, absolute-path MCP-stdio configuration, upgrade, rollback, and uninstall. The bundled `CONFIG.md` owns installed workspace and state configuration.

Source-checkout commands (`bun run production:candidate:check`, repository scripts, `just`, tests, and builds) must be visibly separated from installed commands (`semantic-code-intelligence`, `sci`, and `semantic-code-mcp`). Upgrade, rollback, and uninstall may change only versioned runtime installation paths; target-repository `.ontology` state is retained unless the repository owner separately authorizes its backup and deletion.

The runtime tarball does not vendor its dependency closure. Installation may resolve dependencies from an operator-approved registry or local cache, and the current `--no-save` flow retains no lock in the version directory. Candidate evidence must therefore say that installed dependency resolution is non-hermetic and that a local SCI archive is not an offline bundle.

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
