---
summary: "AK7582: Given/When/Then red-green repair of a structural-process test fixture, with real-child readiness and independent cleanup checks."
read_when:
  - "Investigating the former resistant-descendant baseline failure or structural-process fixture safety"
type: "evidence"
---

# AK7582 — executable Given/When/Then process-cleanup scenarios

## Request and corrected diagnosis

The operator requested Gherkin-style red-green TDD for the independently reproduced baseline failure left after AK7573. This task changes only `tests/structural-workflow-service.test.ts` and this diary. Scenarios use the existing Bun runner with executable `Scenario:` names and Given/When/Then steps; no Cucumber dependency or unexecuted specification was added.

This session initially described the symptom as a process-cleanup baseline failure. Instrumentation refined that interpretation: the 100 ms execution deadline expired before the fixture emitted any PID. The failing run had `stdout: ""`, `descendantPid: 0`, `timedOut: true`, and `terminationConfirmed: true`. `Number("")` becomes zero, and `Number.isSafeInteger(0)` passes. The final `process.kill(0, 0)` therefore probed the test caller's process group, not a surviving descendant. This was not evidence of a production descendant leak or zombie. No production correction was justified by this observation.

## Red → green evidence

1. Original focused file: **8 pass / 1 fail**. The failure also reproduced alone with instrumentation; empty output and PID zero were observed directly.
2. New unsafe-PID scenario against the former numeric conversion: **0 pass / 1 fail**. It expected refusal but received `0` from empty output.
3. Strict PID parsing rejects blank, zero, one, negative, fractional, malformed, multiline, and unsafe-integer identities before any signal operation. Real process fixtures atomically announce readiness only after the descendant installs its SIGTERM handler.
4. Both timeout and successful-parent-exit scenarios require a real positive child PID, an observed ignored-SIGTERM marker, truthful runner result fields, and independently observed PID disappearance. The real timeout and hard termination deadline remain tested; no skip or success exception was introduced. A bounded readiness check races early settlement instead of assuming startup completes within 100 ms.
5. A dishonest injected process-group probe is a negative control: its claimed termination is rejected by the independent child-PID oracle. Fixture-owned cleanup stops that deliberately surviving child.
6. Independent inspection caught a failed-readiness teardown gap. A new scenario made the parent exit after spawning a ready descendant but before publishing readiness. The old teardown returned without cleanup: **0 pass / 1 fail**, with the child independently confirmed present. Its separate safety cleanup stopped the test child even during this red run.
7. Teardown now uses an independent, atomically published spawn-identity record, not the readiness record. Fault injection is disabled until that cleanup identity exists; an earlier setup failure retains actual process-group supervision. Linux command ownership checks remain, and disappearance races are handled only when independently confirmed.
8. Final focused file: **13 pass / 0 fail**, 45 assertions. Three additional isolated repetitions, each with fresh fixture roots, produced **13 pass / 0 fail** each. This is sampled Linux/Bun stability, not a claim of all-platform determinism.

## Verification and inspection

- Final canonical `BUN_JOBS=1 just test`: exit0, all four slices completed, **1466 pass / 0 fail / 43 existing skips**.
- Declared `just alpha-mvp-check`: exit0 when run serially, including typecheck, command/public-surface checks, Alpha/evidence suites, local dogfood, and migration hygiene.
- Private `bun run build:all`, both `tsgo` projects, scoped Biome, and `git diff --check` passed.
- The first Alpha attempt ran concurrently with the normal suite in the same worktree and failed its read-only Git-state assertion when it observed `.tmp-overlay-apply-base-...txt`. That filename is created by `tests/overlay-store-apply.test.ts`. The failed receipt is retained; the correction was serial execution, not changing the read-only assertion or unrelated product code. Do not run these workspace-sensitive gates concurrently in one checkout.
- Independent inspection initially requested the teardown fix, then approved the exact corrected test delta. It reviewed the red/green logs but did not execute the tests or certify broad-suite results itself.
- `src/core/workflows/structural-evidence-process.ts` and all other production files are unchanged. The shared MCP bundle remains SHA256 `ae5b5da89a7502133ed7ce2e5d2d42950a3e9c71fcba9cdc0efc096ffef0a66a`; no rebuild/activation of that shared runtime was performed under this task.

## Custody and remaining boundaries

Private local logs are retained beside the task worktree under the session's TMPDIR-owned `ak7582-process-tdd.*` directory: original/diagnostic red, unsafe-PID red, failed-readiness red, focused green, three repetitions, initial and final full suites, initial contaminated Alpha and serial passing Alpha, style/typecheck/build output. Source/test inspections and canonical AK evidence identify the durable result; scratch logs are not lifecycle authority.

No device reset, flash, input, publication, unrelated dirty-source adoption, or task lifecycle completion was performed. Rollback is reverting this task's test/diary commit; there is no production runtime migration to undo. Non-Linux cleanup behavior remains unverified. Existing suite skips were not removed or presented as passing coverage.
