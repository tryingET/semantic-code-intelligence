---
summary: "Third inspection (AK8161) of the SCI retirement record and the tool-written-state proposal, by the session that corrected them: both ready_for_adr, with the limits of a self-check stated first."
read_when:
  - "You are deciding whether to accept AK decision 190 or 191."
  - "You need to know what the third inspection checked, and how far to trust it."
type: "review"
---

# Third inspection of the SCI retirement record

- **Task:** AK8161. **Decisions:** 190, 191. **Operator card:** evidence 19757.
- **Inspected:** the retirement record at `e1032a1d`; the proposal at softwareco `376b537`.
- **Inspector:** Claude Code session `9e04a635` (claude-opus-5-5), 2026-11-02.

## 1. Outcome and its limits

**Decision 190: `ready_for_adr`. Decision 191: `ready_for_adr`.** Whether to accept either one
remains the operator's decision.

**Read these limits first:**

- **This is a self-check.** I wrote the corrections I am inspecting. The operator chose this on a card,
  knowing that. I offered a fresh Pi session as the alternative.
- **No other reader has seen the final text.** The cross-family inspector saw `50a80202`. Everything
  after it (`95da09dd`, `e1032a1d`, proposal `376b537`) has been read only by me.
- **I share the author's LLM family.**
- **Each round has found something new.** The second inspector found errors in my corrections, and
  this inspection found errors that both earlier rounds missed. Expect more small ones.

`ready_for_adr` means the decision is ready to be taken, not that the record is free of error. It
rests on the claim that has held through three inspections and two LLM families: **retiring SCI as
deployed is justified.** It does not depend on the secondary claims still most likely to move.

## 2. Findings F1 to F7: verified in the text

| Finding | Status |
|---|---|
| F1 repaired-SCI forecast | Fixed. §1 says "not established" and "no demonstrated benefit justifies funding repair". §3.9 calls containment a property of this integration |
| F2 rule 6 false green | Fixed. See §5 |
| F3 mixed snapshots | Fixed. §2 gives 1,510 in 3,970 and 1,498 in 3,958, and names the re-read date |
| F4 "over-specified on wording" | Fixed, after this inspection caught a residual in §1 |
| F5 July seeded queries | Fixed. Confirmed against the seeds: each pi-extensions query carried an exact signature pattern |
| F6 reconstruction | Fixed, and strengthened: see §3 |
| F7 stale claims | Fixed in §3.10, §11 and §13 |

## 3. New evidence on the root cause

F6 said the original bindings could not be re-read. That followed from my handoff, which said they
were gone. The archive holds all 52 raw files, so I reran the test on them, on journal-dated eras
only (from 2026-09-30):

| Observation | Result |
|---|---:|
| E3, with a retained binding | 128 of 128 differ |
| Non-error, binding predates the call | 88 of 88 match |
| `realRoot` agrees with the archive path | 52 of 52 |

The second inspector's narrower cut, from October 1, gave 118 of 118 and 89 of 89. No counterexample
in either. It is still a retrospective reconstruction, as the record now says.

## 4. Found by this inspection, and fixed in `e1032a1d`

1. **"No miss was a navigation miss" was unsupported.** It came from the author, and both earlier
   rounds kept it. In three tasks the reference changed source files no arm edited: dep-redteam
   (`replacement_contract.py`, two schemas), workstation (three files) and pult (`fenster.ts`, a
   comment). All arms edited the same files as each other, so no arm gained by navigation. But
   shared misses may be navigation or requirement misses, and the data cannot separate them. SCI did
   not surface those files in S either. This also corrects my first memo's "no task stressed
   navigation".
2. **Stage 1 rollback was no longer one line.** AK7953 removed `SCI_MCP_COMMAND` and the runtime. The
   companion falls back to `semantic-code-mcp` on `PATH`, which is gone.
3. **The `08-17` weekly row was never restated**, so the table summed to 1,512. A mechanical check
   found it; neither inspector had.
4. **§1 still said "Correctness was identical"**, the wording F4 had ruled out.
5. Smaller stale lines: option F still recommended although the operator said "Not now"; bindings
   described as on disk after their deletion; a "3/4 repos" row in §2; a "no deletion" line in §8.

## 5. Decision 191

Rule 6 now names isolated Git configuration, the real write path, placement, the marker and the
index. I tested the check itself rather than the wording:

| Case | Result |
|---|---|
| In-tree state, no marker, hidden from ordinary status by a global ignore | fails |
| In-tree state with a compliant marker | passes |
| State out of tree | passes |
| State already in the index, with a clean `git status` | fails |

Rules 2, 3 and 4 hold as the second inspector found them. The census in rule 6 is stated as proposed,
not implemented. I did not re-inspect the "Effects" claims (lint breakage, the nine AK tasks).

## 6. What I re-ran and what I only read

- **Re-ran:** the era test on raw bindings; a mechanical check of the record's tables (monthly and
  weekly sums, error classes, percentages, each against my distinct-call data); the reference-versus-arm
  file comparison from all six packets; the companion's command fallback; rule 6 in four scratch
  repositories; the second inspector's false-green fixture and its 1,498 and 3,958 reconciliation.
- **Read, not re-run:** the cross-family inspection's other numbers, which agree with mine; §3.4–3.5
  beyond their arithmetic; the attention, code-size and ROCS rows.

The two earlier memos stand as history and were not edited. Where they differ from the record, the
record is current.

Scripts and hashes are in the session evidence directory `sci-review-9e04a635`, which restic excludes.
