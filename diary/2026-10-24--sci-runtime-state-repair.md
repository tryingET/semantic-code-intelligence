---
summary: "AK7573: repair ignored build-runtime state capture and verify the original native App navigation call after bounded shared-MCP activation."
read_when:
  - "Investigating workspace-state failures in repositories with ignored .build or PlatformIO .pio trees"
type: "evidence"
---

# AK7573 — SCI workspace-state runtime repair

## Observed cause

Native `explore_symbol_impact(App, include/taschenschach/app.h)` failed in compact and standard modes. A direct call through the existing Pi bridge exposed the producer response: `InvalidParams`, `The workspace changed while the operation was running`, without a public recovery reason. The bridge correctly withheld unclassified producer diagnostics. The existing, separately owned normal-mode error-projection source work was not modified or activated here.

The state collector enumerated ignored generated content and treated a nested Git repository directory emitted by Git under the target's `.build/` scratch tree as a regular file. The file opener correctly refused a foreign repository; the collector mislabeled this stable refusal as drift. The target also has a large ignored PlatformIO `.pio/` dependency/build tree. No artifact, backup, binding, or target source was removed to make navigation pass.

## Narrow source repair

- Exclude root `.build/` and `.pio/` descendants only from **ignored, non-indexed discovery**. Ordinary untracked source, tracked-source diffs, other ignored source, and explicit requested files remain receipt inputs.
- Root-prefix matching does not exclude similarly named or nested source paths.
- Stable directory/special-file inventory entries fail unavailable before opening; file-open workspace reasons are preserved rather than replaced by false drift.
- Literal-backslash Git filenames fail unavailable before separator normalization can silently exclude them. This addresses an independent inspector's finding, with a demonstrated failing regression before correction.
- Existing file/byte/output budgets, nested-repository refusal, descriptor checks, and workspace identity semantics remain in place. No new backup exemption was introduced: other ignored files remain subject to the existing digest/budget policy.

Source commit: `c7b3a82ca2b22186563ce5b6983f2a2b8a581470` on the retained isolated branch. Main cherry-pick: `44e42a96` (same source/test change). The untracked dependency symlink in the development worktree was not committed.

## Verification and limitations

- Corrected initial regression baseline: **4 pass / 3 fail**.
- Independent-inspector backslash regression before correction: **0 pass / 1 fail** (seven filtered out).
- Final new runtime suite: **8 pass / 0 fail**, 14 assertions.
- Final focused runtime/binding/NEXUS suites: **23 pass / 0 fail**, 83 assertions.
- Both declared `tsgo` projects, all seven private build targets, scoped Biome checks, and `git diff --check` passed. Final import-order-only cleanup was Biome-checked and rebuilt for activation.
- The broader `BUN_JOBS=1 just test` run before the final filename guard returned **1214 pass / 1 fail / 36 skip**, not a green gate. Its only failure was `structural-workflow-service.test.ts`, resistant-descendant termination (`process.kill(pid, 0)` remained successful). The exact file reproduced **8 pass / 1 fail** on an isolated unchanged `d73c0c1f27c08d951cd3ea932c0ee7c86c19edc8` source checkout. The final focused suites cover the subsequent filename guard; no final full-suite-green claim is made.
- Independent source inspection approved the final correction. It did not claim deployed-runtime proof.

## Owner-authorized activation

The operator explicitly approved activating **only this fix**, retaining rollback, and accepting the independently reproduced broader-test failure for this bounded repair (AK evidence17234). Unrelated pending error/binding source changes were excluded from the runtime build, not silently bundled.

A scratch build helper loads every SCI source module from one exact Git commit while using the canonical module paths and the existing declared MCP build options/dependencies. Building the unchanged baseline this way reproduced the previous shared MCP bundle **byte for byte**. Building the reviewed fix this way avoids both unrelated dirty-source inclusion and scratch-path runtime dependencies. The initial isolated artifact needed a dependency-resolution symlink for testing; the deployed artifact uses canonical dependency resolution.

- Previous runtime SHA-256: `21f22005e10d59fe469c42d1d47028a54343aeb7b6ea0d0224072bb085cab27e`.
- Activated MCP runtime SHA-256: `ae5b5da89a7502133ed7ce2e5d2d42950a3e9c71fcba9cdc0efc096ffef0a66a`.
- Old runtime, immutable-build helper, authorization/provenance, unrelated-source hashes, and candidate proof are retained locally under `.ontology/ak7573-runtime/2026-10-24/` (generated/private runtime state, not committed).
- Only `dist/mcp/mcp.js` was atomically replaced. Other built entrypoints were not replaced. Five pre-existing dirty source/document files passed byte-hash checks unchanged.
- Exact-artifact native-registration/MCP checks passed compact and standard modes on the actual target (about 1406 ms and 746 ms in that run).
- **After activation, the actual registered native `explore_symbol_impact` tool passed both compact and standard calls in this session**, with `status: confirmed`, `definitionConfirmed: true`, and definition `include/taschenschach/app.h:16`. Workspace identity and state remained bound. No manual worker termination or reload was needed; other long-lived clients may retain an already loaded producer until reconnect.

C++ header graph expansion remains unsupported/degraded in the returned semantic limitations; successful definition navigation is not whole-program C++ impact coverage. No device reset/flash/input, public publication, unrelated source adoption, or task lifecycle completion was performed.

## Rollback

The prior shared MCP artifact is `.ontology/ak7573-runtime/2026-10-24/mcp-before.js`. A separately authorized rollback can verify its recorded hash, copy it to a same-directory temporary file under `dist/mcp/`, preserve the runtime file mode, and atomically rename it over `dist/mcp/mcp.js`, then reconnect the affected client. Do not delete target `.ontology` state or remint workspace bindings. No rollback was executed.
