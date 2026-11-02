---
summary: "Cross-family reinspection of decisions 190 and 191: deployed SCI retirement remains defensible, but mixed snapshots, pilot interpretation and a false-green state-contract test require revision."
read_when:
  - "Deciding whether the corrected SCI retirement record is ready for an ADR."
  - "Citing the distinct-call census, Ripwire pilot arm, July ablation or device-drift explanation."
  - "Assessing the tool-written-state proposal's owner boundaries and verification test."
type: "review"
---

# Reinspection of the corrected SCI retirement record

- **Inspector:** `openai-codex/gpt-6.1-sol`, Pi session `01a19ae0-f232-73ec-bcc3-f569cf8084fc`, 2026-11-02.
- **Authority:** AK7954, claimed under this session; decisions 190 and 191 remained `review_pending`.
- **Inspected versions:** retirement record at SCI `50a80202`; first inspection at `d71aa8c6`;
  tool-written-state proposal at softwareco `2b6634a`.
- **Outcome 190: `revise_rfc`. Outcome 191: `revise_rfc`.** Neither outcome rejects retirement
  of deployed SCI. Neither authorizes an ADR, acceptance, or another execution stage.

## 1. Bottom line

The first inspector's principal corrections survive an independent extraction: fork copies inflated
activity, the R arm did not meaningfully offer Ripwire, July was mixed, and the pilot did not overturn
retirement. The corrected record is substantially better, but is not yet internally consistent or
sufficiently calibrated for an ADR.

**My recommendation:** retain reversible retirement of SCI **as deployed**. Its observed resolution
rate and operational failures justify stopping its default installation without proving that native
navigation is universally better. **High** confidence in that bounded operational recommendation is
reasonable. **Medium** confidence that *no repaired SCI would pay* is not supported by this experiment;
that question remains unestablished. This criticizes the evidential support for a universal forecast;
it does not quantify a replacement probability. Repair is not thereby authorized or economically justified.

Decision 191 now preserves source-owner authority in rules 3 and 4. Its four earlier gaps have textual
responses. However, its new verification clause admits a demonstrated false green: a machine-wide
ignore can hide exactly the producer defect that the test is meant to catch.

## 2. What was executed, read, and not repeated

Evidence roots, abbreviated below:

- **A:** `~/.local/state/pi-quests/tmp/sci-strategy-53c6411f/` — author's retained evidence.
- **I:** `~/.local/state/pi-quests/tmp/sci-review-9e04a635/` — first inspector's evidence.
- **G:** `~/.local/state/pi-quests/tmp/sci-reinspect-01a19ae0/` — this inspection's scratch.
- **J:** pi-extensions archive `docs/archive/pi-context-packer/pre-ripwire/experiments/source-selection/2026-07-25-v2/`.

| Check | Executed here | Read / not executed here |
|---|---|---|
| Call identity and outcomes | New streaming jq extraction over all 9,427 named raw session files; independent aggregation/classifier; duplicate-content checks; monthly counts | No original extractor or classifier executed |
| Snapshot consistency | Compared A's frozen call projection with newly extracted calls | A's raw projection was parsed with jq |
| Pilot costs and dose | New jq extraction over 18 raw arm sessions, including the designated dep-redteam/N rerun; independent ratio calculations | Existing grade exit codes, not rebuilt reference tests |
| Pilot integrity | Recomputed driver/manifest hashes; compared task bodies after removing amended setup/grade commands | Amendments and AK18651; did not repeat task selection across six repos |
| R arm availability | Compared first-turn input accounting; inspected historical toolbox startup code and pre-Stage-1 package list | No contemporaneous active-schema receipt exists here; no new Pi/LLM probe |
| Blind pilot assessment | Clean subagent graded pult X/Y/Z before parent opened the key | Parent had already read headline scores; did not blindly re-grade all six tasks |
| July | Recomputed per-repo precision from per-case results; inspected all ten pi-extensions requests and seeds | Full preregistration and evidence index; did not rerun SCI or ranking |
| Device defect | Fresh scratch binding, device-only mutation, rejection, restoration; independently dated era comparisons | I's 52-binding summary; no original fleet bindings recovered or modified |
| Proposal rule 6 | Scratch Git counterexample with ordinary and isolated ignore configuration | No census implementation or fleet sweep |
| Correction coverage | Checked record, proposal, committed posture text, AK19633/19634 and AK7952 | No changes to those surfaces |
| Value / containment / ownership history | Read supplied evidence and first inspection | Did not repeat the 30-case value labels, novel-pointer hunt, outside-cwd sample, historical authorization audit, archive restore, attention census, code-size counts or ROCS drift |

The package-owned Pi session extractor was exercised first on A's smoke session. Because it explicitly
does not deduplicate fork history or expose result bodies, the census required additional jq extraction.
Raw session JSONL was parsed only through jq. Python operated on jq-produced JSON/TSV, not raw sessions.

The code in G is new. I read `binding_census.py` and `pilot_costs.py` to attack their assumptions,
and read `analyze_pilot.py` to reproduce its discovery-result proxy definition; I did not run them.
The heavy raw-session pass used the workstation heavy-job runner and one niced process.

## 3. Findings by severity

### Material — F1. The repaired-SCI conclusion exceeds the intervention tested

The pilot offered a fresh binding and a target-root session. It did **not** test a compiler-backed
repair, per-repository routing, multi-workspace bindings, an out-of-tree state design, or difficult
navigation/refactor tasks. Five of ten SCI calls confirmed; all arms touched the same task source
files. That cannot establish an economic ceiling for repaired designs.

The record's §3.9 treats single-workspace containment as an unavoidable security tradeoff. It is a
property of this integration, not a proof that safely binding several explicitly selected workspaces
is impossible. Multiple separately checked roots need not mean unrestricted filesystem access.
Whether that redesign is worth its cost is a different, untested question.

**Required correction:** scope confidence to the deployed tool and repairs actually examined.
Replace the universal repaired-tool forecast with “no demonstrated benefit justifies funding repair
on this evidence.” Keep the observed file-operation mismatch, but not a ceiling on future designs.
This is my judgement, not a new performance result or a proposal to implement a repair.

### Material — F2. Rule 6 can certify a producer that violates rule 2

In a new G scratch repository, I wrote `.ontology/cache` **without** a producer `.gitignore`:

```text
ordinary git status --porcelain:                         <empty>
with global/system config and core.excludesFile disabled: ?? .ontology/
producer marker exists:                                 no
```

The checks can be repeated on the retained fixture (`G` is the scratch root above):

```bash
git -C "$G/ignore-repo" status --porcelain
GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  git -C "$G/ignore-repo" -c core.excludesFile=/dev/null status --porcelain
find "$G/ignore-repo/.ontology" -maxdepth 1 -type f -printf '%f\n'
test ! -e "$G/ignore-repo/.ontology/.gitignore"
git -C "$G/ignore-repo" check-ignore -v .ontology/cache
```

The inventory contains only `cache`; the marker-absence check exits zero. `check-ignore` names
`.ontology/` at line 7 of `~/.config/git/ignore`. Exact commands/output are in G's `rule6-commands.txt`.
The ordinary test passed because this machine already globally ignores `.ontology/`. The producer
neither stored state out of tree nor wrote its required self-ignoring marker. A clean Git status
therefore does not prove this contract. It also does not detect unchanged state already in the index.

**Required correction:** specify an isolated Git configuration, inspect actual state placement and
marker contents, and check the index for prohibited state. The producer's test should exercise its
write path, not merely an empty invocation. The separate census remains useful defence in depth,
not a replacement for a discriminating producer test.

The reporting split is workable: softwareco observes; producer owns correction; any consumer index
repair remains its owner's exact-task change under rule 4. The wording does not establish that a
census check has already been implemented, and I did not inspect one.

### Moderate — F3. The record combines two different census snapshots

The distinct-call result is right, but “1,510 distinct calls in 3,958 records” is not its provenance:

| Snapshot | Records | Distinct calls | Resolved | Unconfirmed | Errors |
|---|---:|---:|---:|---:|---:|
| A's frozen `sci-calls.jsonl` | 3,958 | 1,498 | 471 | 525 | 502 |
| Named raw files when re-read here | 3,970 | 1,510 | 471 | 526 | 513 |

A's projection dropped call IDs, so I matched its unique timestamp/name/argument signatures to the
raw call IDs. All 1,498 matched uniquely. The other 12 are later November observations, each occurring
once. Thus the extra records are **new calls**, not extra fork copies. Both snapshots have 2,460
copied records. G's `snapshot-delta.json` identifies every added call.

The first memo already notes newer observations for E3, but its headline and the corrected record
still combine the frozen record count with updated distinct totals. My all-tool count is 650,624,
not the older 650,163; the listed source paths are not immutable byte snapshots. The selection also
uses file modification time, not event time: SCI timestamps begin on July 21 despite “since July 27.”

**Required correction:** name the extraction cutoff and snapshot for each total. Use 3,970 for this
updated 1,510-call population, or consistently use the frozen 1,498-call population. This changes
neither the retirement recommendation nor the monthly July–October results.

### Moderate — F4. “Over-specified on wording” hides genuine pilot defects

The clean pult grader returned **X=1, Y=1, Z=1** before unblinding. The key then mapped X=R, Y=N,
Z=S. This agrees with the original coarse scores, but is not an equivalence finding:

- X/Z remove deduplication; a legacy lesson present in both records then appears twice.
  Packet lines 101–110, 644–654, 1598–1608 and the reported failures at 350–361 / 1269–1280 show it.
- All three update UI help but omit the planning-export `hinweise` change. The test is checking a
  missing interface output, not just a synonym. Reference line 148 and candidate export hunks
  658–694 / 1142–1179 / 1612–1649 establish the difference.
- All three suppress colleague rows for an own subject more broadly than the reference, which waits
  until the own record contains that subject. The compressed issue leaves some intent ambiguity;
  this is a behavioral discrepancy, not a verified additional runtime failure.
- The out-of-grid remove control **is** implemented elsewhere in the UI. Its automatic failure is
  a selector/location mismatch, so it should not be counted as absent behavior merely from that test.

The parent checked the issue/reference excerpt as well. The first inspector already identified the
first difference, but still endorsed the blanket wording explanation. The corrected §14 repeats it.

**Required correction:** distinguish test coupling, omitted integration behavior, and real regression.
Keep the 8/12 headline as a **reported rubric score**, not evidence of equal behavior or independently
rerun test success. No result here favours SCI.

### Moderate — F5. July's perfect control arm had privileged structural queries

Recomputed structural-minus-path precision is −0.140 (agent-scripts), −0.075 (engineering-core),
−0.065 (DSPx), and **+0.700** (pi-extensions); three-repo macro −0.0933, four-repo macro +0.105.
Eligible-repo fusion is +0.115 versus source-list +0.1067. The first inspector correctly rescued
these positive findings from selective reporting.

The pi-extensions arm has `maxItems=1`, ten singleton truths, and ten correct structural top picks.
That is a meaningful **conditional top-one selection** result, not an empty denominator trick.
But every structural query supplies an exact function signature and a narrowing package path.
For example, `pxc-ctrl-02` supplies `enforceReferenceIntegrity` plus
`packages/pi-evidence-review/src`; the paths arm receives only the maintenance question.
`pxc-ctrl-03` similarly supplies `sanitizePipeSegment`. How an agent obtains those seeds is not
priced or tested. Other cohorts have budgets of four or five, further limiting pooled interpretation.

“Match counts only” correctly describes the consumer's ranking signal, **not** all information in
the treatment: the producer performs seeded AST structural matching. This is neither proof of
whole-program semantics nor a fair end-to-end unknown-name retrieval comparison.

**Correction recommended:** retain the mixed numerical result and describe the seeded-query
condition. Do not turn either the negative three-repo macro or the perfect control into evidence
that semantic navigation generally fails or succeeds. The corrected “adds little either way” is fair.

### Moderate — F6. The exact historical root-cause census is partly reconstructed

I independently reproduce the code mechanism: `validateBinding` requires exact path/device/inode
identity and repository-marker identity. A fresh scratch binding on device 36 succeeds; changing
only `rootDevice` to 37 rejects it; restoring the bytes succeeds with the same workspace ID.
`parseNexusHandshake` replaces an error-shaped payload with “invalid reference contract.”

This was a mechanism test using the unchanged binding-check source and the existing checkout's
storage/error dependencies, which include pre-existing dirty work. It was **not** another deployed
MCP handshake or a new real-remount experiment.

I's `bindings.json` is a **summary**, not 52 preserved binding files. It records device-only
difference categories for all 52, but cannot independently establish their old bytes today.
`binding_census.py` groups calls and binding dates; it does not itself encode or verify an era-device
prediction test. Most importantly, the early era boundary was partly chosen from the failures.

Restricting my comparison to independently journal-dated eras from October 1 onward gives:

| Observation | Independently dated comparison |
|---|---:|
| E3, retained binding, known era | **118/118** stored devices differ |
| Non-error NEXUS result, binding predates call, known era | **89/89** stored devices match |
| Remaining E3 | 29 before those eras; 1 without retained binding |
| Other non-error NEXUS records | 24 binding summaries postdate call; 17 absent; 2 before those eras |

Devices inside eras come from newly minted bindings, with the October 30 era's device 54 from the
retained November 1 fresh binding. Boot boundaries are independently journal-dated; device labels
are not independently measured for every historical call. The journal has also rotated since the
first inspection.

**Verdict:** a strong, reproducible device-pinning defect and strong later-era corroboration.
“147 of 148 explained, no counterexample” is a qualified retrospective reconstruction, not 147
independent causal reproductions. Preserve that qualification in the record, not just the first memo.

### Minor — F7. Corrections did not remove stale assertions elsewhere

The record's §3.10 and §11 still say no paired task-outcome trial exists, contradicted by §14.
The §13 draft also retains a same-family-grader limitation that does not describe the actual GPT-agent /
Claude-grader run, although it is labelled a retained draft. Mark obsolete limitations explicitly.
The claim that pre-outcome task selection cannot create bias is too strong: it prevents selection
*using observed arm outcomes*, not unrepresentative task selection or sensitivity problems.

## 4. Census result and the ID attack

I found **no** repeated SCI ID with different name, arguments, call timestamp, call-entry ID,
result content, error flag or result timestamp. Every call has a matching result. Maximum multiplicity
is 33. This supports collapsing copied history rather than inventing independent executions.
One provider ID could theoretically be reused for an indistinguishable second execution; persisted
sessions cannot rule that out universally. There is no observed evidence that it happened here.

| Month | Distinct calls | Resolved | Unconfirmed | Errors |
|---|---:|---:|---:|---:|
| July | 105 | 47 (44.8%) | 39 (37.1%) | 19 (18.1%) |
| August | 866 | 287 (33.1%) | 429 (49.5%) | 150 (17.3%) |
| September | 176 | 49 (27.8%) | 20 (11.4%) | 107 (60.8%) |
| October | 350 | 88 (25.1%) | 37 (10.6%) | 225 (64.3%) |
| November | 13 | 0 | 1 | 12 |
| **Updated total** | **1,510** | **471 (31.2%)** | **526 (34.8%)** | **513 (34.0%)** |

Error-class counts also reproduce: E1 135, E2 74, E3 148, E4 152, MCP 4. Path-rejection messages
must be classified before the generic word “withheld”; otherwise those classes are misassigned.
These resolution labels reproduce producer flags, not independent semantic correctness judgements.

## 5. Historical R arm and pilot costs

Historical pi-extensions `81304a4595c7b32058337448f07835fe9d4ecaf2`, selected before pilot launch,
already runs `applyStandardStartupProfile` on `session_start`. Its `ALWAYS_ACTIVE_TOOLS` includes
SCI composites and `context_plan`, **not** `context_pack`. The pre-Stage-1 settings include both
context-packer and toolbox; the driver excludes toolbox in all arms. Removing SCI at Stage 1 does
not explain away the historical lazy activation of `context_pack`.

Raw first-turn input accounting, including cache reads:

| Task | N | S | R |
|---|---:|---:|---:|
| agent-kernel | 17,523 | 18,195 | 17,523 |
| dep-diet | 13,188 | 13,860 | 13,188 |
| dep-redteam | 13,783 (rerun) | 14,253 | 13,581 |
| german-tts-voice-lab | 13,771 | 14,443 | 13,771 |
| pult | 14,851 | 15,523 | 14,853 |
| workstation | 15,425 | 16,097 | 15,425 |

S is consistently 672 above the corresponding original native configuration; N/R agree in four
cases, with pult differing by two and dep-redteam's replacement by 202. Historical source plus these
observations strongly support M2. Tokens alone are not an active-schema receipt, and the installed
package bytes were not immutably captured; the literal historical tool set is therefore an inference.
Nothing here rescues a claim about Ripwire uptake. AK19633/19634 correctly void it; AK7952's old title
remains misleading but its retention was an operator choice recorded in the correction.

| Median per-task ratio | S/N | R/N |
|---|---:|---:|
| Total tokens | 1.1795 | 1.1983 |
| Non-cached tokens | 1.1103 | 1.0715 |
| Discovery-result proxy, author's classifier | 1.1036 | 1.2071 |
| Tool calls | 1.0825 | 1.0876 |
| Wall time | 1.1403 | 1.0401 |

I reproduced the author's discovery proxy after inspecting its definition. A broader substring
classifier gives S/N 1.1592, illustrating that this proxy is not tokenizer-measured acquisition cost.
The raw total-token ratios and reported table roundings hold. S had ten calls: five confirmed,
three unconfirmed, two errors. Existing automatic-grade logs pass two tasks and fail four in every
arm; I did not rerun those tests. The frozen/current task prompts are unchanged; only the allowed
setup/grade fields differ, and the retained driver hash matches AK18651.

“No success gain and no 20% context reduction” correctly leaves the preregistered verdict unchanged.
That is **did not overturn**, not a powered equivalence or retirement-confirmation result. The N/R
spread is useful descriptive variability, not a clean estimate of one stochastic noise parameter:
contexts, ordering, cache/load and the replacement job were not controlled identically.

## 6. Corrections checklist and claim verdicts

| First memo §10 item | Status after checking |
|---|---|
| Distinct calls / restated rates | Correct updated rates; snapshot pairing still wrong (F3) |
| July best period | Correct: 47/105 |
| July mixed interpretation | Corrected; add seeded-query condition (F5) |
| Repaired-SCI confidence | Changed to Medium; still too broad (F1) |
| “Confirmed” → “did not overturn” | Correct in headline, §14 and committed posture; stale missing-evidence text remains (F7) |
| “At its best” → offered fresh bindings / low dose | Correctly qualified in headline; S still named best-case arm |
| 22 novel pointers and definition-shaped rg | Included; read, not independently rerun here |
| July per-repo table and eligibility | Included and independently recomputed |
| File operations vs work / other-repo share | Included; outside-cwd sample not repeated here; future-design inference fails (F1) |
| As-run selection and pult exception | Included; no new selection reconstruction here |
| Remove explicit-Ripwire uptake claim | Correctly withdrawn; historical evidence supports withdrawal |
| AK7952 title | Not changed; append-only correction AK19634 records the operator's choice |
| Correct evidence 18684 | AK19633 exists and explicitly voids the `ripwire` premise |

The value rubric's “zero decisive” is a low-irreplaceability claim, not zero benefit. I did not
independently establish its labels, the rule-of-three bound's independence assumptions, or the
native-search counterfactual. Those results cannot establish that every correct SCI answer duplicates
one native call. Likewise, outside-cwd **file operations** are not a distribution of navigation needs.

## 7. Decision 191: four gaps, ownership, and disposition

1. **Stable identity:** rule 2 now forbids volatile filesystem identity and demands a recovery reason.
   This responds to the defect; it is a contract, not proof an implementation complies.
2. **Index removal authority:** rule 4 now requires that repo owner's exact task. It does not grant
   a foreign session permission to mutate a consumer. The earlier owner-boundary conflict is closed.
3. **Transition:** rule 3 explicitly preserves existing ignores until owner removal, couples guarded
   tests to that change, and assigns the template change to its owner. No workspace boundary conflict
   remains. The new clause is consistent with consumers avoiding permanent producer obligations.
4. **Verification owner:** rule 6 names producer tests and softwareco census. This closes the missing
   assignment, but the test is inadequate as written (F2). Assignment is not discriminating proof.

**Disposition: `revise_rfc`, not `reject_current_direction`.** Resolve F2 before calling the proposal
ready to accept. The operator alone decides whether to accept; this memo does not exercise that act.

## 8. Independence, preservation and next step

The author and first inspector were Claude-family; this parent is GPT-family. The pilot agents were
also GPT-family, so cross-family independence from the author is not independence from the subjects.
The clean grader was a separate OpenAI assistant context; its exact model ID was not available in
its permitted evidence. Dispatch `dispatch-1793599869493` returned its X/Y/Z assessment before the
parent opened the label key. It did not see prior verdicts or either inspection memo.

F1's confidence judgement, F2's executed counterexample, F3's snapshot reconciliation, F5's
seed-input interpretation and F6's restricted-era calculation are this parent's work. F4's detailed
packet assessment came from the clean grader, corroborated in part by the parent. Recommendation
and decision outcomes are this parent's responsibility, not delegated authority. A subsequent
challenge of the complete memo and derived outputs by the same subagent found no must-fixes;
it agreed with both dispositions and suggested the reproducibility/qualification improvements included here.

Only this memo is intended for the commit. Existing dirty source, posture, diaries and tests were
left untouched and unstaged. No original evidence, binding, decision record, first memo, proposal,
policy, hook or agent-instruction file was edited. No decision advance, ADR, push, deletion or
prohibited-repository inspection was performed.

G contains `extract.jq`, `extract.py`, `analyze.py`, `analysis.json`, `snapshot-delta.json`,
`pilot.jq`, `pilot.py`, `pilot-metrics-own.json`, `binding-attack.py`, `binding-attack.json`,
`mechanism.ts`, `mechanism-result.txt`, `july-seeds.json`, `july-recomputed.json`,
`rule6-counterexample.txt` and `rule6-commands.txt`. Added-call and binding-comparison rows retain
stable call IDs. Artifact hashes are retained in G's `SHA256SUMS` and referenced by the AK result.
Scratch is excluded from restic; these paths are evidence locations,
not a claim of durable backup. The numerical findings and discriminating counterexample are retained
in this memo and the AK result. Raw-session byte snapshots were not preserved by this inspection.

The requested documentation checks passed: `docs-list.mjs --docs docs/project --strict`,
`bash scripts/migration-hygiene.sh`, and `ak direction check -r "$PWD" -F json` (`ok: true`,
79 imported/parsed nodes, no issues). No source build, performance or e2e suite was run for this
memo-only change. Check logs are in G; these passes do not mean the inspected proposals passed.

**Next owner action:** revise the records against the required corrections, then obtain another
work-product inspection. Re-running a blind pilot is not necessary to fix these record defects;
I recommend requiring a task-representative, treatment-verified experiment for any future
repair/adoption claim.
