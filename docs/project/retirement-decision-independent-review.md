---
summary: "Independent work-product inspection (AK7954) of the SCI retirement record and the tool-written-state proposal: the retirement verdict stands, four claims need correcting first, and both decisions come back as revise_rfc."
read_when:
  - "You are advancing AK decision 190 (SCI retirement) or 191 (tool-written state) past review_pending."
  - "You are citing the SCI usage, value, pilot or July ablation figures, and need the corrected values."
  - "You are planning the Ripwire paired pilot (AK7952) from the AK7925 result."
type: "review"
---

# Independent inspection of the SCI retirement record

- **Task:** AK7954. **Decisions:** 190 (retirement), 191 (tool-written state).
- **Inspected:** `retirement-from-agent-sessions-decision.md` at `16933d50`, and
  `softwareco/docs/project/2026-11-01-tool-written-state.md` at `64bb733`.
- **Inspector:** Claude Code session `9e04a635` (claude-opus-5-5), 2026-11-02.

## 1. Outcome

**Decision 190: `revise_rfc`. The retirement verdict stands. The record does not stand as written.**

No finding reverses the operator's decision to retire SCI from agent sessions. Four claims are
wrong or overstated and should be corrected before an ADR is built on them:

1. "3,958 real calls" is 1,510 distinct calls. The rest are fork-copied history.
2. The pilot's Ripwire arm never had `context_pack`, so "zero spontaneous uptake" measures nothing.
3. The July ablation is mixed evidence, not evidence in the same direction.
4. The pilot did not confirm retirement. It failed to overturn it, and it could not have done much else.

**Decision 191: `revise_rfc`.** It is close, with four specific gaps (§8).

**Independence.** My independence is of context, not of LLM: I am the same LLM family as the author
and as the six blinded graders. I had also read the record's headline ("8/12 in every arm") before
I re-graded. Treat my agreement as a second reading, not as independent confirmation.

## 2. What I re-ran and what I only read

| Check | Re-ran | Only read or taken as given |
|---|---|---|
| Fleet counts | New extractor over the same 9,427 raw session files, sharing no code with the author's | — |
| Outcome parse | New classifier: 3,958 of 3,958 agree. 50 stratified rows labelled by hand: 50 of 50 agree | My hand labels used extracted flags, plus full text for 12 ambiguous rows. This shows the parser reads the flags; it does not show the flags are semantically right |
| Value sample | 10 of 30 labelled blind. New search of all 471 distinct resolved calls. `rg` replay on today's trees | The other 20 labels |
| Outside cwd | New random sample of 1,200 sessions, plus all distinct operations | The author's method, which was not kept |
| Pilot validity | Hash chain, selection re-derived from git, active tool list probed per arm, costs recomputed from raw sessions | The grader prompt, which was not kept |
| Blinded grading | All six tasks re-graded with the key closed; grades hashed before opening it | — |
| Root cause | Own scratch repo, real post-reboot binding, 52 real bindings, every E3 record | — |
| Owner boundaries | Each commit's diff, settings against the backup, working-tree state | Evidence 18695's byte-identical claim at the time |
| July ablation | Per-repository results from the archived JSON, the preregistration, the independent inspection | I did not re-run the ablation |
| ROCS drift, AK attention counts, code size | — | Not re-run; not needed for the verdict |

## 3. Findings by severity

### Material

**M1. Fork copies were counted as real calls.** Forked Pi sessions copy their parent's history, so
one call appears in many files. The 3,958 records hold **1,510 distinct tool-call ids**; one call
appears 33 times, and every copy has identical text. The record's caveat says "several sampled
calls". In fact 62% of the population is copies. All tool calls are affected too: 650,163 distinct
of about 1.13 million records.

The direction survives, and errors look worse, not better:

| | Records (as stated) | Distinct calls |
|---|---:|---:|
| Calls | 3,958 | **1,510** |
| Resolved | 34.0% | **31.2%** |
| Unresolved | 38.3% | **34.8%** |
| Error | 27.7% | **34.0%** |
| July: calls, resolved, error | 876, 56.7%, 7.2% | **105, 44.8%, 18.1%** |
| August | 2,324, 29.1%, 23.9% | 866, 33.1%, 17.3% |
| September | 374, 20.3%, 62.8% | 176, 27.8%, 60.8% |
| October | 383, 25.1%, 63.4% | 350, 25.1%, 64.3% |
| E1 workspace errors | 439 | **135** |
| E3 handshake errors | 146 | 148 (nearly all distinct; includes calls made after the author's extraction) |
| E4 opaque errors | 237 | 152 |
| Tokens into context (`len/4`) | 3.6M | **0.94M** generated (forks re-send the rest) |
| Calls after a session's 100th | 82% | 68.5% |
| Nothing usable (errors + empty) | 54% | 60.6% |
| SCI calls per 1k tool calls | 3.8–11.6 | 1.5–3.0 |

Three consequences matter. The "best period, 57–63% resolved" in §1 of the record is largely a copy
artifact: distinct July calls resolve at about 45%. E1, the containment evidence, shrinks threefold,
and after dedup E4 and E3 are the largest error classes. Claims that use calls as the unit of
attention are overstated by about 2.6 times.

**M2. The Ripwire arm never had Ripwire.** §13 preregistered R as "N + `context_pack`". In fact
`context_pack` is registered but only becomes active through `toolbox`, and the driver excluded
`toolbox` in every arm. A probe that recorded Pi's active tools just before the first LLM call, with
the driver's exact exclusions, gave **identical active sets for N and R**, with `context_pack`
absent. The pilot's own data agrees: first-turn input tokens match to the token in four tasks, differ
by 2 in pult, and differ only for dep-redteam's rerun in another job. S sits exactly 672 tokens
above, as tool schemas should.

The probe reflects today's configuration; the token identity is from the pilot itself.

- **Void:** "explicit-only availability gives zero spontaneous uptake" (§14, evidence 18684). The
  title of AK7952 repeats this as an input for context-packer's owner.
- **Not affected:** the SCI rule, which compares S with N. S was exactly N plus
  `explore_symbol_impact` and `locate_confirm_definition`.
- **Improved, by accident:** R and N are pure replicates of one configuration, so their difference
  really is run-to-run noise. The author's noise argument is sounder than the author knew.

**M3. The July ablation is not "the same direction".** "Worse in 3 of 4 repos" is literally true and
selective. Against paths, SCI's structural precision moved −0.14, −0.075 and −0.065 in three repos
and **+0.70 in pi-extensions**, where it was perfect in all 10 cases. The four-repository macro is
**+0.105 in SCI's favour**. The record calls this "the one ineligible control repo", but
pi-extensions was ineligible for the *source-list* arm, on metadata coverage. That criterion has no
bearing on SCI. The record also omits that fusion, which orders by SCI first, was the best arm in
the eligible repos (+0.115 precision). Finally, the preregistration says the SCI grammar then emitted only `match`
evidence, so this arm tested match counts, not semantic capability. The study says little either way
about what SCI can do. It should not support "High" confidence as independent evidence.

**M4. The pilot could not confirm retirement.** The preregistered rule is correctly applied: S shows
no gain, so the verdict stands. But "confirmed", in §1, in the posture document and in the commit
body, overstates what happened:

- **Dose.** SCI was called 10 times across 6 runs, about 1.7 calls per run. All six runs used it.
  Results: 5 confirmed, 3 unconfirmed, 2 errors. That misses the record's own 80% bar, and it was
  supposed to be SCI at its best.
- **Sensitivity.** In all six tasks, all three arms edited the same source files. Two tasks have
  byte-identical source changes across arms. No task stressed navigation.
- **Automatic grade.** Four of six tasks fail in every arm, mostly on wording and on requirements the
  issue text did not carry, so the first primary outcome could not discriminate there.

Correct wording: "did not overturn". The verdict rests on the population data, not on this pilot.

### Moderate

**M5. §13 does not describe the pilot that ran.** The rule actually used is in evidence 18651 and
adds "≤2 per language family, fill by recency". Three of §13's four candidates were replaced. The
six tasks reproduce only if TS and JS count as one family and the fill may exceed the cap (three
Python tasks). In pult, a more recent qualifying commit (`1d29e3621d`) exists; no reason for skipping
it is recorded. **No bias follows:** candidates (02:25), manifest (02:35) and first arm (02:42) all
precede any outcome, and the hash chain holds. The rule was applied carefully rather than mechanically.

**M6. The frozen repo still boots.** `.claude/settings.json` runs `just start` on every Claude
session opened in this repository. Today that started `src/servers/mcp-http.ts` and wrote logs and
pid files into `.ontology/`. The record and the residue tasks do not cover it. It does not contradict
the Pi-scoped statement in the posture document, but it does contradict "frozen".

**M7. "The rubric found 0 decisive" needed a harder test.** U3 requires that "one native call would
not have given the same", which is close to unreachable for a lookup tool, and the sample was judged
from actions alone. I searched all 471 distinct resolved calls:

| Step | Calls |
|---|---:|
| Agent next touched a SCI-reported file it had not named | 96 (20%, matching 6 of 30 in the author's sample) |
| That file was already known earlier in the session | 74 |
| New to the session | 22 (4.7% of resolved, 1.5% of all distinct calls) |
| Definition-shaped `rg` on today's tree returns ≤3 files | 21 of 21 comparable (median 1) |
| ... and contains the file SCI pointed to | 14 of 21 |

So the conclusion **survives**: the record's "at most about 4%" bound holds, and "mostly confirmation"
holds. But plain `rg -w` is not "the same": it returned a median of 8 files, up to 149. Replaceability
was assumed in the sample; it is now measured, on today's trees, and it needs a definition-shaped
pattern. My 10 blind labels agreed with 8 of the author's; neither of us found a U3. Both
disagreements (S17, S19) were U1 against U2, so that split is soft.

### Minor

- "220 of 633 sessions never got a successful answer" counts sessions where every call *errored*.
  Never resolved: 323 of 637 (51%), or 271 of 455 sessions originating a call (60%). This also
  understates the problem.
- §2 "817 with SCI" is files matching a name; 637 hold a call.
- "Daily from 2026-09-19 to 11-01": E3 occurs on 29 of those 44 days.
- "`rg` covered every file SCI reported" rests on 4 rows; say so.
- "Several tasks with byte-identical source changes" is two.
- `PREREG-AMENDMENTS.md` is headed "all before any arm ran", but amendment 4 follows dep-redteam's
  arms. Its logic is sound and I accept it.
- **Not kept:** the producer of `sci-outcomes.json`, the 46% script, the generator of
  `pilot-candidates.tsv`, the grader prompt. The figures reproduce, but the steps are not on file.
- Card round 4 (task closures and residue) is missing from evidence 18700, which the handoff cites.
  It exists only in the author's session transcript, which is not authority. The answers there do
  authorize the closures.

## 4. Verdict per headline claim

| Claim | Verdict | Basis |
|---|---|---|
| 34.0 / 38.3 / 27.7 of 3,958 real calls | **Arithmetic exact; unit wrong** | 31.2 / 34.8 / 34.0 of 1,510 distinct calls |
| Since September about 63% errored | **Holds** | 60.8% and 64.3% on distinct calls |
| Value sample: 0 / 16 / 14 | **Holds, with the rubric caveat** | M7 |
| Device pinning is the root cause of E3 | **Holds, stronger than stated** | §5 |
| Companion hides the reason | **Holds** | `parseNexusHandshake`, `nexus-workspace.ts:107-111` |
| 46% of code operations fall outside cwd | **Holds** | §6 |
| July ablation: worse in 3 of 4 repos | **True but selective** | M3 |
| Correctness 8/12 in every arm | **Holds on the 0–2 scale** | §7 |
| S/N 1.18, inside noise | **Holds** | §7 |
| R made 0 calls, so explicit Ripwire gets no uptake | **Void** | M2 |
| The pilot confirmed the retirement | **Overstated** | M4 |
| Landed changes stayed inside their authority | **Holds** | §9 |

## 5. Root cause: the strongest part of the record

The record proved this by editing a file. Better evidence now exists, because two reboots on
2026-11-01 moved `/home` from device 54 to 36.

- **A real remount reproduces it.** In a private mount namespace (repository read-only, a writable
  copy of the state, so the author's evidence stayed unchanged), a binding minted before the reboots
  showed stored device 54, real device 36, same inode: `workspace_binding_mismatch`. Correcting only
  the device made the same call succeed. The author's simulation was a fair stand-in.
- **Own scratch repository:** fresh OK, edited device mismatched, restored OK, and plain CLI explore
  still worked on the drifted binding. All as the record says.
- **All 52 real bindings differ from today's `stat` in device fields only.** Paths and inodes match.
- **Devices cluster by boot:** 50, then 54, 57, 37, 54 again, now 36.
- **The rule predicts the records.** Of 148 distinct E3 errors, 147 sit on a drifted binding; the
  other is a since-deleted worktree. All 91 NEXUS successes on an existing binding had the matching
  device; the other 41 were first binds or have no binding on file. **No counterexample.** One caveat:
  the first era boundary comes from the first E3 itself, so that edge is partly circular. The later
  boundaries come from the boot journal.

One nuance for the record: because numbers recur, "dead until re-minted" is not strictly true. A
binding from device 54 could work again in a later boot that happens to draw 54.

## 6. Outside cwd

My own random 1,200 sessions give **47.3%** (10,032 of 21,197). All distinct operations give 49.9%.
62.3% of code-touching sessions go outside at least once (record: 63%). The figure does not overstate
the limit much: dropping writes, scratch scripts, tool homes and dependencies still leaves 45%.

Two qualifiers. These are file operations, not work, so "can serve at most about half of real code
work" should read "of code file operations". And worktrees are the largest share (47% of outside
operations), so a session launched in the worktree would have reached them. Counting only truly
other repositories, the outside share is about 26%. The containment limit is real, but part of it
is about where sessions start.

## 7. Pilot

**Sound:** the hash chain holds (`tasks.frozen.json` to `PREREG-SHA256SUMS`, `tasks.json` to evidence
18651, `driver.sh` unchanged). Frozen and amended manifests differ only in the setup and grade
commands of two tasks. Amendments 1–3 precede the first arm. Tests ran successfully in every arm of
the amended tasks. Grading packets contain no arm-revealing text. Run order has a small effect
(0.94, 1.05, 1.02).

**Blinded re-grade.** My 18 grades match all 18 verdicts. I hashed them before opening the key
(sha256 prefix `f95129e5`). The 0–2 scale hides two real differences, and neither favours SCI:

- **pult:** N is better. S and R delete a dedupe, so a lesson held in both records reads twice.
- **dep-redteam:** S ≥ N > R, on error ordering and wording.

"Correctness identical" holds on this scale. Native won the one clearly behavioural difference.

**"+18% tokens, inside noise" is fair.** R and N are the same configuration, and R/N ranges from 0.98
to 1.36 with a median of 1.20, so S/N of 1.18 is not distinguishable from nothing. The six ratios are
0.59 to 1.36; a bootstrap of the median gives 0.78 to 1.30. That interval includes a 20% reduction,
so the pilot cannot exclude one. Non-cached tokens give 1.11. The rule was met because S showed no
reduction, not because a reduction was ruled out. S was slower in 6 of 6 tasks (uncorrected p = 0.03,
one of ten comparisons), which I would not lean on.

## 8. Decision 191: readiness

The proposal is sound in direction, and its facts check out (60 directories today, plus the one
AK7510 quarantined). It is not ready to accept, for four reasons:

1. **"Keyed by repo identity" repeats the defect.** The SCI outage came from an identity keyed on
   `st_dev`. The rule must say that identity survives remounts and must not use volatile filesystem
   values.
2. **Rule 4 is too broad.** "Removing it from the index needs no decision" would let any session
   mutate another owner's repository. Limit it to the removal being a defect fix inside that owner's
   exact task.
3. **Rule 3 meets existing guards.** dep-redteam's per-repo line (`5a28113`) is enforced by
   `tests/test_repo_ignores.py`, which isolates global git config on purpose. Removing it means
   rewriting that test in the same change. `tpl-project-repo` (`5d9935d`, unpushed) now copies the
   same obligation by template, which is the mechanism the proposal condemns. The rule needs a
   transition clause for both.
4. **No owner verifies it.** No check or measuring point tells anyone when a tool breaks the rule.

## 9. Owner boundaries

Each commit touched only what its card authorized. `16933d50`: the record and one posture hunk.
`9c9ef5b`: `.gitignore` and three index removals, with the files still on disk. `64bb733`: one
document. `fca9745`: one file. The 2026-09-05 work in this repository is untouched and unstaged.

At Stage 1 the settings diff is exactly one line. Today's diff also shows model-list changes, written
later by someone else. No `.ontology` data moved through this work; the one directory missing since
the census was quarantined by its own task, AK7510.

Stage 1 worked: no SCI call appears in any session after the reboot on 2026-11-01 at 13:34 UTC,
through the time of this inspection.

## 10. Corrections for the record

| Where | Now | Suggested |
|---|---|---|
| §1, §2, §3 | "3,958 real calls" | "1,510 distinct calls (3,958 session records, including fork copies)", with §3.1–3.5 restated |
| §1 | "At its best period (late July, 57–63% resolved)" | "about 45% of 105 distinct calls" |
| §1 | "independent July ablation with the same direction" | "a mixed July ablation: −0.07 to −0.14 in three repos, +0.70 in a fourth, testing match counts" |
| §1 | "Medium-high that no repaired SCI would pay for itself" | "Medium": the pilot is thin and July is mixed. "High" for SCI as deployed stands |
| §1, §14, posture, cards | "confirmed" | "did not overturn" |
| §1 | "tested SCI at its best" | "offered SCI with fresh bindings; 10 calls, 5 confirmed" |
| §3.4 | "the agent already knows where the symbol lives" | Add the 22 pointers and the definition-shaped `rg` measurement |
| §3.6 | Table and "ineligible control" | Per-repository results, and why the criterion does not apply to SCI |
| §3.9 | "at most about half of real code work" | "of code file operations; about a quarter is truly another repository" |
| §13 | Draft rule | The rule as run, with the pult exception |
| §14 | "Explicit-only availability gives zero spontaneous uptake" | Remove. "`context_pack` was not active in R, which made R a replicate of N" |
| AK7952 title | "gives no uptake and no value signal" | Remove; keep only the noise estimate |
| Evidence 18684 | `ripwire` field | Add a correcting evidence record; evidence stays append-only |

## 11. Limits of this inspection

- I share the author's LLM family, and the graders'.
- `rg` replays ran on today's trees, and code has moved.
- The active-tool probe reflects today's Pi configuration; the pilot's own tokens corroborate it.
- The "not kept" items in §3 could not be inspected.
- The era-device table is inferred from bindings and the boot journal, and the journal starts on
  2026-09-30.
- I did not inspect the AK attention counts, code size or ROCS drift.

The review scripts, labels and hashes are in the session evidence directory `sci-review-9e04a635`,
named in the AK7954 evidence.
