# Implementation Plan: Unified Core with MCP Adapter

## Executive Summary

We're building a protocol-agnostic core that serves all clients through thin adapters, starting with the MCP adapter for MCP-compatible IDEs/agents. This fixes the current duplicate implementation problem and establishes the foundation for the intelligent programming companion.

## Current State → Target State

### Current State (Problem)
```
src/                           mcp-ontology-server/
├── layers/                    ├── layers/
│   ├── claude-tools.ts        │   ├── claude-tools.ts  (DUPLICATE!)
│   ├── tree-sitter.ts         │   ├── tree-sitter.ts   (DUPLICATE!)
│   └── ontology.ts            │   └── ontology.ts      (DUPLICATE!)
```

### Target State (Solution)
```
core/
├── analyzer.ts               # Protocol-agnostic brain
├── layers/                   # SINGLE implementation
│   ├── search.ts            # Fast search (5ms)
│   ├── ast.ts               # AST analysis (50ms)
│   ├── semantic.ts          # Semantic graph (10ms)
│   ├── patterns.ts          # Pattern mining (10ms)
│   └── knowledge.ts         # Knowledge spreading (20ms)
├── services/
│   ├── cache.ts             # Shared caching
│   ├── database.ts          # Shared storage
│   └── learning.ts          # Pattern learning
│
adapters/
├── mcp/                     # MCP adapter for clients
│   ├── index.ts            # MCP server entry
│   ├── tools.ts            # Tool definitions
│   └── translator.ts       # MCP ↔ Core translation
├── lsp/                     # LSP for VS Code
├── http/                    # HTTP for Web/CLI
└── shared/                  # Shared adapter utilities
```

## Phase 1: Extract Unified Core (Week 1)

### Day 1-2: Create Core Structure
```bash
# Create new unified core
mkdir -p core/{layers,services,types}

# Move best implementation from either src/ or mcp-ontology-server/
# Prefer src/ as it's the working implementation
cp src/layers/* core/layers/
cp src/ontology/* core/services/
```

### Day 3-4: Create Core Analyzer
```typescript
// core/analyzer.ts
export class CodeAnalyzer {
  constructor(
    private layers: LayerStack,
    private cache: CacheService,
    private db: DatabaseService
  ) {}

  async findDefinition(params: FindDefinitionParams): Promise<Definition[]> {
    // Check cache first
    const cached = await this.cache.get(`def:${params.symbol}`)
    if (cached) return cached

    // Progressive enhancement through layers
    let result = await this.layers.search.find(params)
    result = await this.layers.ast.enhance(result)
    result = await this.layers.semantic.enhance(result)
    
    // Cache and return
    await this.cache.set(`def:${params.symbol}`, result)
    return result
  }

  async findReferences(params: FindReferencesParams): Promise<Reference[]> {
    // Similar pattern for all operations
  }

  async learnPattern(pattern: Pattern): Promise<void> {
    await this.layers.patterns.learn(pattern)
    await this.layers.knowledge.propagate(pattern)
  }
}
```

### Day 5: Unify Shared Services
```typescript
// core/services/cache.ts
export class CacheService {
  private redis: Redis
  private localCache: Map<string, CacheEntry>

  async get(key: string): Promise<any> {
    // Try local first, then Redis
    const local = this.localCache.get(key)
    if (local && !this.isExpired(local)) return local.value
    
    const remote = await this.redis.get(key)
    if (remote) {
      this.localCache.set(key, { value: remote, timestamp: Date.now() })
      return remote
    }
    
    return null
  }
}
```

## Phase 2: Build MCP Adapter (Week 1)

### Day 1: MCP Server Setup
```typescript
// adapters/mcp/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CodeAnalyzer } from "../../core/analyzer.js"
import { MCPTranslator } from "./translator.js"

export class MCPAdapter {
  private server: Server
  private analyzer: CodeAnalyzer
  private translator: MCPTranslator

  constructor() {
    this.analyzer = new CodeAnalyzer(/* inject dependencies */)
    this.translator = new MCPTranslator()
    this.setupServer()
  }

  private setupServer() {
    this.server = new Server({
      name: "ontology-lsp",
      version: "2.0.0"
    })

    // Register tools
    this.server.setRequestHandler("tools/list", this.listTools.bind(this))
    this.server.setRequestHandler("tools/call", this.callTool.bind(this))
  }

  async callTool(request: ToolCallRequest): Promise<ToolCallResponse> {
    // Translate MCP request to core format
    const coreRequest = this.translator.fromMCP(request)
    
    // Call core analyzer
    const coreResponse = await this.analyzer[request.name](coreRequest)
    
    // Translate core response to MCP format
    return this.translator.toMCP(coreResponse)
  }
}
```

### Day 2: Tool Definitions
```typescript
// adapters/mcp/tools.ts
export const MCP_TOOLS = [
  {
    name: "find_definition",
    description: "Find where a symbol is defined",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to find" },
        file: { type: "string", description: "Current file context" }
      },
      required: ["symbol"]
    }
  },
  {
    name: "find_references",
    description: "Find all references to a symbol",
    inputSchema: {
      type: "object",
      properties: {
        symbol: { type: "string", description: "Symbol to find references for" },
        includeDeclaration: { type: "boolean", default: false }
      },
      required: ["symbol"]
    }
  },
  // ... other tools
]
```

### Day 3: Translation Layer
```typescript
// adapters/mcp/translator.ts
export class MCPTranslator {
  fromMCP(request: MCPRequest): CoreRequest {
    // Handle different request types
    switch (request.tool) {
      case 'find_definition':
        return {
          symbol: request.arguments.symbol,
          context: {
            file: request.arguments.file,
            position: request.arguments.position
          }
        }
      // ... other cases
    }
  }

  toMCP(response: CoreResponse): MCPResponse {
    // Format core response for MCP
    return {
      content: [{
        type: "text",
        text: typeof response === "string" 
          ? response 
          : JSON.stringify(response, null, 2)
      }]
    }
  }
}
```

## Phase 3: Testing & Validation (Week 2)

### Day 1-2: Unit Tests
```typescript
// test/core/analyzer.test.ts
describe('CodeAnalyzer', () => {
  test('finds definitions using cache when available', async () => {
    const cache = new MockCache()
    cache.set('def:testSymbol', mockDefinition)
    
    const analyzer = new CodeAnalyzer({ cache })
    const result = await analyzer.findDefinition({ symbol: 'testSymbol' })
    
    expect(result).toEqual(mockDefinition)
    expect(cache.hitCount).toBe(1)
  })
})
```

### Day 3-4: Integration Tests
```typescript
// test/adapters/mcp.test.ts
describe('MCP Adapter', () => {
  test('translates MCP requests to core and back', async () => {
    const adapter = new MCPAdapter()
    
    const mcpRequest = {
      tool: 'find_definition',
      arguments: { symbol: 'TestClass' }
    }
    
    const response = await adapter.callTool(mcpRequest)
    
    expect(response.content[0].type).toBe('text')
    expect(JSON.parse(response.content[0].text)).toHaveProperty('definitions')
  })
})
```

### Day 5: End-to-End Testing
```bash
# Start the MCP server
just start-mcp

# Test with an MCP client simulator
just test-mcp-e2e

# Manual test with an MCP-compatible client
# 1. Configure Claude Desktop
# 2. Ask Claude to find definitions
# 3. Verify responses
```

## Phase 4: Migration & Deployment (Week 2)

### Day 1: Data Migration
```typescript
// scripts/migrate-to-unified.ts
async function migrate() {
  // 1. Backup existing data
  await backup('.ontology/ontology.db', '.ontology/backup/')
  
  // 2. Migrate database schema if needed
  await migrateSchema()
  
  // 3. Import existing patterns and concepts
  await importExistingData()
  
  console.log('✅ Migration complete')
}
```

### Day 2: Parallel Running
```bash
# Run both old and new systems in parallel
just start-legacy  # Port 7000-7002
just start-unified # Port 8000-8002

# Compare responses
just compare-systems
```

### Day 3: Gradual Rollout
```typescript
// config/rollout.ts
export const ROLLOUT_CONFIG = {
  // Start with 10% traffic to new system
  trafficPercentage: 10,
  
  // Gradually increase
  schedule: [
    { day: 1, percentage: 10 },
    { day: 3, percentage: 25 },
    { day: 5, percentage: 50 },
    { day: 7, percentage: 100 }
  ]
}
```

### Day 4-5: Full Migration
```bash
# Switch all traffic to unified system
just switch-to-unified

# Deprecate old system
just deprecate-legacy

# Clean up duplicate code
just cleanup-duplicates
```

## Success Criteria

### Week 1 Deliverables
✅ Unified core with single layer implementation
✅ MCP adapter connecting to core
✅ All MCP tools working with MCP clients
✅ Tests passing for core and adapter

### Week 2 Deliverables
✅ Data migrated from old system
✅ Performance metrics meeting targets
✅ Zero regression in functionality
✅ Documentation complete

### Performance Targets
- Response time: <100ms for 95% of requests
- Memory usage: <500MB baseline
- Cache hit rate: >80%
- Zero data loss during migration

## Risk Mitigation

### Risk 1: Breaking Existing Functionality
**Mitigation**: Run systems in parallel, gradual rollout, comprehensive testing

### Risk 2: Performance Degradation
**Mitigation**: Performance benchmarks, caching strategy, profiling

### Risk 3: Data Loss
**Mitigation**: Comprehensive backups, reversible migrations, data validation

### Risk 4: MCP Client Compatibility
**Mitigation**: Early testing with Claude Desktop, maintain backwards compatibility

## Team Responsibilities

### Core Team
- **Architect**: Design unified core architecture
- **Backend Dev**: Implement core analyzer and services
- **Integration Dev**: Build MCP adapter

### Testing Team
- **QA Engineer**: Create test suites
- **Performance Engineer**: Benchmark and optimize

### DevOps Team
- **SRE**: Setup deployment pipeline
- **Data Engineer**: Handle migration

## Timeline Summary

```
Week 1: Build
├── Day 1-2: Core structure
├── Day 3-4: Core analyzer
├── Day 5: Unified services
├── Day 6-7: MCP adapter

Week 2: Deploy
├── Day 1-2: Testing
├── Day 3: Parallel running
├── Day 4: Gradual rollout
├── Day 5: Full migration
```

## Next Steps

1. **Immediate**: Create directory structure
2. **Today**: Start extracting core from best implementations
3. **Tomorrow**: Begin MCP adapter development
4. **This Week**: Have working MCP integration
5. **Next Week**: Complete migration to unified system

## Success Metrics

- **Development Velocity**: 2x faster to add new features
- **Code Reduction**: 50% less code to maintain
- **Bug Reduction**: 40% fewer bugs from single implementation
- **Team Satisfaction**: Easier to understand and modify

This plan transforms the chaotic duplicate system into a clean, unified architecture that will serve as the foundation for all future development.
