---
summary: "Historical GitHub workflows retired when SCI consolidated on the Alpha MVP gate."
read_when:
  - "You are investigating a retired CI, deployment, packaging, or release workflow."
type: "archive"
---

# Retired GitHub workflows

These files are historical references and are deliberately named `*.disabled.yaml` outside `.github/workflows/` so GitHub does not execute them.

They were retired because they duplicated the canonical Alpha gate, used conflicting runtime versions, exercised later-phase IDE/deployment surfaces, or could publish images/releases without current productization authority.

Retired definitions:

- `cd.yml.disabled.yaml`
- `ci-cd.yml.disabled.yaml`
- `ci.yml.disabled.yaml`
- `npm-publish.yml.disabled.yaml`
- `ontology-check.yml.disabled.yaml`
- `test.yml.disabled.yaml`

Current executable workflows:

- `.github/workflows/alpha-mvp.yml` — automatic Alpha contract and portable repository-integrity gate;
- `.github/workflows/security.yml` — scheduled/manual dependency and CodeQL review.

Do not reactivate a retired workflow by moving it back. Reintroducing package publication, image publication, deployment, VS Code packaging, or broad performance/E2E automation requires a current owner-approved product/release contract and a freshly reviewed workflow.
