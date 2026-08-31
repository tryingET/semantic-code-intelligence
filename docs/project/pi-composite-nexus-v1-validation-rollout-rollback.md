---
summary: "Validation, rollout, rollback, and stop rules for Pi Composite NEXUS v1."
read_when:
  - "You are validating, landing, or rolling back decision 145 implementation."
type: "validation-plan"
---

# Pi Composite NEXUS v1 validation, rollout, and rollback

Date: 2026-08-31
Decision: AK `145`

## Validation ladder

1. Reference parser/persistence/root-identity unit tests.
2. Wrong-root, same-symbol, state-drift, nested-repo, tamper, symlink, and restart tests.
3. Deterministic snapshot CAS/interleaving, stale check/apply, legacy quarantine, and artifact-revision
   tests.
4. Five-workflow direct/MCP/HTTP/CLI parity tests.
5. `bun run typecheck`, focused sliced tests, then `bun run alpha:mvp:check`.
6. `bun run production:candidate:check` from a tracked-clean commit.
7. Pi companion `npm test`, `npm run dogfood`, and package quality gate.
8. Local companion reinstall, fresh Pi process, and real explore/locate plus both preview routes.

Passing tests prove the named trusted-local profile only. Generated artifacts remain local evidence
until attached through AK.

## Rollout

1. Land additive producer contracts and behavior.
2. Land companion support and require NEXUS refs only inside the native Pi profile.
3. Reinstall the local companion and reload/start a fresh Pi process.
4. Observe real-task use before any direct-client mandatory migration.
5. Handle version promotion or distribution through a separate decision.

## Rollback

- Disable the Pi NEXUS profile and restore legacy companion calls without accepting cross-workspace
  paths.
- Revert additive producer workflow fields and reference discovery if no v1 snapshot was created.
- If v1 local metadata exists, retain it inertly or remove only proven generated `.ontology/nexus`
  state after the producer is stopped; never rewrite it as legacy evidence.
- Preserve legacy snapshot inspection and existing containment.
- Never roll back by enabling ambient cross-workspace access or dynamic rebinding.

## Stop rules

Stop landing if:

- decision 145 is not accepted or exact task scopes are absent;
- workspace persistence cannot fail closed on symlink/tamper/root identity drift;
- deterministic tests cannot prove checked revision equals applied revision;
- navigation cannot prove one stable observed state;
- companion schema negotiation or old-client additive compatibility fails;
- source/package/live gates fail;
- required work widens into LSP, hosted, global-registry, or broad persistence scope;
- target files overlap unrelated dirty work without an isolated workspace and coordinated landing.
