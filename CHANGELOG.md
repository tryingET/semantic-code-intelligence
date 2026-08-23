# Changelog

This changelog records user-visible Semantic Code Intelligence candidate changes. The repository has
no previous Git tag or GitHub release baseline, so the first entry is a curated local-candidate
baseline rather than a comparison against an invented release range.

## [2.1.0-rc.1] - Unreleased

First uniquely identified local single-user candidate under ADR-0004. Changes are curated from the
initial local production-candidate implementation at commit `1aca36c8`; this is not a claim that
`2.0.0` was distributed or formally released.

### Added

- First-class composite workflows for symbol impact, definition confirmation, safe rename, and
  preview/check operations.
- Compact, standard, and debug progressive disclosure for `explore_symbol_impact`.
- Structural edit-risk signals in impact packets, with bounded analysis accounting and explicit semantic limitations.
- A versioned local tarball gate that installs and exercises the packaged CLI and MCP-stdio bins.
- Bundled installed-runtime instructions for checksum verification, bin discovery, MCP stdio,
  upgrade, rollback, and uninstall.

### Changed

- Unconfirmed impact packets are decision-first: they withhold edit authority, separate observed
  graph claims from usable normalized evidence, and provide exact `locate_confirm_definition`
  recovery arguments.
- Standard `explore_symbol_impact` details now use normalized schema version `2`; debug retains a
  separately bounded and redacted diagnostic projection.
- The candidate package/runtime identity is `2.1.0-rc.1`, avoiding reuse of materially different
  `2.0.0` artifact names.

### Fixed

- Outside-workspace definition input returns stable, sanitized `outside_workspace` recovery without
  submitted paths, host paths, stack traces, or raw producer diagnostics.
- MCP telemetry records resolved tool results with `isError: true` as application failures rather
  than successful operations merely because transport completed.

### Internal reliability

- Stateful Layer 4 tests use isolated in-memory storage where persistence is not under test.
- Millisecond circuit-breaker tests advance deterministic system time instead of racing wall-clock
  deadlines.
- Governance snapshots and test hermeticity are internal reliability evidence, not user-facing
  product features.

### Experimental or source-checkout-only

- `semantic-code-intelligence experimental structural-evidence-receipt` is packaged in the installed
  CLI as an explicit experimental surface. It is outside the CLI/MCP-stdio production-candidate
  commitment and is not registered as an Alpha MCP/HTTP tool.
- Repository closeout receipt tooling remains source-checkout-only validation tooling, not installed
  runtime or release authority.
- Native Pi integration requires a separately prepared compatible private
  `pi-semantic-code-intelligence` bridge under AK task `4901`.

### Known limitations

- Production-candidate support is limited to one trusted local operator, one trusted repository, and
  installed CLI/MCP stdio.
- HTTP, MCP HTTP, LSP, Docker, Compose, Kubernetes, hosted operation, untrusted repositories,
  multiple users/tenants, and public package publication are unsupported production claims.
- The tarball does not vendor dependencies; Bun may resolve them from an approved registry/cache,
  and the current `--no-save` installation retains no dependency lock.
- IW77 produced no terminal-valid adoption episodes, so this candidate makes no broad adoption,
  call-economy, general effectiveness, or product-market-readiness claim.
- No distribution channel, tag, upload, publication, or deployment is authorized by this entry.
