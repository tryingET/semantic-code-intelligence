---
summary: "Decision record: Semantic Code Intelligence is retired from agent sessions in stages (operator decision cards 2026-11-01), with the usage, failure, value and paired-pilot evidence behind it."
read_when:
  - "You are deciding whether to use, repair, reinstall or extend SCI, or reviewing why it was retired."
  - "You need the measured value of SCI composites in real harnessed sessions, or the root cause of the NEXUS handshake failures."
type: "decision"
status: "operator decided E-staged retirement on 2026-11-01; paired pilot AK7925 did not overturn it; corrected after two inspections (both revise_rfc); inspection of this version pending"
review: "single author with several lenses; inspected in retirement-decision-independent-review.md (same LLM family) and retirement-reinspection-gpt-6-1-sol.md (GPT family); section 15 lists what changed"
---

# Should Semantic Code Intelligence exist?

## 1. Verdict

**Recommendation: retire SCI from agent sessions in reversible stages (option E-staged).** The
operator set the governance rule in §9 (option F) aside: "Not now". Code-context needs go to their
natural owners:
native `read`/`rg`/`grep` for names and references, the language's own compiler or type checker
for precise semantics, git worktrees plus repo validation for safe change, and context-packer +
Ripwire (explicit, behind its existing paired-pilot gate) for concept-level retrieval.

**Confidence.**

- **High** that SCI, as deployed, does not pay for itself. The evidence is population data on
  1,510 distinct real calls, a value sample and a measured counterfactual.
- **Not established** whether a repaired or redesigned SCI would pay for itself. No demonstrated
  benefit justifies funding repair on this evidence. What is known:
  - The six-week outage has one verified, fixable cause: device-number pinning (§3.8).
  - The other limits belong to this integration. Even healthy, SCI as deployed cannot reach the
    46% of code file operations that fall outside the session cwd (§3.9).
  - At its best period (late July, about 45% of 105 distinct calls resolved), the value sample
    still found no decisive call.
  - The paired pilot (§14, AK7925) offered SCI with fresh bindings and the session at the target
    root. The rubric score was 8/12 with and without SCI, and SCI cost a median 18% more tokens,
    within run-to-run variability. Its preregistered rule did not overturn retirement. The pilot is
    thin: 10 SCI calls, 5 confirmed, and every arm edited the same source files.
  - The pilot tested fresh bindings and a target-root session. It did not test a compiler-backed
    repair, several workspaces per session, out-of-tree state or hard navigation tasks.
  - The July ablation (§3.6) is mixed and conditional on seeded queries, so it adds little either
    way.

**What would change it:** a paired pilot on real tasks, same model and budget, in which a repaired
SCI resolves at least 80% of symbols and cuts median context-acquisition tokens by 20% or more at
equal correctness. The other route is a named task class where native tools plus the compiler
demonstrably fail, such as large cross-language renames. Neither exists today.

## 2. What was measured and how (all read-only; scripts and raw output in this directory)

| Measurement | Method | Result | Delta vs handoff |
|---|---|---|---|
| Pi sessions by file mtime since 2026-07-27 | `find ~/.pi/agent/sessions -newermt 2026-07-27` | 9,427 session files; 637 hold an SCI call; about 650,000 distinct tool calls in about 1.13M records; SCI timestamps begin 07-21, because selection uses file mtime | corrected |
| Every SCI call | `extract_sci_calls.py` → `sci-calls.jsonl`; dedup by tool-call id | 1,510 distinct calls (explore 1,220, locate 290) in 3,970 records, re-read 2026-11-02; the frozen 2026-11-01 extraction has 1,498 distinct in 3,958 records | corrected: forks copy history |
| Real resolution | parse `ok`/`status` inside non-error results, hand-checked | 31.2% resolved (records: 34.0%) | **new**: the error rate hid 35% "unconfirmed" non-errors |
| Failure classes | regex over error text | §3.2 | new |
| Language split | extension of the `file` argument | §3.3 | new |
| False negatives | for unresolved calls whose file still exists, does the file define the symbol today? | 157 of 376 distinct (42%) do | new |
| Value sample | 30 resolved calls, round-robin by cwd; rubric in `value-sample-judgements.md` | 0 decisive | new |
| rg counterfactual | `rg -l -w <symbol>` in the same cwd today, vs SCI's reported files | rg covered all SCI files in the 4 comparable rows | new |
| Token cost | `resultLen/4` of SCI results | §3.5 | new |
| Prior SCI ablation | archived context-packer v2 study, independently reviewed | mixed: worse than lexical paths in 3 repos, +0.700 in the fourth (§3.6) | **new to this analysis** |
| `.ontology` census | `find ~/ai-society -maxdepth 5 -name .ontology` + `git check-ignore` | 61 dirs, 193 MiB, 32 ignored, 28 unignored, 1 tracked; 49 written since 2026-10-01 | dep-viz now ignored |
| AK attention | `ak task list --all`, title match | 181 SCI-repo tasks (173 done) + 46 elsewhere; 19 open SCI-related | new |
| Code size | `git ls-files` line counts | SCI 68,938 src + 47,960 test lines, 434 commits since 2026-05-16 | tests new |
| Claude Code | `~/.claude/projects` since 2026-09-01 | 777 session files, ~93k tool calls, 0 SCI, no MCP servers | confirms |
| ROCS drift | shared clone tags; manifest refs | v0.4.7 (`768c580`) absent, last commit 2026-10-03; refs overwhelmingly `@main` (779 vs 3 with my glob) | direction confirmed; counts depend on glob |

**Caveats.**

- Session files include subagent and fork-peer sessions, and forks copy their parent's history.
  2,460 records are such copies in both snapshots (62%). The counts below are distinct tool-call
  ids from the 2026-11-02 re-read, not records and not independent tasks. They add 12 later calls to
  the frozen extraction, each a single record. The source files are not immutable snapshots.
- `rg` was run on today's trees, and some code has moved since the calls were made.
- Every usefulness judgement was made by one author from the recorded next actions alone.

## 3. L0 — Is SCI helpful? (value, not activity)

### 3.1 Outcomes over time

| Month | SCI calls | Resolved | Unresolved (no error) | Error | SCI calls per 1k Pi tool calls |
|---|---:|---:|---:|---:|---:|
| 2026-07 (late) | 105 | 44.8% | 37.1% | 18.1% | 2.1 |
| 2026-08 | 866 | 33.1% | 49.5% | 17.3% | 3.0 |
| 2026-09 | 176 | 27.8% | 11.4% | 60.8% | 1.5 |
| 2026-10 | 350 | 25.1% | 10.6% | 64.3% | 1.9 |
| **All** (with 13 in November) | **1,510** | **31.2%** | **34.8%** | **34.0%** | — |

- Of the unresolved results, 124 still carried some references; 402 carried nothing.
- In total, **61% of SCI calls returned nothing usable** (915: errors plus empty results).
- 271 of the 455 sessions that originated a call (60%) never got a resolved answer. In 220 session
  files every call errored.
- Quality is falling: since September, about three in five calls fail outright.

### 3.2 Failure classes (513 distinct errors)

| Class | Calls | Cause | Owner of the cause |
|---|---:|---|---|
| E1 workspace binding ("must stay within the workspace", `repo_relative_path_required`, identity changed) | 135 | session cwd ≠ the repo whose file is asked about; SCI binds one workspace per Pi session | design mismatch with multi-repo sessions |
| E2 path not found | 74 | agent passed a wrong or moved path | caller error, partly SCI path resolution |
| E4 opaque ("diagnostics … withheld") | 152 | error reason suppressed; AK5438 has been pending since September | SCI/companion |
| E3 NEXUS handshake "invalid reference contract" | 148 | not contract skew: the binding pins the btrfs device number, which changes across reboots (§3.8), and the companion masks the reason; on 29 of the 44 days from **2026-09-19 to 2026-11-01**, unfixed (AK7874 observed it) | SCI identity design + companion error handling |
| E5 MCP indeterminate | 4 | MCP failure | SCI |

On top of these errors, 526 calls returned `ok:false` / `unconfirmed` without being flagged as
errors. An agent counting `isError` sees about 66% success; the real resolution rate is 31%.

### 3.3 Resolution by language (the `file` argument's extension)

| Lang | Calls | Resolved |
|---|---:|---:|
| Python | 441 | 28.6% |
| TypeScript | 449 | 46.3% |
| Rust | 155 | 9.7% |
| Go | 110 | 24.5% |
| C++ (.cpp) | 41 | 4.9% |
| Dotted symbols (`Class.method`) | 27 | 0% |

For unresolved calls whose file still exists, 42% of those files define the symbol today. These
are probable false negatives. Even in TypeScript, SCI's own language, fewer than half of the calls
resolve.

### 3.4 Value sample (30 resolved calls, rubric fixed before judging)

- Labels: **0 decisive (U3)**, 16 useful but replaceable by one `read` or `rg` (U2), 14 unused
  or re-searched (U1).
- After collapsing correlated fork copies: 26 independent cases, with U3 0, U2 13 and U1 13.
- By the rule of three, the decisive rate among resolved calls is at most about 11.5% (95%),
  which is at most about 4% of all SCI calls. U3 requires that no single native call gives the
  same, which is close to unreachable for a lookup tool, so read this as "rarely irreplaceable".
- 94% of SCI calls pass a `file` argument. That file is not always the definition: across all 471
  distinct resolved calls, the agent next touched a SCI-reported file it had not named 96 times.
  In 74 of those the file was already known to the session; in 22 (1.5% of all calls) SCI's pointer
  was new. So definition lookup is mostly confirmation.
- For those 22, a definition-shaped `rg` on today's tree returned at most 3 files in 21 of 21
  comparable cases and contained SCI's file in 14. Plain `rg -w` returned a median of 8 files, up
  to 149, so "one `rg`" holds only with a definition-shaped pattern.
- 69% of SCI calls occur after a session's 100th tool call, and only 34 are among its first five.
  The "PREFERRED first call" guidance does not describe how SCI is actually used.
- In the 4 rows where today's `rg -l -w` could be compared, it covered every file SCI reported.

### 3.5 Counterfactual and total cost of ownership

- **Native equivalent of a U2 call:** one `read` (file known) or one `rg -n -w` (file unknown).
  That costs tens of milliseconds and a few hundred bytes. An SCI result costs ~930 ms (explore)
  and a median 3.2 kB, or 2.2 kB when unresolved.
- **Context tokens:** SCI generated about 0.94M tokens of results: 0.53M resolved, 0.40M unresolved
  and 0.02M errors. Forks re-send them (3.6M counting copies), and each later turn re-reads them
  (cached, but not free).
- **Fallback:** after an error, 84% of calls go to a native `read` or shell search within three
  calls (421 of 502). The native path is the real path either way.
- **Unused surface:** the preview, patch and rename half of the 20-tool contract went almost
  unused. In three months: `rename_safely` 0, `preview_patch_checks` 10, `safe_write` 9.
- **Code:** 68.9k source plus 48.0k test lines (SCI), 4.4k (Pi companion); 434 SCI commits in 5.5
  months; 53 SCI commits and 34 companion commits since 2026-08-01.
- **Attention:**
  - 181 AK tasks in the SCI repo and 46 more elsewhere name SCI or `.ontology`.
  - 19 of those are open: 7 SCI tasks, and the `.ontology` remediation tasks AK7355, AK7510,
    AK7890, AK7907 and AK6985.
  - At least 9 tasks across repos exist only because SCI writes state into source trees:
    AK5067, 5473, 7355, 7510, 7861, 7888, 7889, 7890, 7907.
- **Footprint:**
  - 61 repos carry `.ontology/` (193 MiB); 28 are unignored and the softwareco meta repo tracks a
    live SQLite db.
  - Pi runs SCI from the source checkout's `dist/` (built 2026-10-24) while that checkout has had
    uncommitted changes since 2026-09-05 (AK5438/5446 work in progress). The live runtime has no
    clean provenance.

### 3.6 Independent prior evidence (archived, independently reviewed, July 2026)

Context-packer's preregistered four-arm source-selection ablation (AK4173,
`pi-extensions/docs/archive/pi-context-packer/pre-ripwire/experiments/source-selection/2026-07-25-v2`)
used real SCI structural-evidence receipts as one arm. **The result is mixed.** SCI's structural
ranking was worse than a lexical path score in three repositories and much better in the fourth:

| Repository | Precision vs paths |
|---|---:|
| agent-scripts | −0.140 |
| engineering-core | −0.075 |
| dspx | −0.065 |
| pi-extensions | **+0.700** (perfect in all 10 cases) |
| Three-repo macro | −0.093 |
| Four-repo macro | +0.105 |

- The study excluded pi-extensions from the *source-list* population on metadata coverage. That
  criterion is about the source-list arm, not SCI, so it does not settle the SCI question.
- Fusion, which orders by SCI first, was the best arm in the eligible repos (+0.115 precision), only
  slightly above source-list alone (+0.107).
- The producer did seeded AST structural matching, and the consumer ranked on `match` counts and
  paths.
- In pi-extensions each case had `maxItems` 1 and one truth, and every structural query supplied an
  exact function signature and a package path. The paths arm got only the maintenance question. So
  +0.700 is a conditional top-one result, and how an agent would get those seeds is not priced.
- Cost: 69 s traced across 40 cases.

So the study says little either way about SCI's value, and it should not raise confidence in the
verdict. Context-packer then removed SCI (`f5c44dded`, 2026-09-07) and built Ripwire behind a
paired-pilot gate. **Option D (merge SCI into context-packer) has already been tried and reversed.**
The finding never reached SCI's own direction: SCI kept building (53 commits since August).

### 3.7 What changed when (operator request, 2026-11-01)

Weekly series on distinct calls. R = resolved, U = unresolved; error classes as §3.2.

| Week of | Calls | R% | U% | E1 | E2 | E3 | E4 | Change that week |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 07-20 | 15 | 67 | 27 | 0 | 1 | 0 | 0 | companion package recovered, read composites in toolbox (07-25) |
| 07-27 | 214 | 36 | 39 | 19 | 33 | 0 | 0 | first heavy cross-repo use; containment rule (in SCI since 2026-05) starts to bite |
| 08-03 | 336 | 36 | 43 | 35 | 32 | 0 | 0 | — |
| 08-10 | 173 | 28 | 64 | 6 | 8 | 0 | 0 | — |
| 08-17 | 82 | 34 | 51 | 2 | 0 | 0 | 10 | progressive/compact modes; "omit absolute workspace" (08-16) |
| 08-24 | 113 | 29 | 63 | 6 | 0 | 0 | 3 | companion "harden boundary recovery projection" (08-23): **E4 opaque errors begin**; 2.1.0-rc.1–3, five doors |
| 08-31 | 79 | 30 | 25 | 7 | 0 | 0 | 28 | **NEXUS v1 adopted** in SCI (08-31) and companion (09-01/09-02) |
| 09-07 | 92 | 36 | 13 | 12 | 0 | 0 | 35 | — |
| 09-14 | 26 | 15 | 4 | 3 | 0 | 14 | 4 | **E3 begins 09-19** (likely a reboot; the journal only reaches back to 09-29) |
| 09-21 | 10 | 20 | 10 | 2 | 0 | 3 | 2 | — |
| 09-28 | 173 | 35 | 9 | 13 | 0 | 39 | 44 | reboots 09-29 (twice) |
| 10-05 | 72 | 24 | 18 | 12 | 0 | 21 | 9 | — |
| 10-12 | 22 | 5 | 5 | 3 | 0 | 16 | 1 | reboot 10-12 |
| 10-19 | 74 | 12 | 9 | 13 | 0 | 34 | 11 | SCI repair commits for AK7573/7582 (10-24); dist rebuilt from a dirty tree |
| 10-26 | 29 | **0** | 3 | 2 | 0 | 21 | 5 | reboot 10-30 |

**How long it has been broken:**

- Error reasons have been withheld since 08-23. That is 70 days; AK5438 and AK5439 have been
  pending since 09-05.
- The NEXUS failure occurred on 29 of the 44 days from 09-19.
- From 10-26 to the end of use, 0 of 29 distinct calls resolved.

### 3.8 Root cause of the six-week NEXUS outage (verified)

- **The check.** `src/core/workspace-binding.ts` `validateBinding` (lines 325–338) requires the
  persisted `rootDevice` to equal the current `stat.dev` exactly.
- **Why the device number changes.** `/home` is a btrfs subvolume (`/dev/mapper/cryptroot[/@home]`).
  Its `st_dev` is an anonymous device number, which can change across mounts and reboots.
- **The evidence.**
  - Bindings minted on 09-05/06 in pi-extensions, workstation and agent-kernel record device 50.
  - Bindings minted on 10-02 record 57.
  - The device was 54 on 2026-11-01, and 36 after that day's two reboots. Devices cluster by boot:
    50, 54, 57, 37, 54 again, 36.
  - All 52 bindings checked on 2026-11-02, before they were archived, differed from that day's
    `stat` in device fields only; paths and inodes matched.
  - In eras with journal-dated boundaries (from 2026-09-30), on the 52 raw binding files kept in the
    archive: all 128 E3 errors on a retained binding had a different device, and all 88 non-error
    results whose binding predates the call had the same device.
  - That is a strong retrospective reconstruction, not 128 causal reproductions. Device labels come
    from bindings minted inside each era, not from a measurement at each call. The 19 earlier E3
    errors rest on a boundary partly chosen from the failures themselves.
  - The NEXUS failures cluster in exactly the old, heavily used repos: pi-extensions 47,
    workstation 33, agent-kernel 17.
  - The successes after 09-19 came from repos first bound after a reboot: mittelschule-stadeln,
    tpl-template-repo, test-capabilities.
- **Reproduced in an owned scratch repo** (`device-drift-repro/`):

  | Run | Binding | Result |
  |---|---|---|
  | Fresh binding | device 54 | handshake OK |
  | Stored device changed to 50 | simulated remount | `workspace_binding_mismatch`, with SCI's remediation "Start a fresh process in the intended repository workspace", which cannot help because the next process reads the same file |
  | Restored | device 54 | OK |

  The plain CLI `explore_symbol_impact` still worked on the drifted binding. The engine runs;
  the NEXUS identity gate blocks Pi. The AK7954 inspection then reproduced this on a binding that
  drifted through real reboots: stored 54, real 36, same inode, `workspace_binding_mismatch`.
  Correcting only the device made the same call succeed.
- **Why nobody saw it.** The Pi companion does not show the producer's reason. Its strict
  `parseNexusHandshake` sees an error payload without `workspace`/`snapshotRef` and reports "SCI
  NEXUS handshake returned an invalid reference contract".
- **The consequence.**
  - After every reboot, SCI is dead in every repo bound before that reboot, until someone deletes
    or re-mints the binding, or a later boot happens to draw the same device number.
  - SCI deliberately refuses to re-mint identity (AK5446).
  - The prior root-cause analysis listed this as "verify before relying"; it is now verified.

### 3.9 The containment limit (operator's "not allowed outside the current repo")

- **The design.** SCI binds one workspace per Pi session, keeps its state inside it, and refuses
  paths outside it.
- **Measured on 1,200 random Pi sessions since 07-27:**
  - **46% of code-file `read`/`edit`/`write` operations fall outside the session cwd** (14,935 of
    32,452).
  - 63% of the sessions that touch code do so at least once.
  - Where those outside operations land:

    | Location | Share |
    |---|---:|
    | The society's own worktrees and scratch (`~/.local/state`, per the AGENTS scratch rule) | 45% |
    | Other ai-society repos | 40% |
    | `/data` | 8% |
    | Elsewhere | 8% |

- **The consequence.** Even when healthy, SCI as deployed can serve at most about half of code file
  operations.
  The society's own isolation discipline (worktrees and scratch outside the repo) is the largest
  reason. Re-measured on distinct operations the share is 47–50%; dropping scratch, tool and
  dependency paths still leaves 45%. Worktrees are the largest part, and a session launched in the
  worktree could reach them. Counting only truly other repositories, the share is about 26%.
- **The known fixes each carry a cost, and none is tested.**
  - **Several explicitly selected workspaces per session.** This needs a redesign of SCI's
    containment model, though separately checked roots need not mean unrestricted file access.
  - **A launch at every target root.** This conflicts with how agents actually work mid-task.
- **This is a property of the current integration.** It limits SCI as deployed. It is not a ceiling
  on a future design, and these are file operations, not a distribution of navigation needs.

### 3.10 L0 answer

Measured, SCI is not helpful enough to justify its cost:

- It resolves under a third of requests, and its success rate is falling.
- Most of its correct answers duplicate what one native call gives.
- Its larger capabilities (preview, patch, rename) are unused.
- It creates a fleet-wide hygiene problem.

**Evidence limit:** the one paired trial (§14) is small, low-dose and did not stress navigation, so
the claim "SCI makes tasks worse or slower" is not established. The claim measured is "SCI's answers
rarely change what the agent does, and usually fail".

## 4. L1 — What does a frontier coding session need beyond read/grep, and who should own it?

| Need | Real? | Met natively? | Best owner |
|---|---|---|---|
| Find a definition by name | yes, constant | yes: `rg -n -w`, `read`; Claude Code does all its code work this way | native tools |
| References / impact set for a change | yes | mostly: `rg -w` (+ reading hits); the type checker or tests after the edit catch the rest | native + compiler (`tsc --noEmit`, `cargo check`, `pyright`/`mypy`, `go vet`) |
| Precise semantics (overloads, dynamic dispatch, re-exports) | rare, high stakes | the compiler/LSP is the only true oracle; heuristics sit in an uncanny middle | the language toolchain, on demand; a thin LSP tool only if a paired pilot shows benefit |
| Find code by concept when the name is unknown | yes | partly: grep plus exploration subagents | context-packer + Ripwire (28/30 top-10 vs 24/30 literal), explicit until its paired pilot passes |
| Safe preview / rollback of changes | yes | yes: git worktrees, `git diff`, repo validation | git + repo validation |
| Repository map / orientation | sometimes | AGENTS chain, docs-list, `ls`/`tree`, context_plan | existing owners |

**First principle:** a coding agent's navigation is bounded by the two cheapest oracles it already
has. Text search is fast, complete for names and noisy. The compiler is slow, but it is the truth.
A middle layer earns its place only if it beats text search on cost *and* comes near the compiler
on precision. SCI does neither: it is slower and larger than `rg`, and it has worse recall than
`rg` (false negatives) and worse precision than the compiler (unconfirmed results).

**Answer:** none of the real needs requires SCI. The one open question is whether automatic
concept retrieval (Ripwire `auto`) helps. That question already has an owner and a gate.

## 5. Many of the greats (Mode 1–3, condensed)

### Schools

1. **Unix minimalism (Thompson/Pike).** Small tools that compose; text is the universal
   interface. `rg` + `read` + the compiler already compose into navigation. A 117k-line layer must
   beat that composition, not merely exist. *Sees what others miss:* the frontier LLM is itself
   the integrator, so the glue SCI provides is the model's job.
2. **Semantic tooling (IDE/LSP tradition, Kythe-style code graphs).** Precise symbol graphs
   prevent wrong edits that text search cannot see (shadowing, overloads, re-exports). *Strongest
   case:* large refactors in big codebases. *Sees:* grep's silent misses on renames.
3. **Evidence-based adoption (Fisher/Deming; the context-packer gates).** No adoption without a
   preregistered comparison against the baseline on real tasks; activity is not benefit. *Sees:*
   SCI's 1,510 calls are partly instructed ("PREFERRED first call"), so usage is not demand.
4. **Lean / sunk cost (Ohno; Kahneman).** Inventory and work in progress are waste, and past
   investment is no reason to continue. *Sees:* 181 tasks of "hardening" are inventory with no
   delivered benefit, and every repair adds surface that drifts (E3 skew, E1 binding).
5. **Bitter lesson (Sutton).** General methods that scale with model capability beat hand-built
   structure. Each model generation reads and greps better; hand-built semantic layers age. *Sees:*
   Claude Code sessions do this work with no SCI at all.

### Confrontation

- **Semantic tooling vs Unix and the bitter lesson.** The clash is real for precise refactors. It
  resolves by *where precision comes from*: the compiler already supplies it, without a new
  substrate, and SCI's heuristic precision (31% resolution, 0% for dotted symbols) is below the
  bar School 2 itself sets. School 2 is right about the need and wrong about this tool.
- **Evidence-based vs lean.** Evidence-based says "run IW77 with a control arm before deciding";
  lean says "stop the waste now". Resolution: the population data already answers the go/no-go at
  a level a pilot would not overturn without a different, repaired SCI. A pilot has low value of
  information unless someone proposes a specific repaired design to test.
- **Irreducible residue.** Whether a future compiler-backed navigation tool (thin LSP) would help.
  That needs a hypothesis and a paired pilot, not SCI.

### Decision

**Contextual dominance.**

- Lean and evidence-based thinking decide the SCI verdict: retire, because measured benefit is
  near zero and cost is high.
- Unix and the bitter lesson decide the L1 architecture: native tools, the compiler, git, and
  Ripwire behind its gate.
- Semantic tooling keeps one door open: a compiler-backed tool may be proposed later, behind the
  §9 gate.

## 6. Five whys: "why does SCI exist and keep needing repair?"

1. **Why repair?** Calls fail on workspace binding, contract skew and opaque errors, and its state
   dirties repos.
2. **Why those failures?** SCI binds one workspace per session with in-tree identity state, while
   real sessions span repos, worktrees and lane roots. The producer and the Pi companion version
   separately behind a handshake. Each fix adds hardening surface, which in turn drifts.
3. **Why was it built this big before this was seen?** Its phases were gated on contract
   conformance (the Alpha MVP's 20 tools, multi-protocol parity, a production candidate). Agents
   can produce that evidence autonomously. Benefit against a native baseline was never a gate.
4. **Why did negative evidence not stop it?** IW77, SCI's own decision vehicle, measures
   compliance with a composite-first procedure: it has no control arm and no retire outcome. The
   July ablation's negative SCI result lived in another owner's repo, with no route to SCI's
   direction. "PREFERRED first call" guidance manufactured usage that looked like adoption.
5. **Root:** the portfolio has no benefit gate and no retirement path for substrates, and evidence
   does not cross owner boundaries. Building is cheap for agents; the cost lands on operator
   attention, other repos' hygiene and context tokens, which no gate prices.

## 7. Options and multi-order effects

| Option | 1st order | 2nd order | 3rd order |
|---|---|---|---|
| **A** keep as is | nothing changes | ~63% failure rate persists; `.ontology` keeps spreading (49 dirs written this month); repair tasks continue | operator attention and tokens keep flowing to an unproven substrate; sets the precedent that size and activity justify continuation |
| **B** freeze + IW77 with control arm and retire outcome | honest measurement | costs N paired real tasks; measures *current* SCI, which the population data already characterises | low value of information; likely ends in E after weeks of delay and more `.ontology` |
| **C** shrink to thin optional tool, out-of-tree state, no first-step guidance | less dirt, less instructed usage | still 117k lines to maintain; resolution quality unchanged; AK7907 relocation work needed | a smaller zombie: little use, ongoing cost, no kill criterion |
| **D** merge into context-packer behind the Ripwire gate | — | already tried and reversed (July ablation; `f5c44dded`) | would re-import a provider that measured worse than lexical ranking |
| **E-staged** retire from agent sessions (recommended) | new Pi sessions stop calling SCI and stop writing `.ontology`; reversible by one settings line | 9+ hygiene tasks collapse into one retirement plan; SCI repo frozen, data preserved; agents use native tools (as Claude Code already does) | frees operator attention; precedent that substrates can be retired on evidence; risk: losing a capability someone relies on (mitigated: rollback is one line, data kept) |
| **F** governance rule (§9) | applies to the next substrate | prevents the next SCI | changes how waves are framed: benefit hypothesis first |

**E-staged, concretely.** Each stage is a separate authority.

1. **Stop the bleeding (reversible).**
   - Remove `pi-semantic-code-intelligence` from `~/.pi/agent/settings.json` packages. This is
     operator-local Pi settings, not chezmoi-managed.
   - Keep the SCI repo, the installed runtime and all data.
   - Rollback: re-add the line. (No longer one line: see §15.)
   - Toolbox-discovery's `sci` entry then has nothing registered to activate, because it only
     activates registered tools.
2. **Hygiene for the existing state.**
   - Add `.ontology/` to the machine's global git excludes. dotfiles-managed already sets
     `excludesfile = ~/.config/git/ignore`, but the file does not exist; the owner is
     dotfiles-managed via chezmoi. SCI state is machine-local by construction (device and inode
     bindings), so a machine-local ignore matches its scope.
   - Untrack the softwareco meta repo's `ontology.db*` (AK6985).
   - Supersede AK7890 (per-repo sweep) and AK7907 (relocation of a retired tool's state).
3. **SCI repo posture.**
   - Mark the posture "retired from agent sessions (decision ref); repository frozen".
   - Close out the open SCI tasks with that reason; lifecycle closeout needs operator authority.
   - Move the uncommitted September work aside to quarantine and record it in AK (standing
     decision 2026-09-30); never delete it.
4. **Data retirement (later, separate decision).** Back up all 61 `.ontology` dirs (193 MiB) into
   one archive under owner policy, then quarantine. No deletion without that decision.

## 8. L2 — Ownership of tool-written state

The proposed fleet rule for tool-written state lives in one place, the softwareco-level document
`softwareco/docs/project/2026-11-01-tool-written-state.md`, and in its AK decision proposal. It
holds whatever the SCI verdict is. For SCI, the retirement discharges it:

- no new writes, since stage 1 removed the Pi package;
- a machine-level ignore for the legacy `.ontology/` state (stage 2a);
- the meta repo no longer tracks the db (stage 2b);
- an archive with a proven restore, then deletion on the operator's exception (§15).

## 9. L3 — Portfolio rule ("higher things")

**Evidence-backed observation:** the society can run rigorous benefit gates. Context-packer
preregisters, uses independent review, records REJECT outcomes, and refuses Ripwire promotion
without a paired pilot. SCI grew to 117k lines under contract-conformance gates alone, and a
negative result about SCI in another owner's study changed nothing in SCI.

**Proposed rule: "benefit before breadth".** Any substrate that agents are told to use (a tool,
provider, service or MCP server) must have:

1. **A benefit hypothesis against the native baseline**, falsifiable, with a kill criterion. It
   must pass a small paired pilot on real tasks before the substrate gets "preferred/first"
   guidance, a fleet install, or growth past a size budget (for example 10k lines).
2. **A state-ownership contract (§8)** before it writes anywhere outside its own repo.
3. **A retirement option** in every decision vehicle about it. A vehicle whose outcomes are all
   ways of continuing is not a decision.
4. **Cross-owner evidence routing.** A consumer's negative finding about a producer opens a
   decision gate in the producer's direction.
5. **Usage that is instructed is reported as instructed**, never as adoption.

**A still higher question.** This part is speculation, labelled as such, and is not measured here.

- SCI is a symptom of an operating pattern: agent labour is cheap, so the society builds
  infrastructure *for* agents and measures it *by* agents. The metrics are self-referential: tasks
  closed, receipts green, tools called.
- The question worth the operator's attention is which agent work produced outcomes the operator
  values, at what share of total effort. Long Pi sessions (thousands of tool calls), 181-task
  hardening programmes and governance about governance would all show up in such a measure.
- No owner currently produces that measure. A first, cheap version would sample N closed AK tasks
  per month and record whether the operator would have wanted each one.

## 10. Operator decisions needed (put on cards; each is separate)

1. **SCI verdict:** E-staged (recommended) / B / C / A.
2. **Paired pilot:** none for SCI (recommended); keep Ripwire's existing gate; or run a small
   with/without-SCI pilot first.
3. **Decision record lands in:** an AK decision plus this record committed to the SCI repo's
   `docs/project/` (recommended, since the record is about SCI's direction); a softwareco-level doc;
   or the AK decision only.
4. **AK7890 and AK7907:** supersede both by the retirement plan (recommended under E); rewrite
   AK7907 as producer-side if C; or proceed with AK7890.
5. **Tool-written-state AK decision (§8):** record it now / draft only / defer.
6. **ROCS drift follow-up:** one AK task for pinned-or-published inputs, a shared-clone freshness
   check and one consumer model (recommended), attached before AK5891 resumes; or defer.
7. **Execution authority per stage of E** (§7 stages 1–4), each separately.
8. **Portfolio rule (§9):** propose it as an AK decision draft / note only / not now.

## 11. Open items, missing evidence, single-author claims

- **Missing evidence:**
  - only one small paired task-outcome trial for SCI (§14);
  - no per-task token accounting (tool-result bytes are a proxy);
  - no operator-attention hours (tasks are a proxy).
- **Single-author judgements:** the U1/U2/U3 labels; the option analysis; the many-of-the-greats
  and the 5 whys. The July ablation is the only independently reviewed evidence used.
- **Correlated samples:** fork-peer sessions copy calls; the counts are distinct calls, not tasks.
- **Small stale text:** the toolbox-discovery catalog still lists SCI as a context-packer provider
  (`toolbox-catalog.ts:55`), although context-packer removed SCI on 2026-09-07. Owner:
  pi-extensions.
- **Not touched by this analysis:**
  - dep-surgeon, and the tasks AK7681, AK3409, AK7597 and AK7217;
  - the dep-surgeon `.ontology/`;
  - every repo's `.ontology` data;
  - the SCI repo's uncommitted work.

## 12. Reproduction

The scripts and raw outputs are kept in the analysing session's evidence directory, which is
referenced from AK7925 evidence 18651 and 18684. Raw session-derived data is not committed:

- `extract_sci_calls.py` → `sci-calls.jsonl`
- `analyze_sci_calls.py` → `sci-summary.json`, `sci-outcomes.json`
- `counterfactual_sample.py` → `value-sample.jsonl`
- `value-sample-judgements.md`
- `ontology-census.tsv`
- `ak-sci-tasks.tsv`
- `toolcall-counts.txt`

## 13. Pilot design (draft preregistration, kept as drafted)

**As run.** The frozen rule is in evidence 18651, not this draft: it adds "at most 2 per language
family, fill by recency" and takes the issue text from the AK title when the AK id has one commit,
otherwise from the commit subject. Three of the four candidates below were replaced. The six tasks
reproduce only if TS and JS count as one family and the fill may exceed the cap (three Python
tasks). In pult a more recent qualifying commit, `1d29e3621d`, was not used, and no reason is
recorded. All of this precedes any outcome, so selection could not use observed arm results. It
does not make the tasks representative.

**Question.** On real recent tasks, with the same model and budget, does adding SCI (at its best)
or Ripwire (context-packer) to native Pi tools change task success, context-acquisition tokens or
discovery calls?

**Arms.** All arms use the same Pi build, packages, model, thinking level and prompt; they differ
only by `--exclude-tools`:

| Arm | Code-context tools available |
|---|---|
| N (native) | `read`/`grep`/`bash`/`edit` + `context_plan`; SCI tools and `context_pack` excluded |
| S (SCI best case) | N + SCI composites; fresh clone, so a fresh binding, and session cwd = target root |
| R (Ripwire) | N + `context_pack` with Ripwire available (the model decides whether to call it; a non-call is an outcome, not an exclusion) |

**Tasks (selection rule fixed before any run).**

- **Rule:** per repo, the most recent AK-referenced `fix` commit since 2026-10-01 that touches at
  least one test file and at least one source file, changes at most 300 lines, and has tests that
  run offline in under 5 minutes.
- **Repos:** six, at least three languages.
- **Excluded:** dep-surgeon and test-capabilities, which other sessions own.
- **Candidates under this rule today:**

  | Repo | Language | Commit | AK task |
  |---|---|---|---|
  | pi-extensions | TS | `43e939ca2` | AK7580 |
  | agent-kernel | Rust | `1c0085b65` | AK6919 |
  | dspx | Python | `f9008ab58` | AK6938 |
  | ts-quality | TS | `c449e75f9` | AK6927 |

  Two more repos are to be found under the same rule before the run. No Go commit qualified.

**Replay.**

- Clone each repo (not `git worktree add`, which would write into the owner's `.git`) into
  `/data/ai-society-scratch` with `heavy-job`.
- Check out the fix commit's parent, and keep the commit's test changes aside for grading.
- Prompt with the AK task title and scope as the original agent saw them. Same prompt in every
  arm.

**Budget.** One run per arm per task (18 runs). Each run is capped at 30 minutes of wall time;
model and thinking level are fixed. At most three runs in parallel.

**Outcomes.**

- **Primary:**
  1. The fix commit's tests pass on the agent's result.
  2. A blinded grader, a subagent that sees the diff without the arm label, judges correctness
     against the original fix.
- **Secondary:**
  - total input and output tokens from Pi usage;
  - context-acquisition tokens, meaning tool-result bytes from read/search/SCI/`context_pack`;
  - discovery calls before the first edit;
  - wall time;
  - SCI and Ripwire invocations and errors.

**Decision rules (preregistered).**

- **SCI.** If arm S shows no success gain and no 20% context-token reduction against N, the retire
  verdict stands. A clear gain reopens the decision as "repair (device pinning, error surfacing)
  instead of retire".
- **Ripwire.** This pilot is evidence for context-packer's own gate, not promotion. Per
  `ripwire-evaluation.md`, "a small or inconclusive sample remains opt-in", and promotion also
  needs independent review and an explicit policy change.

**Limits.**

- n = 6 is indicative only: one run per cell, and model variance is not controlled.
- The grader is the same model family as the agents. (Draft. As run, the agents were GPT and the
  graders Claude; see §14.)
- The tasks come from repos the agents themselves wrote.

**Cost (estimate, not measured).**

- About 0.5–3M input tokens per run, mostly cache reads, on the Codex subscription that Pi uses.
- About 3–5 hours of wall time at three in parallel.
- Clones total a few GiB under `/data`.

## 14. Pilot result (AK7925, run 2026-11-01; evidence 18651 preregistration, 18684 result)

**Run facts.**

- 18 runs: 6 real fix replays × 3 arms, `openai-codex/gpt-6.1-sol`, thinking high, fresh scratch clones.
- One run, dep-redteam/N, hit a provider stream failure. It was rerun once under the preregistered
  infrastructure rule (amendment 4); the censored original is kept.
- Owner repos were unchanged before and after.
- Grading:
  - automatic: the fix commit's own tests, applied over the candidate tree;
  - blinded semantic: six Claude subagents, one per task, labels shuffled, key held separately.
    The agents were GPT models; the graders are the same model family as this analyst.

**Correctness (blinded grader, 0–2 per task):**

| Task | Native (N) | +SCI offered (S) | Replicate of N (R) |
|---|---:|---:|---:|
| agent-kernel (Rust) | 2 | 2 | 2 |
| dep-diet (JS) | 2 | 2 | 2 |
| dep-redteam (Py) | 1 | 1 | 1 |
| german-tts-voice-lab (Py) | 1 | 1 | 1 |
| pult (TS) | 1 | 1 | 1 |
| workstation (Py) | 1 | 1 | 1 |
| **Total (of 12)** | **8** | **8** | **8** |

- 8/12 is a reported rubric score, not evidence of equal behaviour.
- The recorded automatic grade shows agent-kernel and dep-diet passing in all arms and the other four
  failing in all arms. The tests were not re-run in the inspections.
- Those four failures mix test coupling, behaviour the issue text did not carry, and real defects.
  In pult, S and R delete a dedupe, so a lesson held in both records reads twice; all three arms
  omit the planning-export hint; all three suppress colleague rows more broadly than the reference;
  and one automatic failure is only a selector mismatch.
- All arms edited the same source files per task, so no arm gained or lost by navigation. Whether
  the shared misses were navigation or requirement misses cannot be told apart (see Limits).

**Cost, median ratio vs native over the six tasks:**

| | Total tokens | Discovery bytes | Tool calls | Wall time |
|---|---:|---:|---:|---:|
| S / N | 1.18 | 1.10 | 1.08 | 1.14 |
| R / N | 1.20 | 1.21 | 1.09 | 1.04 |

**Tool use.**

- **SCI (S):** 10 calls in 6 runs, 2 of them errors. Both errors were the opaque "diagnostics
  withheld" class, even with fresh bindings at the target root.
- **Ripwire (R):** `context_pack` was never active. It is reached only through `toolbox`, which
  the driver excluded in every arm, so N and R had identical active tools and first-turn tokens
  match. The literal historical tool set is an inference from the pilot-time code and those tokens,
  as no active-schema receipt exists. R is therefore a replicate of N, not a Ripwire arm. Its spread
  (R/N median 1.20, range 0.98–1.36) is descriptive run-to-run variability, since contexts, ordering
  and load were not controlled identically. S's +18% sits inside it.

**Preregistered rule outcome.** S shows no success gain and no ≥20% context-token reduction against
N, so **the retire verdict stands**.

**Ripwire.** This pilot measured nothing about Ripwire: the tool was not offered. Uptake, explicit
or automatic, remains unmeasured. Its only use to context-packer's owner is a rough spread figure.

**Limits.**

- n = 6, with one run per cell. A bootstrap of the S/N median gives 0.78–1.30, which includes a 20%
  reduction, so the pilot did not exclude one. The rule was met because S showed none.
- Low dose: 10 SCI calls in 6 runs, of which 5 confirmed, 3 unconfirmed and 2 errors.
- Navigation did not separate the arms: all 18 runs edited the same source files per task, and two
  tasks have byte-identical source changes across arms.
- In three tasks the reference also changed source files no arm edited: dep-redteam
  (`replacement_contract.py`, two schemas), workstation (three files) and pult (`fenster.ts`, a
  comment). SCI did not surface them in S either. Whether the issue text or the search caused those
  misses cannot be told from this data.
- Tasks were small: 1–8 minutes each.
- The grader family equals the analyst's.
- Four of six tasks fail their reference tests, for the mixed reasons above.
- These are fix-sized tasks; a large cross-repo refactor class was not sampled.
- On the 0–2 scale correctness is identical. Finer differences do not favour SCI: in pult, N keeps a
  dedupe that S and R delete; in dep-redteam, S ≥ N > R on error ordering.

## 15. Corrections after independent inspection

Two inspections, both `revise_rfc`, found that retiring SCI as deployed stands and that these
statements were wrong or overstated: `retirement-decision-independent-review.md` (AK7954, Claude
family) and `retirement-reinspection-gpt-6-1-sol.md` (GPT family). The second also found errors in the
first round's corrections. All are corrected above:

| Was | Now |
|---|---|
| 3,958 real calls | 1,510 distinct in 3,970 records, or 1,498 in the frozen 3,958; §3.1–3.7 restated |
| Best period 57–63% resolved | about 45% of 105 distinct calls |
| July ablation in the same direction | mixed, and conditional on seeded queries |
| The pilot confirmed retirement | it did not overturn retirement |
| Explicit Ripwire gets zero uptake | not measured: `context_pack` was not active in R |
| "Medium-high" that no repaired SCI would pay | not established; no demonstrated benefit justifies funding repair |
| Reference tests over-specified on wording | mixed: test coupling, omitted behaviour and real defects |
| 147 of 148 explained, no counterexample | journal-dated eras only, and a reconstruction |
| No miss was a navigation miss | not established: three tasks have reference files no arm edited |

**Stage 4 changed on 2026-11-02.** The operator chose archive-then-delete instead of quarantine, as a
stated exception to the 2026-09-30 never-delete decision (evidence 19617). 59 of the 60 remaining
`.ontology` directories (7,459 files) went into one checksummed archive under
`~/.local/share/ai-society-retired/`, the restore was proven, and the directories were deleted.
dep-surgeon's stays until its owner session releases it. All 52 bindings were already dead (§3.8), so
this costs the Stage 1 rollback nothing: a re-enabled SCI mints fresh bindings.

**Rollback changed on 2026-11-02.** AK7953 removed `SCI_MCP_COMMAND` and, on the operator's card, the
packaged runtime. The Pi companion falls back to `semantic-code-mcp` on `PATH`, which no longer exists.
So Stage 1 rollback now needs the settings line plus that export, pointing at a built source checkout,
or a reinstall.

The commit message of `16933d50` keeps the old wording; this section supersedes it. Figures not
restated (attention counts, code size, footprint) were not re-inspected.
