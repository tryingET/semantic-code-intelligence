---
summary: "Preparation and validation checklist for the ADR-0004 trusted-local SCI runtime candidate."
read_when:
  - "You are preparing or validating an SCI local single-user runtime candidate."
  - "You need to distinguish source-checkout preparation from installed-runtime operation or distribution authority."
type: "procedure"
---

# Local candidate preparation checklist

Preparation only; no distribution authority.

This procedure prepares the `2.1.0-rc.3` candidate defined by
[the release-preparation contract](docs/project/local-single-user-release-preparation.md). It is
limited by [ADR-0004](docs/adr/0004-local-single-user-production-candidate.md) to one trusted local
operator, one trusted repository, and installed CLI/MCP-stdio use.

Completing this checklist does not authorize a push, tag, GitHub release, package or image
publication, recipient transfer, network service, or deployment. Task `4899` owns a later explicit
push/remote-CI confirmation gate. Task `4903` owns a later decision-only distribution gate.

## 1. Keep the two operating contexts separate

| Context | Available commands |
|---|---|
| Source checkout | Build, tests, `bun run production:candidate:check`, and all repository validation scripts |
| Installed runtime tarball | `semantic-code-intelligence`, `sci`, and `semantic-code-mcp` from the versioned install's `node_modules/.bin` |

Do not tell an installed-runtime operator to use `just`, repository scripts, source files, or the
source-only package scripts. `README.md` and `CONFIG.md` are bundled with the tarball and contain the
self-contained installed lifecycle.

## 2. Prepare from a tracked-clean source commit

From the repository root, run the task-scoped checks before the final candidate gate:

```bash
./scripts/ci/portable.sh
bun run alpha:mvp:check
just ci
bun run production:candidate:check
git status --porcelain=v2 --untracked-files=all
```

The final run must report both `ok: true` and `candidateReady: true`. The candidate builder writes
ignored local output only:

```text
.test-results/local-production-artifact/semantic-code-intelligence-2.1.0-rc.3.tgz
.test-results/local-production-artifact/artifact-manifest.json
.test-results/local-production-candidate.json
```

The archive is not a distribution channel merely because it exists locally.

## 3. Review identity, bytes, and packaged documentation

Set paths to the newly built files, never to an older artifact with the same name:

```bash
export SCI_VERSION=2.1.0-rc.3
export SCI_ARCHIVE="$PWD/.test-results/local-production-artifact/semantic-code-intelligence-${SCI_VERSION}.tgz"
export SCI_MANIFEST="$PWD/.test-results/local-production-artifact/artifact-manifest.json"
export SCI_EVIDENCE="$PWD/.test-results/local-production-candidate.json"

test "$(sha256sum "$SCI_ARCHIVE" | awk '{print $1}')" = "$(jq -er '.artifact.sha256' "$SCI_MANIFEST")"
test "$(jq -er '.artifact.sha256' "$SCI_EVIDENCE")" = "$(jq -er '.artifact.sha256' "$SCI_MANIFEST")"
jq -e '.ok == true and .candidateReady == true and .artifact.repeatablePayload == true' "$SCI_EVIDENCE"
```

Review the sorted payload entries and confirm the bundled operator documents are present:

```bash
jq -r '.artifact.entries[].path' "$SCI_MANIFEST"
tar -tzf "$SCI_ARCHIVE" | rg '^package/(README.md|CONFIG.md|LICENSE|bin/semantic-code-intelligence|bin/sci|bin/semantic-code-mcp)$'
```

A checksum detects byte drift. It is not producer authentication for a recipient; any later accepted
distribution decision must define how producer identity and the checksum are authenticated.

## 4. Rehearse the installed lifecycle

Follow the exact **Installed local single-user candidate** procedure in the bundled `README.md` using
a fresh version directory. The tarball does not vendor its runtime dependencies: Bun may resolve them
from the operator-approved registry or local cache, and the resulting installation is not an offline
or hermetic dependency closure. Record that limitation rather than describing the tarball as
self-contained.

Confirm all of the following without a source checkout:

- checksum verification precedes installation;
- Bun installs the reviewed local tarball with lifecycle scripts disabled;
- all three bins resolve from the versioned install;
- CLI `read_file` and `text_search` work from the trusted target repository;
- the MCP client launches the absolute `semantic-code-mcp` path over stdio;
- upgrade and rollback switch only the install's `current` symlink;
- uninstall removes only the selected versioned runtime;
- runtime writes remain contained under the target repository's `.ontology` directory;
- source outside `.ontology` remains unchanged, and lifecycle operations never silently delete or migrate existing `.ontology` state.

The executable `bun run production:candidate:check` dogfood performs an isolated installed CLI and
MCP-stdio rehearsal. Manual instructions must not claim support beyond that executable proof.

## 5. Freeze and record the candidate

A dedicated validation task (as `4898` did for `2.1.0-rc.1`) binds `2.1.0-rc.3` to one exact
commit, archive SHA-256, and repeatable payload digest. Record through AK:

- exact source commit and version;
- archive SHA-256 and payload digest;
- installed CLI and MCP-stdio receipts;
- source-unchanged and runtime-state containment results;
- independent review;
- explicit non-effects and unsupported claims.

After that binding, any tracked change requires a new candidate version. Never replace bytes under
`2.1.0-rc.3`, even if the candidate was never distributed.

## 6. Stop before external effects

A locally green candidate still has no distribution channel. Stop after local preparation unless the
later AK stack supplies its own authority:

1. task `4899` requires explicit confirmation immediately before an exact-SHA push and remote CI;
2. task `4903` records an accepted, rejected, or deferred distribution decision and performs no
   release effect;
3. a release-execution task does not exist and may be created only after an accepted decision plus
   separate accountable-operator authorization.

HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, hosted use, untrusted repositories, multiple users,
multiple tenants, and production availability or latency SLOs remain outside this candidate.
