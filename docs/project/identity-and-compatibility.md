---
summary: "Identity and compatibility policy for Semantic Code Intelligence naming."
read_when:
  - "You are renaming, packaging, publishing, or documenting Semantic Code Intelligence."
  - "You need to decide whether ontology-lsp naming is compatibility or stale drift."
type: "reference"
---

# Identity and compatibility policy

## Canonical identity

Use **Semantic Code Intelligence** for the repo, product, container image, deployment surface, and new documentation.

Canonical repository:

```text
https://github.com/tryingET/semantic-code-intelligence
```

Canonical package/repo slug:

```text
semantic-code-intelligence
```

## Compatibility aliases intentionally retained

The historical **ontology-lsp** name may remain where changing it would break existing local users, scripts, or editor settings without a migration layer:

- CLI binary: `ontology-lsp`
- MCP binary: `ontology-mcp`
- config file: `.ontology-lsp-config.yaml`
- VS Code configuration keys: `ontologyLSP.*`
- internal environment variables that the current code reads, such as `ONTOLOGY_LSP_*`
- examples that explicitly demonstrate backward-compatible command aliases

When these names appear, document them as compatibility aliases rather than the product identity.

## Names that should not be introduced in new work

Do not introduce new canonical surfaces named `ontology-lsp`, `ontology_lsp`, `Ontology-LSP`, or `Ontology LSP` unless the change is explicitly a compatibility shim.

New deployment and packaging surfaces should use `semantic-code-intelligence`, including:

- Docker image names
- Kubernetes namespace, app labels, services, and deployment names
- GitHub repository URLs
- published documentation titles
- VS Code display name and repository metadata

## Migration heuristic

Before committing identity-related work, run:

```bash
just migration-hygiene
rg -n "Ontology-LSP|Ontology LSP|ontology-lsp|ontology_lsp|ontologyLSP" . --glob '!node_modules' --glob '!dist' --glob '!.git'
```

Classify every hit as either:

1. compatibility alias, or
2. stale identity drift to rename.
