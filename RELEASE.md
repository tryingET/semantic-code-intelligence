---
summary: "Release Checklist for the Semantic Code Intelligence repo."
read_when:
  - "You need RELEASE information for Semantic Code Intelligence."
  - "You are changing RELEASE.md or related behavior."
type: "reference"
---

# Release Checklist

This checklist describes how to build, tag, publish, and deploy a new release of Ontology‑LSP.

## 1) Versioning
- Update `package.json` version (semver).
- Commit with Conventional Commit message, e.g. `chore(release): vX.Y.Z`.

## 2) Build Artifacts (Local)
```bash
bun install
bun run build:all   # builds dist/lsp, dist/http, dist/mcp, dist/mcp-http, dist/cli

# Sanity-check
node -e "require('./dist/mcp/mcp.js'); console.log('mcp stdio ok')"
node -e "require('./dist/mcp-http/mcp-http.js'); console.log('mcp http ok')"
node -e "require('./dist/http/http.js'); console.log('http ok')"
```

## 3) Docker Image
```bash
# Build and tag
docker build -t semantic-code-intelligence:X.Y.Z .
docker tag semantic-code-intelligence:X.Y.Z semantic-code-intelligence:latest

# Push (GHCR example)
docker tag semantic-code-intelligence:X.Y.Z ghcr.io/<owner>/semantic-code-intelligence:X.Y.Z
docker tag semantic-code-intelligence:latest ghcr.io/<owner>/semantic-code-intelligence:latest
docker push ghcr.io/<owner>/semantic-code-intelligence:X.Y.Z
docker push ghcr.io/<owner>/semantic-code-intelligence:latest
```

## 4) Kubernetes Deploy
```bash
# Ensure env uses MCP_HTTP_PORT
rg -n "MCP_HTTP_PORT|mcpHTTP" k8s/

# Apply manifests
kubectl apply -f k8s/ -n semantic-code-intelligence
kubectl rollout status deployment/semantic-code-intelligence -n semantic-code-intelligence --timeout=300s

# Verify
kubectl get pods -n semantic-code-intelligence
kubectl port-forward -n semantic-code-intelligence svc/semantic-code-intelligence-http 7000:7000 &
kubectl port-forward -n semantic-code-intelligence svc/semantic-code-intelligence-mcp 7001:7001 &
curl -s http://localhost:7000/health | jq .
curl -s http://localhost:7001/health | jq .
```

## 5) Desktop Configs
- `.mcp.json` uses stdio: `bun run dist/mcp/mcp.js`
- `claude-desktop-config.json`:
  - `semantic-code-intelligence` stdio → `dist/mcp/mcp.js`
  - HTTP entry `semantic-code-mcpHTTP` → `dist/mcp-http/mcp-http.js`

## 6) GitHub Release
- Push tag `vX.Y.Z`
- Draft release notes (highlights, fixes, breaking changes)
- Attach release artifacts if needed (VSIX, etc.)

## 7) Post‑Release Validation
- `just start` and confirm all services are healthy.
- Run focused tests: `bun test tests/adapters.test.ts`, `bun test tests/consistency.test.ts`.
- Verify OpenAPI at `http://localhost:7000/openapi.json`.

