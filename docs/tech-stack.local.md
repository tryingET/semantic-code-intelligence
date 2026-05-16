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

# tech-stack.local (monorepo root)

Primary model:

- Monorepo root is a control plane for shared docs, CI, ontology, and governance.
- Package/app members define language-specific stack contracts inside their own folders.

Executable contract surface:

- root `docs/tech-stack.local.md` explains monorepo control-plane deltas
- package/app `policy/stack-lane.json` declares the upstream `tech-stack-core` lane reference when one exists
- package/app `docs/tech-stack.local.md` records local overrides

Practical rule:

- Use root commands for monorepo-wide validation.
- Use package/app local checks for language-specific validation.
- Use each package/app `policy/stack-lane.json` as the source of truth for the declared upstream lane command; root docs should not hardcode package lane commands.
