---
summary: "Adapter Architecture Implementation for the Semantic Code Intelligence repo."
read_when:
  - "You need ADAPTER ARCHITECTURE information for Semantic Code Intelligence."
  - "You are changing ADAPTER_ARCHITECTURE.md or related behavior."
type: "reference"
---

# Adapter Architecture Implementation

This document records the target boundary for the unified core architecture with light protocol adapters. It is a maintenance reference, not a claim that all adapters are currently as small as the original Phase 1 implementation.

## 🎯 Objective

Keep MCP, HTTP, CLI, and LSP adapters responsible for protocol shape, input normalization, error mapping, and response formatting. Application/workflow logic belongs in core/application modules that adapters can delegate to.

## 📁 Current Architecture Structure

```
src/adapters/
├── utils.ts              # Shared protocol conversion utilities
├── lsp-adapter.ts        # LSP protocol adapter
├── mcp-adapter.ts        # MCP protocol adapter and MCP response formatting
├── http-adapter.ts       # HTTP API adapter
├── cli-adapter.ts        # CLI interface adapter
└── index.ts              # Adapter exports

Core/application workflow services:
├── src/core/workflows/snapshot-patch-workflow.ts
│   # snapshot patch/check/apply workflows, artifact extraction,
│   # validation plans, safe_write orchestration, and recommendation payloads
├── src/core/workflows/structural-workflow.ts
│   # ast-grep structural search/patch orchestration and
│   # preview-first structural patch checks
├── src/core/workflows/graph-expand-workflow.ts
│   # graph expansion orchestration, SCIP/AST fallback shaping,
│   # and impact-summary evidence assembly
├── src/core/workflows/workspace-query-workflow.ts
│   # read/search/symbol/AST-query workspace operations and
│   # configured-snapshot path resolution
├── src/core/workflows/rename-workflow.ts
│   # rename/plan/apply payload shaping, safe rename
│   # planning-to-snapshot orchestration, diff staging, and checks
├── src/core/workflows/navigation-workflow.ts
│   # find-definition/find-references resolution, fallback scans,
│   # workspace containment filtering, and response payload shaping
├── src/core/workflows/symbol-workflow.ts
│   # workflow_explore_symbol, locate_confirm_definition, and
│   # execute_intent orchestration across workflow services
├── src/core/workflows/code-analysis-workflow.ts
│   # completions, build-symbol-map, generate-tests stub, and
│   # explore-codebase payload shaping and containment filtering
├── src/core/workflows/learning-workflow.ts
│   # Layer 5 pipeline listing/status/run/history and pattern-stats
│   # payload shaping
├── src/core/workflows/tool-workflow-router.ts
│   # protocol-neutral tool-name dispatch across workflow services;
│   # MCP/HTTP/CLI adapters should route through this core facade
├── src/core/tools/execution-policy.ts
│   # shared timeout/retry policy derivation from ToolRegistry metadata
├── src/mcp/tool-list.ts
│   # shared MCP tool-list formatting over ToolRegistry metadata
├── src/mcp/tool-result.ts
│   # MCP tool-call normalization, result-envelope formatting, and log redaction helpers
└── src/mcp/tool-workflow-runner.ts
    # MCP adapter bridge from analyzer readiness and validated core workflows
    # to MCP tool-result envelopes
```

## 🔧 Architecture Principles

### 1. Single Source of Truth
- **Unified Core Analyzer**: All analysis logic in `src/core/unified-analyzer.ts`
- **No Duplicate Logic**: Each adapter only handles protocol-specific concerns
- **Shared Utilities**: Common type conversions and mappings in `src/adapters/utils.ts`

### 2. Protocol Separation
Each adapter handles only its protocol concerns:

| **LSP Adapter** | **MCP Adapter** | **HTTP Adapter** | **CLI Adapter** |
|-----------------|-----------------|------------------|-----------------|
| LSP message format | MCP tool calls | REST endpoints | Command parsing |
| Text sync | Streamable HTTP transport | JSON responses | Pretty output |
| Capabilities | Tool registration | CORS handling | Terminal colors |
| Error codes | Tool call/response envelope | OpenAPI spec | Progress indicators |

### 3. Elimination of Duplicate Code

The important invariant is not a fixed line-count target. It is that protocol adapters do not own duplicate analysis or workflow orchestration logic.

When a tool workflow becomes reusable across MCP, HTTP `/api/v1/tools/call`, and CLI fallback, place it under `src/core/` and keep adapters as routing/formatting layers. Shared tool-name dispatch belongs in `ToolWorkflowRouter`; shared tool validation and execution policy metadata belongs in `ToolRegistry`; validation is enforced by `ToolExecutor`; timeout/retry policy derivation belongs in `src/core/tools/execution-policy.ts`; protocol adapters should not instantiate one another just to reach core workflows.

## 🚀 Implementation Details

### Shared Utilities (`utils.ts`)

Provides common functionality used by all adapters:

```typescript
// URI/Path conversion
export function pathToUri(filePath: string): string
export function uriToPath(uri: string): string

// Position/Range normalization  
export function normalizePosition(pos: any): Position
export function normalizeRange(range: any): Range

// Request builders
export function buildFindDefinitionRequest(params): FindDefinitionRequest
export function buildFindReferencesRequest(params): FindReferencesRequest

// Response converters
export function definitionToLspLocation(definition: Definition)
export function referenceToMcpResponse(reference: Reference)
export function formatDefinitionForCli(definition: Definition): string

// Error handling
export function handleAdapterError(error: any, protocol: string)
```

### LSP Adapter Integration

```typescript
// Old LSP server (600+ lines)
class SemanticCodeIntelligenceServer {
  // Embedded analysis logic
  // Duplicate ontology engine
  // Custom pattern learning
  // Manual result formatting
}

// New LSP server (~100 lines)  
class SimpleLSPServer {
  private lspAdapter: LSPAdapter;
  
  constructor() {
    this.lspAdapter = new LSPAdapter(coreAnalyzer);
  }
  
  onDefinition(params) {
    return this.lspAdapter.handleDefinition(params);
  }
}
```

### MCP Adapter Integration

```typescript
// Old MCP server - custom orchestration
class OntologyMCPServer {
  // Manual layer orchestration
  // Duplicate analysis code
  // Custom tool implementations
}

// New MCP server - pure protocol handling
class SimpleMCPServer {
  private mcpAdapter: MCPAdapter;
  
  async handleToolCall(name, args) {
    return this.mcpAdapter.handleToolCall(name, args);
  }
}
```

## ✅ Backward Compatibility Verification

All existing APIs continue to work unchanged:

### LSP Protocol Compatibility
- ✅ `textDocument/definition` → `LSPAdapter.handleDefinition()`
- ✅ `textDocument/references` → `LSPAdapter.handleReferences()`  
- ✅ `textDocument/rename` → `LSPAdapter.handleRename()`
- ✅ `textDocument/completion` → `LSPAdapter.handleCompletion()`

### LSP Custom Methods (Non-standard)
Custom methods are namespaced and keep standard LSP responses spec-clean.

- `workspace/executeCommand` with `command: "ontology.explore"`
  - `arguments[0]`: `{ identifier: string, uri?, includeDeclaration?, maxResults?, precise?, conceptual? }`
  - Result: core `exploreCodebase` output or `{ error: string }`
- `ontology/preciseDefinition`: `{ uri, position?, symbol?, maxResults? }` → `{ locations, count }`
- `ontology/preciseReferences`: `{ uri, position?, symbol?, maxResults?, includeDeclaration? }` → `{ locations, count }`
- `ontology/getStatistics`: `{}` → `{ schemaVersion, ontology, patterns }`
- `ontology/getConceptGraph`: `{ maxNodes?, maxEdges? }` → `{ schemaVersion, nodes, edges }`
- `symbol/buildSymbolMap`: `{ symbol, uri?, maxFiles?, astOnly? }` → `{ schemaVersion, identifier, files, declarations, references, imports, exports }`
- `refactor/planRename`: `{ uri?, oldName, newName }` → `{ schemaVersion, changes, summary }`
- `ontology/suggestRefactoring`: `{ uri, position }` → `[]` (stub)

### MCP Tool Compatibility  
- ✅ `find_definition` → `MCPAdapter.handleToolCall('find_definition')`
- ✅ `find_references` → `MCPAdapter.handleToolCall('find_references')`
- ✅ `rename_symbol` → `MCPAdapter.handleToolCall('rename_symbol')`
- ✅ `generate_tests` → `MCPAdapter.handleToolCall('generate_tests')`

### HTTP API Compatibility
- ✅ `POST /api/v1/definition` → `HTTPAdapter.handleFindDefinition()`
- ✅ `POST /api/v1/references` → `HTTPAdapter.handleFindReferences()`
- ✅ `POST /api/v1/rename` → `HTTPAdapter.handleRename()`
- ✅ `GET /api/v1/stats` → `HTTPAdapter.handleStats()`

### CLI Compatibility
- ✅ `semantic-code-intelligence find <symbol>` → `CLIAdapter.handleFind()`
- ✅ `semantic-code-intelligence references <symbol>` → `CLIAdapter.handleReferences()`
- ✅ `semantic-code-intelligence rename <old> <new>` → `CLIAdapter.handleRename()`
- ✅ `semantic-code-intelligence stats` → `CLIAdapter.handleStats()`

## 🎭 Protocol-Specific Features Preserved

### LSP Features
- Text document synchronization
- Incremental changes  
- Capability negotiation
- LSP error codes
- Hover and code lens (placeholders)

### MCP Features  
- Server-Sent Events transport
- MCP tool schema validation
- Resource and prompt providers (scaffolded)
- Streaming responses

### HTTP Features
- CORS support
- OpenAPI documentation endpoint
- RESTful error codes
- Content negotiation
- Health check endpoint

### CLI Features
- Colored terminal output
- Progress indicators
- Command argument validation
- Pretty-printed results
- Configuration management

## 📊 Performance Impact

Performance targets maintained through delegation:

| Operation | Target | Achieved via Adapter |
|-----------|--------|---------------------|
| Find Definition | <200ms | LSP/HTTP/CLI adapters add <5ms overhead |
| Find References | <500ms | MCP adapter JSON serialization <10ms |
| Rename | <1s | All adapters preserve core performance |
| Memory Usage | ~500MB | Adapters add <50MB overhead |

## 🔍 Current Boundary Checks

- **Protocol-only adapter work**: request parsing, response formatting, protocol errors, transport-specific logging, and MCP server-side JSON-RPC envelope preservation.
- **Core/application work**: tool-name dispatch, shared tool validation/execution policy derivation, snapshot creation, patch conversion, check execution, guarded apply, rollback/verification posture, validation-plan assembly, and check-recommendation payloads.
- **Current restored slices**: `src/core/workflows/snapshot-patch-workflow.ts` owns snapshot patch/check/apply workflows, artifact extraction, and safe-write/recommendation payloads; `src/core/workflows/structural-workflow.ts` owns ast-grep structural workflow orchestration; `src/core/workflows/graph-expand-workflow.ts` owns graph expansion/impact-summary orchestration; `src/core/workflows/workspace-query-workflow.ts` owns read/search/symbol/AST-query workspace operations; `src/core/workflows/rename-workflow.ts` owns rename/plan/apply payload shaping and safe rename planning-to-snapshot orchestration; `src/core/workflows/navigation-workflow.ts` owns find-definition/find-references resolution logic; `src/core/workflows/symbol-workflow.ts` owns symbol exploration/location and execute-intent orchestration; `src/core/workflows/code-analysis-workflow.ts` owns completion/build-symbol-map/generate-tests/explore-codebase payload shaping; `src/core/workflows/learning-workflow.ts` owns pipeline and pattern-stat payloads; `src/core/workflows/tool-workflow-router.ts` owns protocol-neutral tool dispatch used by MCP, HTTP, and CLI; HTTP and CLI servers reuse one router/executor per analyzer lifetime; `src/core/tools/execution-policy.ts` owns shared timeout/retry policy derivation from registry metadata; MCP servers call `MCPAdapter.handleValidatedToolCall(...)` when they need JSON-RPC validation errors instead of direct-call tool-result errors; `src/mcp/tool-list.ts` owns shared MCP tool-list formatting over registry metadata; `src/mcp/tool-result.ts` owns MCP tool-call normalization, result-envelope formatting, success detection, safe stringification, and log redaction helpers used across MCP adapter/server variants; and `src/mcp/tool-workflow-runner.ts` owns the MCP adapter bridge from analyzer readiness and validated core workflows to MCP tool-result envelopes.
- **Regression coverage**: direct service tests plus MCP/HTTP/CLI parity tests should protect workflow behavior while keeping the adapter boundary visible.

## 🛠 Integration Instructions

### Configuration

All adapters use the same core configuration:

```typescript
import { createDefaultCoreConfig, createCodeAnalyzer } from './src/core/index.js';

const config = createDefaultCoreConfig();
const analyzer = await createCodeAnalyzer({ ...config, workspaceRoot: '/path/to/workspace' });

// Use with any adapter
const lspAdapter = new LSPAdapter(analyzer);
const mcpAdapter = new MCPAdapter(analyzer);
const httpAdapter = new HTTPAdapter(analyzer);
const cliAdapter = new CLIAdapter(analyzer);
```

## 🎉 Success Criteria

- Adapters stay behavior-compatible while delegating application workflows to core services.
- Workflow services have direct tests that do not require MCP protocol objects.
- MCP/HTTP/CLI parity tests continue to pass for the Alpha MVP tool contract.
- New workflow logic is not added directly to `MCPAdapter` unless it is protocol-specific.

## 🚀 Next Steps

1. Continue extracting bounded workflow slices when adapter code starts owning application behavior.
2. Prefer shared core services before adding MCP-only workflow branches.
3. Keep Phase 2/productization work behind explicit direction instead of using adapter cleanup as scope expansion.

---

**The adapter architecture target is maintained through bounded extractions that keep protocol adapters light while preserving Alpha MVP behavior.**
