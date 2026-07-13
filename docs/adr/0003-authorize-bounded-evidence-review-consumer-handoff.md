---
summary: "ADR-0003: Authorize the bounded read-only Pi consumer handoff for SCI evidence review v1."
read_when:
  - "You need the current authority for SCI-to-Pi evidence review."
  - "You are changing the evidence-review producer, consumer contract, or host boundary."
  - "You need to distinguish the delivered evidence-review slice from broader Phase 2 work."
type: "adr"
system4d:
  container: "Bounded SCI-to-Pi evidence review after ADR-0002 reconsideration gates were satisfied."
  compass: "Make SCI evidence legible to an operator without transferring normalization, mutation, or governance authority to the host."
  engine: "Strict evidence_review.v1 production, fail-closed consumer validation, inert TUI rendering, and cross-owner live proof."
  fog: "A delivered read-only panel does not authorize a dashboard, IDE, persistence, command execution, publication, or AK decision advancement."
---

# ADR-0003: Authorize Bounded Read-Only Evidence Review Consumer Handoff

Status: Accepted
Date: 2026-07-12
Accepted: explicit operator authorization of the bounded Pi consumer implementation, followed by the instruction to proceed with governance alignment after live producer-to-consumer proof
Authors: Semantic Code Intelligence and Pi operator-workbench owners

## Authority note

This is an operator-accepted, human-readable repository policy artifact for the bounded handoff described below. It supersedes ADR-0002's temporary Option A deferral because all reconsideration gates were satisfied and the owning Pi repository accepted and implemented the consumer.

It is not a DB-native AK decision and does not revive, advance, or replace superseded AK decisions `46` or `47`. AK remains runtime authority for direction, tasks, decisions, and evidence where registered. The Pi package and this ADR do not make rendered evidence canonical AK evidence.

## Context

ADR-0002 kept evidence review CLI/markdown/JSON-only until SCI could represent the claim model and absence states, prove read-only behavior, and obtain Pi/operator-workbench owner acceptance.

The sequence subsequently completed:

1. SCI implemented and verified first-class evidence artifacts, limitations, claims, authority boundaries, operator decision points, absence states, and selected-versus-recommended command distinctions.
2. SCI authored the strict `semantic-code-intelligence.evidence_review.v1` schema, fixtures, semantic reference checks, and bounded handoff contract.
3. The operator explicitly authorized a standalone Pi consumer in the owning `pi-extensions` repository.
4. Pi implemented `packages/pi-evidence-review` as an inert, read-only TUI consumer under AK task `3843`, then added a bounded picker under task `3853` and summary/detail rendering under task `3855`.
5. A real `patch_checks_in_snapshot` producer flow exposed a strict-schema mismatch. SCI repaired the producer boundary under task `3866` rather than weakening consumer validation.
6. Fresh real SCI output passed the Pi validator and rendered successfully in picker, summary, and detail views. The workflow remained preview-only and the consumer performed no apply, command, network, persistence, or authority action.

The implementation evidence is recorded in SCI commits `ba51733` and `b6ca964` and Pi commits `3bd23303`, `7f67c23c`, `eb0db086`, and `18f2f306`, with governance closeout commits in the owning repositories.

## Decision

Authorize the delivered bounded handoff:

- SCI owns raw evidence interpretation, normalization, claim construction, and exact `semantic-code-intelligence.evidence_review.v1` emission.
- Pi may validate and inertly render a complete normalized v1 object through the standalone `pi-evidence-review` package.
- Pi may accept an explicitly named workspace-contained JSON file or, on an empty interactive invocation, offer a bounded picker containing only fully validated workspace candidates.
- The consumer remains fail-closed, TUI-only, read-only, and unavailable in headless modes before discovery or file access.
- Payload commands, paths, URIs, recommendations, options, and decision points remain inert text.
- The host must not normalize raw SCI packets, invoke SCI implicitly, execute commands, mutate repositories or snapshots, persist approvals or history, contact networks, activate links, or advance AK/DB state.
- The producer's embedded `handoffReadiness` remains a conservative SCI-local projection. A value such as `blocked / cli_only` must be displayed faithfully and must not be rewritten by the consumer. External owner acceptance is recorded by owner actions and this ADR, not manufactured inside producer output.

## Scope boundary

This decision authorizes only the delivered read-only consumer slice. It does not authorize:

- an SCI-owned UI;
- a general dashboard or VS Code extension;
- durable evidence, session, preference, or approval storage;
- copy-and-run, link activation, command execution, or automatic continuation;
- hidden command selection or recommendation ranking;
- raw packet normalization in Pi;
- publication, marketplace distribution, analytics, or production-readiness claims;
- a broad Phase 2 developer-workbench strategic frame;
- creation or advancement of any AK decision.

Any such capability needs a fresh owner-scoped decision membrane, validation contract, rollback boundary, and AK task scope.

## Consequences

Positive:

- Operators can inspect real SCI evidence during a harnessed coding session without reading a flattened JSON dump.
- SCI and Pi retain clear producer/consumer ownership.
- Strict validation caught and drove repair of a real producer defect.
- The feature can be removed independently without changing Phase 1 MCP, HTTP, CLI, snapshot, or patch semantics.

Trade-offs:

- File delivery remains an explicit or bounded-picker workflow rather than an automatic SCI-to-Pi stream.
- The producer cannot certify external host acceptance inside its own normalized value.
- The panel is evidence presentation only; operator decisions remain outside the package.
- Broader Phase 2 direction remains intentionally undecided.

## Rollback

Rollback is additive and cross-owner:

1. disable or uninstall `pi-evidence-review` in the Pi owner surface;
2. preserve SCI's v1 producer and CLI/JSON summary unless a separate compatibility change is approved;
3. revert host-only package changes without changing Phase 1 SCI contracts;
4. if v1 itself becomes unsafe, fail closed and coordinate a new discriminator rather than silently weakening validation.

## Validation and evidence

Acceptance rests on:

- ADR-0002 gates 1–5 verified under SCI task `3831`;
- strict schema, semantic, resource, hostile-text, containment, and non-mutation tests in both owner repositories;
- Pi task `3843` implementation and live TUI proof;
- Pi tasks `3853` and `3855` picker and rendering hardening;
- SCI task `3866` with 74 focused tests plus typecheck, lint, diff, and CI smoke;
- a fresh real `patch_checks_in_snapshot` artifact accepted and rendered by the installed Pi consumer;
- preview-only outcome with no source apply and no canonical authority transition.

Publication was not performed.

## Current product posture

This is the first completed Phase 2 evidence-review vertical slice, operated under active strategic frame key `SF2` (display ID `AK.V5.SF02`; Alpha maintenance and evidence-led direction discovery). It validates a narrow operator-workbench hypothesis; it does not by itself activate a broad IDE/dashboard phase.

The next product action is observation in real sessions. New work should respond to concrete evidence-review or substrate failures, or pass through a fresh explicit decision if it broadens capability or ownership.
