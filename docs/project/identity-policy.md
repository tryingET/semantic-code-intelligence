---
summary: "Canonical naming policy for Semantic Code Intelligence during alpha."
read_when:
  - "You are renaming, packaging, publishing, or documenting Semantic Code Intelligence."
  - "You need to decide whether an pre-rename product name should remain."
type: "reference"
---

# Identity policy

## Canonical identity

Use **Semantic Code Intelligence** for the repo, product, package, command, container image, deployment surface, and documentation.

Canonical repository:

```text
https://github.com/tryingET/semantic-code-intelligence
```

Canonical slug:

```text
semantic-code-intelligence
```

## Alpha policy: no compatibility aliases

This repo is still alpha. Do **not** preserve pre-rename compatibility names.

Use these canonical surfaces instead:

- CLI binary: `semantic-code-intelligence`
- MCP binary: `semantic-code-mcp`
- config file: `.semantic-code-intelligence-config.yaml`
- ignore file: `.semantic-code-ignore`
- VS Code configuration keys: `semanticCodeIntelligence.*`
- environment variables:
  - `SEMANTIC_CODE_WORKSPACE`
  - `SEMANTIC_CODE_DB_PATH`
  - `SEMANTIC_CODE_INTELLIGENCE_HOST`
  - `SEMANTIC_CODE_INTELLIGENCE_PORT`

The word **ontology** may still appear only when describing the semantic/ontology layer itself, ontology storage, ontology concepts, or ontology graph behavior. It should not appear as the product, command, package, deployment, or extension identity.

## Migration hygiene

Before committing identity-related work, run:

```bash
just migration-hygiene
just migration-hygiene
```

The second command should return no matches.
