---
summary: "API Specification: Core ↔ Adapter Interface for the Semantic Code Intelligence repo."
read_when:
  - "You need API SPECIFICATION information for Semantic Code Intelligence."
  - "You are changing API_SPECIFICATION.md or related behavior."
type: "reference"
---

# API Specification: Core ↔ Adapter Interface

## Overview

This document defines the contract between the protocol-agnostic core and protocol adapters. All adapters MUST implement these interfaces to communicate with the core.

## Core API Interface

### CodeAnalyzer Class

The main entry point for all operations. Protocol adapters interact only with this class.

```typescript
// core/types/api.ts
export interface CodeAnalyzer {
  // Navigation
  findDefinition(params: FindDefinitionParams): Promise<FindDefinitionResult>
  findReferences(params: FindReferencesParams): Promise<FindReferencesResult>
  findImplementations(params: FindImplementationsParams): Promise<FindImplementationsResult>
  
  // Code Understanding
  getHover(params: HoverParams): Promise<HoverResult>
  getSignatureHelp(params: SignatureParams): Promise<SignatureResult>
  getCompletions(params: CompletionParams): Promise<CompletionResult>
  
  // Refactoring
  getRenameEdits(params: RenameParams): Promise<RenameResult>
  getCodeActions(params: CodeActionParams): Promise<CodeActionResult>
  executeCommand(params: CommandParams): Promise<CommandResult>
  
  // Analysis
  getDiagnostics(params: DiagnosticParams): Promise<DiagnosticResult>
  getSemanticTokens(params: SemanticTokenParams): Promise<SemanticTokenResult>
  getFoldingRanges(params: FoldingParams): Promise<FoldingResult>
  
  // Learning
  learnPattern(params: PatternParams): Promise<void>
  getPatterns(params: GetPatternsParams): Promise<PatternResult>
  provideFeedback(params: FeedbackParams): Promise<void>
  
  // Knowledge
  getConcepts(params: ConceptParams): Promise<ConceptResult>
  getRelationships(params: RelationshipParams): Promise<RelationshipResult>
  exportKnowledge(params: ExportParams): Promise<ExportResult>
}
```

## Request/Response Types

### Common Types

```typescript
// Shared across multiple operations
export interface Location {
  uri: string      // File URI
  line: number     // 0-based line number
  column: number   // 0-based column number
}

export interface Range {
  start: Location
  end: Location
}

export interface TextDocument {
  uri: string
  languageId: string
  version: number
  content: string
}

export interface WorkspaceContext {
  rootUri: string
  workspaceFolders?: string[]
  configuration?: Record<string, any>
}
```

### Navigation Types

```typescript
// Find Definition
export interface FindDefinitionParams {
  symbol: string
  location?: Location
  context?: WorkspaceContext
  includeDeclaration?: boolean
}

export interface FindDefinitionResult {
  definitions: Definition[]
  confidence: number  // 0-1 confidence score
  source: string[]    // Which layers contributed
}

export interface Definition {
  location: Location
  kind: SymbolKind
  name: string
  detail?: string
  documentation?: string
  confidence: number
}

// Find References
export interface FindReferencesParams {
  symbol: string
  location?: Location
  context?: WorkspaceContext
  includeDeclaration?: boolean
  includeWrites?: boolean
  includeReads?: boolean
}

export interface FindReferencesResult {
  references: Reference[]
  total: number
  truncated: boolean
}

export interface Reference {
  location: Location
  kind: ReferenceKind  // read, write, call, import, etc.
  preview: string      // Line of code with reference
  confidence: number
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26
}
```

### Refactoring Types

```typescript
export interface RenameParams {
  symbol: string
  newName: string
  location: Location
  context?: WorkspaceContext
}

export interface RenameResult {
  edits: WorkspaceEdit[]
  affectedFiles: string[]
  preview?: string
}

export interface WorkspaceEdit {
  uri: string
  edits: TextEdit[]
}

export interface TextEdit {
  range: Range
  newText: string
}
```

### Learning Types

```typescript
export interface Pattern {
  id: string
  name: string
  description: string
  template: string
  examples: Example[]
  confidence: number
  usageCount: number
  lastUsed: Date
  tags: string[]
}

export interface PatternParams {
  code: string
  action: PatternAction
  context?: WorkspaceContext
}

export enum PatternAction {
  Create = "create",
  Update = "update",
  Delete = "delete",
  Use = "use",
  Reject = "reject"
}

export interface FeedbackParams {
  operationId: string
  rating: FeedbackRating
  comment?: string
  suggestion?: string
}

export enum FeedbackRating {
  Positive = 1,
  Neutral = 0,
  Negative = -1
}
```

## Adapter Interface

Each adapter MUST implement this interface:

```typescript
// adapters/types/adapter.ts
export interface ProtocolAdapter {
  // Lifecycle
  initialize(config: AdapterConfig): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  
  // Configuration
  getCapabilities(): Capabilities
  configure(config: Record<string, any>): void
  
  // Health
  healthCheck(): Promise<HealthStatus>
  getMetrics(): Metrics
}

export interface AdapterConfig {
  core: CodeAnalyzer
  port?: number
  host?: string
  options?: Record<string, any>
}

export interface Capabilities {
  navigation: boolean
  refactoring: boolean
  completion: boolean
  diagnostics: boolean
  learning: boolean
  streaming?: boolean
  concurrent?: boolean
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy'
  uptime: number
  requestsHandled: number
  averageResponseTime: number
  errors: number
}
```

## MCP Adapter Specific

### MCP Tool Registration

```typescript
// adapters/mcp/types.ts
export interface MCPTool {
  name: string
  description: string
  inputSchema: JSONSchema
  outputSchema?: JSONSchema
  handler: (args: any) => Promise<any>
}

export interface MCPToolRegistry {
  registerTool(tool: MCPTool): void
  listTools(): MCPTool[]
  executeTool(name: string, args: any): Promise<any>
}
```

### MCP Translation

```typescript
export interface MCPTranslator {
  // Request translation
  translateRequest(mcpRequest: MCPRequest): CoreRequest
  
  // Response translation
  translateResponse(coreResponse: CoreResponse): MCPResponse
  
  // Error handling
  translateError(error: Error): MCPError
}

export interface MCPRequest {
  method: string
  params: any
  id?: string | number
}

export interface MCPResponse {
  content: MCPContent[]
  isError?: boolean
  metadata?: Record<string, any>
}

export interface MCPContent {
  type: 'text' | 'code' | 'image' | 'tool_use'
  text?: string
  language?: string
  mimeType?: string
  data?: any
}
```

## Error Handling

All errors MUST follow this structure:

```typescript
export class CoreError extends Error {
  code: ErrorCode
  details?: any
  recoverable: boolean
  
  constructor(code: ErrorCode, message: string, details?: any) {
    super(message)
    this.code = code
    this.details = details
    this.recoverable = isRecoverable(code)
  }
}

export enum ErrorCode {
  // Client errors (4xx equivalent)
  InvalidRequest = 'INVALID_REQUEST',
  NotFound = 'NOT_FOUND',
  Unauthorized = 'UNAUTHORIZED',
  RateLimited = 'RATE_LIMITED',
  
  // Server errors (5xx equivalent)
  InternalError = 'INTERNAL_ERROR',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',
  Timeout = 'TIMEOUT',
  
  // Domain errors
  PatternNotFound = 'PATTERN_NOT_FOUND',
  ConceptNotFound = 'CONCEPT_NOT_FOUND',
  InvalidSymbol = 'INVALID_SYMBOL',
  ParseError = 'PARSE_ERROR'
}
```

## Performance Requirements

### Response Time SLAs

| Operation | P50 | P95 | P99 | Max |
|-----------|-----|-----|-----|-----|
| findDefinition | 20ms | 50ms | 100ms | 500ms |
| findReferences | 50ms | 100ms | 200ms | 1000ms |
| getCompletions | 10ms | 30ms | 50ms | 200ms |
| getHover | 10ms | 20ms | 40ms | 100ms |
| getDiagnostics | 100ms | 500ms | 1000ms | 5000ms |

### Resource Limits

```typescript
export interface ResourceLimits {
  maxRequestSize: number       // 10MB default
  maxResponseSize: number      // 50MB default
  maxConcurrentRequests: number // 100 default
  requestTimeout: number        // 30s default
  cacheSize: number            // 1GB default
  memoryLimit: number          // 2GB default
}
```

## Versioning

The API follows semantic versioning:

```typescript
export interface Version {
  major: number  // Breaking changes
  minor: number  // New features, backwards compatible
  patch: number  // Bug fixes
  
  isCompatible(other: Version): boolean
}

// Version negotiation
export interface VersionNegotiation {
  clientVersion: Version
  serverVersion: Version
  negotiatedVersion: Version
  features: string[]  // Features available in negotiated version
}
```

## Example Usage

### MCP Adapter Implementation

```typescript
// adapters/mcp/index.ts
import { CodeAnalyzer } from '../../core/analyzer'
import { MCPTranslator } from './translator'
import { ProtocolAdapter } from '../types/adapter'

export class MCPAdapter implements ProtocolAdapter {
  private core: CodeAnalyzer
  private translator: MCPTranslator
  
  async initialize(config: AdapterConfig) {
    this.core = config.core
    this.translator = new MCPTranslator()
    
    // Register MCP tools
    this.registerTools()
  }
  
  private registerTools() {
    // Find definition tool
    this.registerTool({
      name: 'find_definition',
      description: 'Find where a symbol is defined',
      inputSchema: {
        type: 'object',
        properties: {
          symbol: { type: 'string' }
        }
      },
      handler: async (args) => {
        // Translate MCP args to core format
        const coreParams = this.translator.translateRequest({
          method: 'findDefinition',
          params: args
        })
        
        // Call core
        const result = await this.core.findDefinition(coreParams)
        
        // Translate back to MCP format
        return this.translator.translateResponse(result)
      }
    })
  }
}
```

### Core Implementation

```typescript
// core/analyzer.ts
export class CodeAnalyzer implements ICodeAnalyzer {
  async findDefinition(params: FindDefinitionParams): Promise<FindDefinitionResult> {
    // Check cache
    const cacheKey = `def:${params.symbol}:${params.location?.uri}`
    const cached = await this.cache.get(cacheKey)
    if (cached) return cached
    
    // Progressive enhancement through layers
    let result = await this.layers.search.findDefinition(params)
    
    if (result.confidence < 0.8) {
      result = await this.layers.ast.enhanceDefinition(result, params)
    }
    
    if (result.confidence < 0.9) {
      result = await this.layers.semantic.enhanceDefinition(result, params)
    }
    
    // Learn from this query
    await this.layers.patterns.recordQuery(params, result)
    
    // Cache result
    await this.cache.set(cacheKey, result, { ttl: 3600 })
    
    return result
  }
}
```

## Testing Requirements

### Unit Tests

Every method in the API MUST have:
- Happy path test
- Error handling test
- Edge case test
- Performance test

### Integration Tests

Each adapter MUST test:
- Translation accuracy
- Round-trip conversion
- Error propagation
- Performance under load

### Contract Tests

Validate that:
- All required methods are implemented
- Types match specification
- Errors follow standard format
- Performance meets SLAs

## Migration Guide

For existing implementations:

1. **Map existing functions** to new API methods
2. **Implement translation layer** for legacy formats
3. **Add deprecation warnings** for old methods
4. **Provide migration tools** for data conversion
5. **Run in parallel** during transition period

This specification ensures all adapters speak the same language when communicating with the core, enabling true protocol independence.
## HTTP Endpoints (Implemented)

The HTTP adapter exposes the following REST endpoints under `/api/v1`:

- POST `/definition` – Find definitions
- POST `/references` – Find references
- POST `/explore` – Aggregate definition + reference results
- POST `/rename` – Execute rename (supports `dryRun` flag)
- POST `/plan-rename` – Plan a rename (preview only; returns WorkspaceEdit and summary)
- POST `/apply-rename` – Apply a previously planned rename (or execute directly)
- POST `/symbol-map` – Build a targeted symbol map for a given identifier
- POST `/completions` – Get completions

Example: POST `/symbol-map`

Request
```
{
  "identifier": "parseFile",
  "file": "file:///workspace/src",
  "maxFiles": 10,
  "astOnly": true
}
```

Response
```
{
  "success": true,
  "data": {
    "identifier": "parseFile",
    "files": 3,
    "declarations": [ { "uri": "file:///...", "range": {"start": {"line": 1,"character":2}, "end": {...}}, "kind": "function", "name": "parseFile" } ],
    "references": [ { "uri": "file:///...", "range": {...}, "kind": "call", "name": "parseFile" } ],
    "imports": [],
    "exports": []
  }
}
```

Example: POST `/plan-rename`

Request
```
{
  "identifier": "parseFile",
  "newName": "parseSourceFile",
  "file": "file:///workspace"
}
```

Response
```
{
  "success": true,
  "data": {
    "changes": [ { "file": "file:///...", "edits": [ { "range": {"start": {"line":0,"character":10}, "end": {...}}, "newText": "parseSourceFile" } ] } ],
    "summary": { "filesAffected": 2, "totalEdits": 5 },
    "performance": { "layer1": 10, "layer2": 25, "total": 40 },
    "requestId": "...",
    "preview": true
  }
}
```

## MCP Tool Registry (Implemented)

MCP tools are derived from a universal registry (`src/core/tools/registry.ts`). Core tools include:

- `find_definition`, `find_references`, `explore_codebase`
- `build_symbol_map`, `plan_rename`, `apply_rename`, `rename_symbol` (compat)
- `get_completions`, `list_symbols`, `grep_content`, `list_files`
- `diagnostics`, `pattern_stats`, `knowledge_insights`, `cache_controls`
- `generate_tests` (stub)

### Wire Schema Version (New)

For ontology/graph JSON payload tools, responses include:

- `schemaVersion: 2`

Currently versioned (MCP + adapters): `find_definition`, `find_references`, `explore_codebase`, `build_symbol_map`, `plan_rename`, `apply_rename`, `rename_symbol`, `graph_expand`.

Layer 4 (Ontology / Semantic Graph) uses the Ullmann triangle explicitly:

- `Thing` (referent / code anchor) ↔ `Concept` (conceptualization) ↔ `Symbol` (notation)

## LSP Custom Methods (Implemented)

In addition to standard LSP methods, the LSP server handles:

- `ontology/getStatistics` – Result: `{ schemaVersion: 2, ontology, patterns }`
- `ontology/getConceptGraph` – Result: `{ schemaVersion: 2, nodes, edges }`
- `symbol/buildSymbolMap` – Params: `{ symbol: string, uri?: string, maxFiles?: number, astOnly?: boolean }`
  - Result: `{ schemaVersion: 2, identifier, files, declarations, references, imports, exports }`
- `refactor/planRename` – Params: `{ oldName: string, newName: string, uri?: string }`
  - Result: `{ schemaVersion: 2, changes: Record<uri, TextEdit[]>, summary: { filesAffected, totalEdits } }`
- `workspace/executeCommand` – Command: `ontology.explore`
  - Args[0]: `{ identifier: string, uri?: string, includeDeclaration?: boolean, maxResults?: number, precise?: boolean }`
  - Result: `{ schemaVersion: 2, symbol, contextUri, definitions, references, performance, diagnostics, timestamp }`

See also: `docs/adapter-error-shapes.md` for adapter error envelopes and edge‑case parity guidelines.
