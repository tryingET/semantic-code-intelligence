---
summary: "Fourth inspection (AK8278) of the SCI retirement: the first outside reading of the text the third inspection corrected (record after 50a80202, ADR-0008, proposal 376b537). Headline numbers re-derived from raw sessions with new code; no material finding; six minor corrections; decision 191 ready_for_adr."
read_when:
  - "You are deciding whether to accept AK decision 191, or reopening decision 190."
  - "You need to know what the final text of the SCI retirement record and ADR-0008 was checked against."
  - "You are correcting residual wording in the SCI retirement record, ADR-0008 or the tool-written-state proposal."
type: "review"
---

# Fourth inspection: the final text of the SCI retirement

- **Task:** AK8278. **Decisions:** 190 (accepted, ADR-0008), 191 (proposal). **Operator card:**
  evidence 20324, 2026-11-04.
- **Inspected:** the record at `b102f1cb` (changes since `50a80202`), ADR-0008 (`b102f1cb`), and
  softwareco `docs/project/2026-11-01-tool-written-state.md` at `376b537`.
- **Inspector:** Claude Code session `563f5084` (claude-opus-5-5), 2026-11-04.

## 1. Outcome and its limits

**No material finding.** Retiring SCI as deployed stands on re-derived numbers. Six minor
corrections and five observations follow; none changes decision 190 or blocks 191.

- **Decision 191: `ready_for_adr`.** Whether to accept it remains the operator's decision.
- **Decision 190:** already accepted. This memo is supporting evidence, not a new closure.

**Limits.**

- **Same LLM family.** I share the family of the author and of the first and third inspectors. My
  independence is of context only: I wrote none of the inspected text and started from a handoff
  that was two days stale.
- **Scope is the final text.** I did not re-grade the pilot, relabel the value sample, re-run the
  July ablation or re-measure the 46% outside-cwd share. Two earlier rounds, one of them GPT, did.
- I wrote new extraction and classification code and did not reuse earlier scripts.

## 2. What I re-ran

| Check | Result |
|---|---|
| Distinct SCI calls from raw Pi sessions, by file mtime since 2026-07-27, own extractor | **1,510 distinct** in 3,978 records (11-02: 3,970). The 8 new records are fork copies; no new distinct call. 9,919 files by mtime today, 639 hold a call |
| Outcome split, own rule fixed from result shapes before comparing (`isError`; resolved = `ok:true` or explore `status:confirmed`) | **471 / 526 / 513** (31.2 / 34.8 / 34.0%), exact |
| Monthly split (§3.1) | Exact: 105, 866, 176, 350, 13; every row matches to 0.1 point |
| Stage 1 effect | Last SCI call 2026-11-01 12:13Z, from a session started before Stage 1. None since |
| Mechanical table checks (§3.1, §3.2, §3.4, §3.5, §3.7) | All sums reconcile: weekly calls 1,510, E1 135, E2 74, E3 148, E4 152; each weekly row R+U+errors = 100%; 70 days; 29 of 44 days; 22 of 1,510 = 1.5%; rule of three 11.5% |
| Device pinning, own scratch repository, controlled simulation | See §3 |
| 52 archived raw bindings against today's `stat` (one reboot later) | 52 of 52 differ in device only; root and `.git` marker inodes match. Stored 57 ×25, 37 ×11, 50 ×10, 54 ×6; today 36 |
| Archive `~/.local/share/ai-society-retired/sci-ontology-2026-11-02/` | `sha256sum -c` OK; 7,459 files = 7,459 manifest lines; 59 directories. Restore not re-run |
| ADR rollback statement | Holds: `SCI_MCP_COMMAND` unset, nothing on `PATH`, packaged runtime gone, companion falls back to `semantic-code-mcp` (`pi-semantic-code-intelligence/src/mcp-bridge.ts:294`), `bin/semantic-code-mcp` present |
| Fleet `.ontology` census, depth 6 | See M1 |
| Rule 6 of proposal 191, eight fixture cases | See §4 |
| Proposal "Effects" | 61 census dirs = 59 repo roots + 2 worktree roots; the nine remediation tasks are all `.ontology` fixes; AK7861 confirms the dep-surgeon lint break |

**Read, not re-run:** the value-sample labels, the pilot grades and costs, the July ablation, the
outside-cwd share, the attention, code-size and ROCS rows.

## 3. Root cause: the simulation is fair once it controls the file

| Run (same binding, mode 600 unless stated) | Result |
|---|---|
| Fresh binding, device 36 | OK |
| `rootDevice` 36 → 54 | `workspace_binding_mismatch` |
| Restored | OK |
| Only the `.git` marker device 36 → 54 | `workspace_binding_mismatch` |
| All three device fields → 54 (a remount) | `workspace_binding_mismatch` |
| Reformatted only (same values) | OK |
| Mode 644 only | `workspace_binding_mismatch` |
| Restored, byte-identical, mode 600 | OK |

My first attempt left the file at mode 644 and failed even after the restore. The storage layer
rejects group or other permission bits (`src/core/workspace-binding-storage.ts:83`) under the **same
reason code**. So a fair simulation must hold mode, link count and size constant. The author's
"restored → OK" shows their edit did. With that control, and the 52 real bindings above, device
pinning is confirmed.

**New observation.** The reboot of 2026-11-02 21:38 kept `st_dev` at 36. A reboot does not always
change the device number (see M4).

## 4. Decision 191: rule 6 discriminates

| Case | `git status` | Index | Rule 6 as written |
|---|---|---|---|
| A. User config, in-tree state, no marker | clean | empty | — (the false green) |
| B. `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` only | **clean** | empty | — |
| C. B + empty `core.excludesFile` (`-c`, `=/dev/null`, or repo-local `""`) | shows state | empty | fails |
| E. C + marker `*` | clean | empty | passes |
| F. C + marker, state tracked | clean | holds state | fails |
| G. C + state hidden by `.git/info/exclude`, no marker | **clean** | empty | fails (no marker) |
| H. C + a consumer `.gitignore` line, no marker | clean for the state | empty | fails (no marker) |

Case B is why the empty `core.excludesFile` clause matters: Git reads `~/.config/git/ignore` by
default even when no config names it. Case G needs the marker condition: repo-local excludes are not
configuration. The guard test the transition clause cites (dep-redteam `tests/test_repo_ignores.py`)
isolates correctly and covers XDG and `info/exclude`.

Rules 2–4 were not re-inspected here beyond their facts: `5a28113` and the test exist as cited, and
`5d9935d` is the template commit.

## 5. Findings

### Minor (wording or completeness; correct when next touched)

- **M1. The census was depth-bounded.** Archived and deleted dirs came from
  `find ~/ai-society -maxdepth 5`. Still present below that depth:
  - one real SCI runtime dir, `softwareco/owned/.pi-candidates/obsidian-plugins-925b7ce0/ar-5622-candidate-01-1e6a78e7/.ontology`
    (9 files, newest 2026-10-01);
  - seven SCI test-residue dirs in this repo, `tests/fixtures/.ontology` (untracked) and six under
    `.test-results/`.

  None is newer than 2026-11-02. Suggested: record §15 and ADR "What landed" say "59 of the 60
  found at depth 5 or less"; ADR "Open" and AK7947 list the rest.
- **M2. "Every stage is executed" overstates.** This is the note on 190's `implementation_plan`
  artifact. §7 Stage 3 includes moving the 2026-09-05 work aside to quarantine, which has not
  happened: ADR "Open" says it has no owner decision. Suggested: "every stage executed except the
  quarantine of the 2026-09-05 work".
- **M3. §7 option table, row E-staged,** still says "reversible by one settings line", "data
  preserved" and "rollback is one line, data kept". §15 now says otherwise. This is the class of
  residual the third inspection fixed elsewhere.
- **M4. "After every reboot, SCI is dead"** (§3.8; ADR "failed after reboots"). The 11-02 reboot kept
  device 36. Suggested: "after a reboot that changes the device number".
- **M5. SCI-first guidance remains in this repo.** `AGENTS.md` §Dogfooding (lines 139–141) and
  "Dogfood Workflows (expected during changes)" (lines 229–233: "composite first") still expect it,
  as does `CLAUDE.md:44` ("Prefer SCI navigation"). ADR-0008 says the composite-first policy was
  removed. These are AGENTS/CLAUDE edits and need operator authority.
- **M6. The managed global ignore comment is stale.** dotfiles-managed
  `chezmoi/dot_config/git/ignore` lines 5–6 say the dirs "are kept until an owner-approved backup and
  quarantine". They were archived and deleted. Owner: dotfiles-managed.

### Observations (no correction needed)

- **O1.** `workspace_binding_mismatch` covers device, inode, path, boundary, mode, link count and
  size, without naming the field. A future identity check under proposal rule 2 ("names its reason")
  should name the field.
- **O2.** Rule 6 could name `.git/info/exclude` beside global configuration. Case G shows the marker
  condition already catches it.
- **O3.** The proposal's stage table omits AK8135. The removed SessionStart hook also wrote
  `.ontology` from Claude sessions in this repo. It omits AK7953 too. Completeness only.
- **O4.** AK7355 (a per-repo `.ontology` ignore line in pult) is still pending. It belongs to the
  approach the retirement superseded, and it was not in the superseded set. Owner decision.
- **O5.** The passport's `current_track => covered (runtime=pi_sdk)` is a track label: the closing
  memo for 190 and 191 was written in Claude Code. AK does not check the memo author's runtime. An
  earlier handoff cites decision 168 as a precedent; I did not verify who wrote its memo. Do not read
  the label as "a Pi-hosted inspection closed this".

## 6. Verdict per headline claim

| Claim | Verdict |
|---|---|
| 1,510 distinct calls; 31.2 / 34.8 / 34.0% | **Holds**, re-derived exactly from raw sessions |
| Since September about three in five calls errored | **Holds** (63.8%) |
| Stage 1 stopped SCI calls and new `.ontology` writes | **Holds** (no call after 11-01 12:13Z; nothing newer than 11-02 in the census) |
| Device pinning caused the NEXUS outage | **Holds** under a controlled simulation and 52 real bindings; reboots do not always drift (M4) |
| 59 dirs archived with checksum, then deleted; dep-surgeon kept | **Holds** for the depth-5 population; deeper dirs remain (M1) |
| ADR rollback path | **Holds** |
| 0 decisive calls; 22 of 1,510 new pointers | Arithmetic **holds**; labels read only |
| Pilot did not overturn retirement | Read only; earlier rounds re-graded |
| Repaired SCI not established | Read only; consistent with every measurement here |
| Proposal rule 6 discriminates; "Effects" facts | **Holds** (§4, §2) |

## 7. Reproduction

Scripts, raw outputs and `SHA256SUMS` are in the session scratch `sci-review-563f5084` under
`~/.local/state/pi-quests/tmp/`, which restic excludes. Evidence is on AK8278.
