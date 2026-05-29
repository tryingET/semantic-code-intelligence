---
summary: "Local override notes for the monorepo root validation and package-management model."
read_when:
  - "Aligning monorepo-level tooling decisions with package-level stack lanes."
  - "Reconciling root validation behavior with per-package language/tool choices."
system4d:
  container: "Repo-local deltas on top of package-level stack guidance."
  compass: "Keep monorepo operations reproducible while packages retain explicit stack contracts."
  engine: "Use root validation contract -> use package-local checks -> validate before release/push."
  fog: "Root workspace ergonomics can be mistaken for package-level stack authority unless documented explicitly."
---

# engineering.local (monorepo root)

Primary model:

- Monorepo root is a control plane for shared docs, CI, ontology, and governance.
- Package/app members define language-specific stack contracts inside their own folders.

Executable contract surface:

- root `docs/engineering.local.md` explains monorepo control-plane deltas
- root `policy/engineering-lane.json` declares the upstream `engineering-core` lane, catalog, discipline, and template recognition for this repo
- package/app `policy/engineering-lane.json` declares the upstream `engineering-core` lane reference when one exists
- package/app `docs/engineering.local.md` records local overrides
- upstream catalog inspection commands:
  - `uv tool -n run --from ~/ai-society/core/engineering-core engineering-core catalog --pretty`
  - `uv tool -n run --from ~/ai-society/core/engineering-core engineering-core list-disciplines`
  - `uv tool -n run --from ~/ai-society/core/engineering-core engineering-core list-templates`

Practical rule:

- Use root commands for monorepo-wide validation.
- Use package/app local checks for language-specific validation.
- Use each package/app `policy/engineering-lane.json` as the source of truth for the declared upstream lane command; root docs should not hardcode package lane commands.
- Use `design-system` only for browser/workbench UI surfaces and generated visual/operator-facing affordances.

## Repo loop validation

Semantic Code Intelligence adopts `repo-loop-validation-v1` for harnessed-LLM and prompt-loop work. The machine-readable declaration lives in `policy/engineering-lane.json`.

- `loop-doctor`: `just loop-doctor` (non-failing git/Bun/Just/server-status diagnostics, exact dirty paths including untracked files, and AK task-scope snapshot checks through `scripts/loop-scope-check.ts`; clean trees do not require or validate a selected snapshot; set `LOOP_TASK_ID` or `AK_TASK_ID` when dirty paths and multiple snapshots exist; selected task ids may be `123` or `AK-123`)
- `loop-verify-fast`: `just loop-verify-fast` (declares the focused smoke-test slice and maps to `just test-smoke`)
- `loop-impact-plan`: `just loop-impact-plan` (lists exact changed files, emits `impact=bounded|expanded|wide`, and names `next=<command>` from the shared impact classifier)
- `loop-impact-run`: `just loop-impact-run` (uses the same classifier as `loop-impact-plan`, refuses wide-risk changes, and maps bounded/expanded work to the normal sliced/batched `just test` path)
- `loop-impact-wide`: `LOOP_WIDE_REASON="<why wide validation is accepted>" just loop-impact-wide` (requires explicit acceptance and maps to `just test-ci-like`)
- `loop-landing-check`: `just loop-landing-check` (runs the active task-scope guard over dirty paths when needed, blocks dirty trees without a scope snapshot or explicit selection, then names and runs the repo-declared `just alpha-mvp-check` gate)

These commands produce repo-local evidence for loop orchestration. They do not replace snapshot/overlay review, AK task/evidence/decision authority, release approval, or future production/workbench promotion authority. `loop-doctor` is diagnostic-only even when it reports `scope_check=pass`; `loop-impact-plan` is plan-only until the selected check is run.
