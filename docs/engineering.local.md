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
