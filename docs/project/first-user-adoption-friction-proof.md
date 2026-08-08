---
summary: "IW77 contract for measuring real first-user adoption, call economy, and friction before choosing SCI's next product direction."
read_when:
  - "You are executing or reviewing IW77 first-user adoption evidence."
  - "You are deciding whether SCI should remain an internal substrate, deepen semantic precision, broaden local distribution, or enter another Phase 2 slice."
type: "contract"
---

# IW77 — First-user adoption and friction proof

Status: active contract under AK direction wave `IW77` (`AK.V5.SF02.WW77`)  
Strategic frame: `SF2` — Alpha maintenance and evidence-led direction discovery  
Binding task: AK `4696`

## Purpose

SCI has closed Phase 1 as an Alpha MVP substrate and has delivered a verified
local single-user production candidate for CLI and MCP stdio. Those facts prove
contract coverage and packaged behavior. They do **not** yet prove that real
harnessed coding sessions consistently obtain useful evidence with fewer calls,
fewer stale assumptions, and acceptable friction.

IW77 gathers that missing first-user evidence before selecting another product
direction. It is not a confidence-only dogfood campaign and does not reopen
Phase 1.

## Authority and boundaries

- [`VISION.md`](../../VISION.md) remains the durable north star.
- [`product-posture.md`](product-posture.md) remains the phased product boundary.
- Installed Agent Kernel is canonical for `SF2`, `IW77`, execution tasks,
  decisions, evidence, and lifecycle state.
- This contract defines measurement semantics and sequencing. It does not
  create task, decision, release, publication, or target-repository authority.
- SCI owns its generic tool contracts, packaged artifact, evidence schema, and
  product interpretation.
- Pi or another harness owns native tool activation, session lifecycle, and
  harness-local call records.
- Each target repository owns its source, task intent, validation, and mutation
  permission. IW77 evidence capture must leave targets unchanged unless an
  independently authorized target task permits mutation.

Superseded Phase 2 decisions `46` and `47` remain superseded. IW77 does not
activate dashboard, IDE, hosted, public-release, or multi-user scope.

## Starting facts, not adoption proof

The following are reusable baseline facts:

- `bun run alpha:mvp:check` proves the closed Alpha contract bundle;
- AK-4056 and ADR-0004 prove a local tarball installed through CLI and MCP stdio
  for one trusted operator and repository;
- Pi startup evidence proves that SCI composites can be registered lazily
  without eager MCP child processes;
- AK-4143 proves the repository can emit a bounded closeout receipt;
- target-cwd dogfood proves generic installed CLI invocation without committed
  machine-local paths.

An IW77 episode must exercise SCI during a real operator-authorized coding task.
Replaying a fixture solely to increase sample count is not an adoption episode.

## Questions

IW77 must answer:

1. Across a prospectively declared sequence of eligible real tasks, how often
   does the configured composite-first procedure begin with the smallest
   matching SCI composite?
2. Does the first composite return correct and complete-enough definition,
   reference, graph, or preview evidence to advance a predeclared task milestone
   without repeated probing?
3. What is the total discovery cost before validated useful evidence, counting
   SCI composites, SCI primitives, native harness tools, and shell calls?
4. Which fallbacks remain necessary, and are they caused by product gaps,
   target constraints, or legitimate owner-surface boundaries?
5. Does packaged CLI or MCP stdio behavior remain usable outside the SCI source
   checkout?
6. Which independent frictions recur strongly enough to justify repair?
7. What next direction is supported by evidence: remain an internal substrate,
   deepen semantic precision, broaden a local distribution channel, or review
   another bounded operator-workbench slice?

IW77 evaluates the effectiveness and compliance of an explicitly configured
composite-first procedure. It does not claim to measure an unaided model's
spontaneous tool preference.

## Study design and sampling

Before episode acquisition, the execution task records a sampling window and
captures every consecutive eligible real task encountered in that window.
An eligible task:

- has an owner-authorized code-navigation, definition-confirmation, impact, or
  preview/check question;
- has a matching SCI composite available before the first discovery action;
- is not created solely for IW77 coverage;
- can expose privacy-safe call chronology and target-posture evidence.

Every eligible task is included or recorded as rejected with a reason. Coverage
classes below do not permit cherry-picking easy tasks. If the consecutive window
does not produce a desired class or language family, report the gap rather than
manufacturing an episode.

The episode records harness, model, session, and interface identity plus a
privacy-safe chronological list of all discovery actions. Composite availability
is established before the first discovery action. Session JSONL may supply the
chronology but remains historical capture until accepted facts are recorded in
AK.

The accountable operator or exact AK task owner accepts episode validity,
friction admission, and any go decision. Packet generation alone cannot create,
claim, or execute a follow-on task.

## Valid adoption episode

Each episode must record:

| Field | Requirement |
|---|---|
| Episode identity | Stable local identifier; sampling-window position; start/end monotonic timestamps. |
| Harness identity | Harness, model, session identifier, interface, and composite registry/availability observed before discovery. |
| Real task authority | Operator-authorized task intent, owner repository, exact owner-native task or authorization reference, and explicit mutation permission (`none`, `preview_only`, or separately authorized apply). |
| Predeclared milestone | The concrete question, expected task-advancement milestone, and validation method declared before SCI calls. |
| SCI identity | Exact commit or packaged-artifact SHA-256/payload digest. |
| Call chronology | Ordered SCI composite, SCI primitive, native harness search/read, shell, validation, and owner-surface actions with status and elapsed time. |
| Target posture | Before/after HEAD; `git status --porcelain=v2 --untracked-files=all`; tracked-diff and untracked-manifest digests; generated `.ontology` state and cleanup evidence. |
| Composite result | Composite name, arguments summary, structured status, sufficiency classification, issues/limitations, and elapsed time. |
| Fallbacks | Count, action class, reason, and evidence that the composite was insufficient or the owner surface required the fallback. |
| Raw shell avoided | Specific chain that was not needed; retained only as explained inference, never the measured call-economy denominator. |
| Outcome | Validation result, useful-evidence decision, sufficiency, and whether the predeclared milestone advanced. |
| Failure class | None, product defect, false success, sparse evidence, latency, packaging, target limitation, harness integration, owner-boundary stop, or censored/unfinished. |
| Safety | Preview/apply posture, checks, exact target delta, authorization match, and rollback evidence when applicable. |
| Interpretation | What the episode proves and explicitly does not prove. |

Operational definitions:

- **Episode start** is the first discovery action after the real task and
  predeclared milestone are accepted.
- **Useful evidence** is the first result that directly answers the predeclared
  question, enables the next task action, and survives the declared
  target-native check, exact-source comparison, or accountable-owner review.
- **Composite sufficient** means no SCI primitive or native code-discovery call
  is required before the next task action, and later validation finds no
  material correction to the composite's answer.
- **Task advanced** means the predeclared milestone is reached and accepted by
  the target task owner or its owner-native validation surface.
- **Time to useful evidence** is measured from episode start to the validated
  useful result using monotonic timestamps. Failed, unfinished, or never-useful
  episodes are reported as censored and receive no synthetic success latency.

Promote accepted episode facts through the AK task/evidence surface; place
reusable learnings through the owning KES path.

## Scenario portfolio

The bounded portfolio reports observed coverage across at least four valid
consecutive eligible tasks, at least two non-SCI repositories, and at least two
implementation-language families when the sampling window naturally supplies
that diversity. Coverage classes are:

1. definition and impact planning with `explore_symbol_impact`;
2. uncertain definition confirmation with `locate_confirm_definition`;
3. owner-authorized preview/check with `patch_checks_in_snapshot`,
   `structural_patch_checks`, `rename_safely`, or `safe_write` preview;
4. reviewed packaged CLI or MCP stdio use from a target-repository cwd.

The composite-first procedure may name the preferred composite for an eligible
shape, but the study must not insert synthetic tasks or omit difficult eligible
tasks to satisfy coverage. Naturally occurring failures remain in the cohort.
Do not mutate another repository to manufacture coverage.

## Metrics

Report both aggregate and per-episode values:

- `eligibleEpisodes`, `validEpisodes`, rejected episodes, and rejection reasons;
- `episodesWithMatchingCompositeAvailable` and the eligibility denominator;
- `episodesStartingCompositeFirst`;
- `discoveryActionsBeforeUsefulEvidence` split into SCI composites, SCI
  primitives, native harness search/read, and shell actions;
- `totalDiscoveryActionsBeforeUsefulEvidence`;
- `fallbacks` by action class and reason;
- `timeToFirstUsefulEvidenceMs` plus censored episode count;
- `compositeSufficientWithoutDecomposition`;
- `taskAdvancedAndOwnerValidated`;
- `targetDeltaZero` and generated-state cleanup posture;
- `failureClasses`, including false success and censored/unfinished;
- packaged-interface success and exact artifact identity.

Call economy is not a single scalar. A low call count that returns misleading
or incomplete evidence fails. Native reads and SCI primitive decomposition count
as workflow cost even when shell use is zero. A justified bounded fallback is
better than a false composite success.

## Stop/go thresholds

The evidence-acquisition slice is complete only when:

- one prospective window records every consecutive eligible task and every
  rejection reason;
- at least four episodes satisfy the validity contract;
- the observed portfolio includes at least two non-SCI target repositories and
  two language families, or reports the unsatisfied diversity requirement
  without substituting synthetic work;
- every episode records harness/model/session identity, exact SCI/interface
  identity, predeclared milestone and validation, complete call chronology, and
  exact initial/final target posture;
- at least three episodes begin composite-first when a matching composite was
  established as available;
- every claimed-useful result survives its predeclared validation;
- at least three of four valid episodes advance their predeclared task milestone
  with owner-native validation;
- at least three episodes reach validated useful evidence in no more than four
  total discovery actions, with no more than two non-composite discovery actions
  after the first composite;
- every fallback has an action class and classified reason;
- every episode without separate mutation authority has zero target delta,
  including cleanup of newly generated SCI state;
- failures, false successes, indeterminate results, and censored episodes remain
  visible rather than being rewritten as successes.

Stop without repair tasks when chronology is ambiguous, correctness validation
or target posture cannot be proven, the cohort is cherry-picked or mostly
synthetic, or fewer than three episodes advance real task milestones. Extend the
sampling window only to resolve a named uncertainty, not to improve a score.

## Friction admission

A repair candidate enters IW77 only when one of these is true:

- the same product friction appears in at least two valid episodes from
  independent tasks or targets rather than correlated repeats of one task;
- one episode exposes a high-consequence correctness, containment, mutation,
  protocol, or packaging defect;
- packaged CLI/MCP stdio cannot perform an already supported contract;
- a composite returns false success or materially misleading planning evidence.

Sparse results that accurately report limitations are not automatically bugs.
Owner-boundary stops are not SCI failures.

The accountable operator or target/SCI task owner must accept the friction in
AK before any repair task is created or claimed. Each accepted repair receives
a separate scoped AK task, focused regression proof, smallest truthful
validation, and independent review where risk warrants. No generic “improve
confidence” task is allowed.

## Ordered execution stack

1. **Contract binding — AK-4696**  
   Bind scenarios, metrics, validity, thresholds, owner boundaries, and this
   execution stack.
2. **Episode acquisition and packet assembly**  
   Capture the bounded real-task portfolio, reject invalid episodes, and emit a
   concise packet with per-episode and aggregate interpretation.
3. **Friction triage**  
   Classify observations against the admission rule. Create no repair task when
   the evidence does not meet it.
4. **Evidence-backed repair slices**  
   Implement only admitted top frictions in separate tasks; preserve contract
   and target-owner boundaries.
5. **Revalidation**  
   Re-run only the affected scenario plus the smallest canonical SCI gate that
   protects the changed contract.
6. **Direction recommendation**  
   Produce one evidence-based recommendation for the next strategic frame or
   explicit continuation of SF2. A recommendation is not decision authority.

Tasks after step 1 are created only after the preceding gate supplies truthful
scope and the accountable operator or exact AK task owner records acceptance.
The packet or contract never creates execution authority by itself.

## Evidence packet commitment

The episode-acquisition task must emit a machine-readable packet with:

- schema/version;
- exact SCI revisions/artifacts, harness/model/session identities, and interfaces;
- prospective sampling window, eligible denominator, accepted and rejected episodes;
- privacy-safe chronological action classes and timing boundaries;
- predeclared milestones, validation methods, and owner acceptance references;
- metric definitions and values, including censored episodes;
- friction candidates with recurrence/severity evidence;
- before/after target HEAD, status, diff/untracked digests, generated-state cleanup, and mutation posture;
- known limitations;
- `proves` and `doesNotProve` lists;
- one recommended next action.

The packet may summarize session and generated evidence but must not copy
secrets, private target content, or machine-local paths into committed files.

## Validation

Contract changes require:

```bash
node ~/ai-society/core/agent-scripts/scripts/docs-list.mjs \
  --docs docs/project --strict
ak direction check -r "$PWD" -F json
```

Execution tasks add the smallest repo-owned tests and command gates for the
contract they change. The terminal recommendation requires independent review
of measurement validity, owner-boundary preservation, and claim calibration.

## Non-authorizations

IW77 does not authorize:

- public package, branch, container, or evidence publication;
- target-repository mutation without target-owner task authority;
- dashboard, VS Code, broad Pi workbench, or new interaction semantics;
- HTTP/MCP HTTP/LSP production promotion;
- hosted, untrusted-code, multi-user, or multi-tenant operation;
- canonical task, decision, approval, or governance authority in SCI;
- product promotion based only on Alpha validation or packaged smoke evidence.
