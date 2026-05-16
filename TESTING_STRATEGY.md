---
summary: "Testing Strategy: MCP Integration for the Semantic Code Intelligence repo."
read_when:
  - "You need TESTING STRATEGY information for Semantic Code Intelligence."
  - "You are changing TESTING_STRATEGY.md or related behavior."
type: "reference"
---

# Testing Strategy: MCP Integration

## Overview

Comprehensive testing strategy for the MCP adapter integration with MCP clients, ensuring reliability, performance, and compatibility.

## Testing Pyramid

```
         E2E Tests (10%)
        /            \
       /  Integration \
      /   Tests (30%)  \
     /                  \
    /    Unit Tests      \
   /        (60%)         \
  ╱________________________╲
```

## 1. Unit Tests (60% Coverage)

### Core Analyzer Tests

```typescript
// test/unit/core/analyzer.test.ts
import { describe, test, expect, beforeEach, mock } from "bun:test"
import { CodeAnalyzer } from "../../../core/analyzer"

describe("CodeAnalyzer", () => {
  let analyzer: CodeAnalyzer
  let mockCache: MockCache
  let mockLayers: MockLayers
  
  beforeEach(() => {
    mockCache = new MockCache()
    mockLayers = new MockLayers()
    analyzer = new CodeAnalyzer(mockLayers, mockCache)
  })
  
  describe("findDefinition", () => {
    test("returns cached result when available", async () => {
      // Arrange
      const cachedResult = { definitions: [mockDefinition], confidence: 1.0 }
      mockCache.set("def:TestClass", cachedResult)
      
      // Act
      const result = await analyzer.findDefinition({ symbol: "TestClass" })
      
      // Assert
      expect(result).toEqual(cachedResult)
      expect(mockCache.hits).toBe(1)
    })
    
    test("progressively enhances through layers", async () => {
      // Arrange
      mockLayers.search.setResult({ confidence: 0.5 })
      mockLayers.ast.setResult({ confidence: 0.8 })
      mockLayers.semantic.setResult({ confidence: 0.95 })
      
      // Act
      const result = await analyzer.findDefinition({ symbol: "TestClass" })
      
      // Assert
      expect(mockLayers.search.called).toBe(true)
      expect(mockLayers.ast.called).toBe(true)
      expect(mockLayers.semantic.called).toBe(true)
      expect(result.confidence).toBeGreaterThan(0.9)
    })
    
    test("stops enhancement when confidence is high enough", async () => {
      // Arrange
      mockLayers.search.setResult({ confidence: 0.95 })
      
      // Act
      await analyzer.findDefinition({ symbol: "TestClass" })
      
      // Assert
      expect(mockLayers.search.called).toBe(true)
      expect(mockLayers.ast.called).toBe(false)
      expect(mockLayers.semantic.called).toBe(false)
    })
    
    test("handles errors gracefully", async () => {
      // Arrange
      mockLayers.search.throwError(new Error("Search failed"))
      
      // Act & Assert
      await expect(analyzer.findDefinition({ symbol: "Bad" }))
        .rejects.toThrow("Search failed")
    })
  })
})
```

### MCP Translator Tests

```typescript
// test/unit/adapters/mcp/translator.test.ts
describe("MCPTranslator", () => {
  let translator: MCPTranslator
  
  beforeEach(() => {
    translator = new MCPTranslator()
  })
  
  describe("translateRequest", () => {
    test("translates find_definition request correctly", () => {
      // Arrange
      const mcpRequest = {
        method: "tools/call",
        params: {
          name: "find_definition",
          arguments: {
            symbol: "TestClass",
            file: "/path/to/file.ts"
          }
        }
      }
      
      // Act
      const coreRequest = translator.translateRequest(mcpRequest)
      
      // Assert
      expect(coreRequest).toEqual({
        symbol: "TestClass",
        location: {
          uri: "file:///path/to/file.ts",
          line: 0,
          column: 0
        }
      })
    })
    
    test("handles missing optional fields", () => {
      // Arrange
      const mcpRequest = {
        method: "tools/call",
        params: {
          name: "find_definition",
          arguments: { symbol: "TestClass" }
        }
      }
      
      // Act
      const coreRequest = translator.translateRequest(mcpRequest)
      
      // Assert
      expect(coreRequest.location).toBeUndefined()
    })
  })
  
  describe("translateResponse", () => {
    test("formats core response for MCP", () => {
      // Arrange
      const coreResponse = {
        definitions: [{
          location: { uri: "file.ts", line: 10, column: 5 },
          name: "TestClass",
          kind: SymbolKind.Class
        }],
        confidence: 0.95
      }
      
      // Act
      const mcpResponse = translator.translateResponse(coreResponse)
      
      // Assert
      expect(mcpResponse.content[0].type).toBe("text")
      expect(mcpResponse.content[0].text).toContain("TestClass")
      expect(mcpResponse.content[0].text).toContain("line 10")
    })
  })
})
```

## 2. Integration Tests (30% Coverage)

### Local Workflow (Sliced + Batched)

For fast local feedback, prefer the Justfile runners which mirror CI behavior with slices and batches.

Examples:

```bash
# Fast default (auto-sliced + batched)
just test

# Single slice (K of N)
just test-sliced 6 2

# All slices sequentially
just test-slices slices=6

# CI-like run locally (6 slices, steady batch size)
just test-ci-like

# Tune via env
SLICES=6 BATCH_SIZE=10 TIMEOUT=180000 BUN_JOBS=1 just test-fast
```

### Balanced Slices (Stabilize tail latency)

- Use recent batch history to evenly distribute heavy test files across slices.
- Knobs (env):
  - `BALANCE_SLICES=1` enable history-driven ordering.
  - `HISTORY_DIRS=".test-results:slices"` additional dirs to scan for `batch-report.jsonl`.
  - `HOT_SLICE_TOP=<N>` optionally isolate the top-N heaviest files into the last slice.

Recipes:

```bash
# CI-like, balanced (6 slices)
just test-ci-like-balanced

# Balanced sequential, isolating top-3 heavy files into the last slice
just test-slices-balanced slices=6 hot_top=3
```

Notes:
- `SLICES` controls total slices; `slice` selects which to run.
- `BATCH_SIZE` files per `bun test` invocation; `BUN_JOBS=1` recommended.
- `TIMEOUT` per-batch timeout in ms.

### MCP Server Integration

```typescript
// test/integration/mcp-server.test.ts
import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { MCPTestClient } from "../helpers/mcp-client"
import { startTestServers, stopTestServers } from "../helpers/test-servers"

describe("MCP Server Integration", () => {
  let client: MCPTestClient
  
  beforeAll(async () => {
    await startTestServers()
    client = new MCPTestClient("http://localhost:7011") // Test port
  })
  
  afterAll(async () => {
    await stopTestServers()
  })
  
  test("lists available tools", async () => {
    // Act
    const tools = await client.listTools()
    
    // Assert
    expect(tools).toContainEqual(
      expect.objectContaining({
        name: "find_definition",
        description: expect.any(String)
      })
    )
    expect(tools.length).toBeGreaterThan(10)
  })
  
  test("executes find_definition tool", async () => {
    // Arrange
    const request = {
      name: "find_definition",
      arguments: { symbol: "CodeAnalyzer" }
    }
    
    // Act
    const response = await client.callTool(request)
    
    // Assert
    expect(response.content).toBeDefined()
    expect(response.content[0].text).toContain("CodeAnalyzer")
  })
  
  test("handles concurrent requests", async () => {
    // Arrange
    const requests = Array(10).fill(null).map((_, i) => ({
      name: "find_definition",
      arguments: { symbol: `Symbol${i}` }
    }))
    
    // Act
    const responses = await Promise.all(
      requests.map(req => client.callTool(req))
    )
    
    // Assert
    expect(responses).toHaveLength(10)
    responses.forEach(resp => {
      expect(resp.content).toBeDefined()
    })
  })
  
  test("respects timeout", async () => {
    // Arrange
    const request = {
      name: "find_definition",
      arguments: { symbol: "SlowSymbol" }
    }
    
    // Act & Assert
    await expect(
      client.callTool(request, { timeout: 100 })
    ).rejects.toThrow("Timeout")
  })
})
```

## Fast Feedback: Batched + Sliced Test Runs

To avoid long, silent test runs, use the built-in batch runner and slicer:

- Batch with progress:
  - `BATCH_SIZE=8 TIMEOUT=180000 just test-batch`

- Slice the suite (1-of-N):
- `just test-sliced 4 1`
  - Run all slices sequentially: `just test-slices 4`

CI uses a 6-way matrix for main tests (`tests-sliced`) and a 2-way matrix for E2E (`e2e-sliced`), both with per-batch progress and artifacts. Coverage runs once in a dedicated `coverage` job post-slices. Each slice emits a batch-report.jsonl that is summarized per-slice and then aggregated by `analyze-slices` into the job summary; warnings are produced for batches exceeding a threshold (default WARN_MS=120000 for main, 300000 for E2E).

### Core to MCP Round-Trip

```typescript
// test/integration/round-trip.test.ts
describe("Core to MCP Round-Trip", () => {
  test("preserves data through translation", async () => {
    // Arrange
    const originalData = {
      symbol: "TestClass",
      location: { uri: "file.ts", line: 10, column: 5 }
    }
    
    // Act
    const mcpRequest = translator.toMCPRequest(originalData)
    const coreRequest = translator.fromMCPRequest(mcpRequest)
    
    // Assert
    expect(coreRequest).toEqual(originalData)
  })
  
  test("handles all symbol kinds", async () => {
    for (const kind of Object.values(SymbolKind)) {
      // Test each symbol kind round-trips correctly
      const result = await testRoundTrip({ kind })
      expect(result.kind).toBe(kind)
    }
  })
})
```

## 3. End-to-End Tests (10% Coverage)

### MCP Client Simulation

```typescript
// test/e2e/claude-simulation.test.ts
describe("MCP Client E2E Simulation", () => {
  let mcpSimulator: MCPClientSimulator
  
  beforeAll(async () => {
    mcpSimulator = new MCPClientSimulator()
    await mcpSimulator.connect("http://localhost:7001")
  })
  
  test("complete workflow: find definition → references → rename", async () => {
    // Step 1: Find definition
    const definition = await mcpSimulator.ask(
      "Find the definition of UserService"
    )
    expect(definition).toContain("class UserService")
    
    // Step 2: Find references
    const references = await mcpSimulator.ask(
      "Find all references to UserService"
    )
    expect(references).toContain("5 references found")
    
    // Step 3: Rename
    const rename = await mcpSimulator.ask(
      "Rename UserService to AccountService"
    )
    expect(rename).toContain("5 files updated")
  })
  
  test("handles natural language queries", async () => {
    const testCases = [
      {
        query: "Where is the login function defined?",
        expectedTool: "find_definition",
        expectedSymbol: "login"
      },
      {
        query: "Show me all uses of the Database class",
        expectedTool: "find_references",
        expectedSymbol: "Database"
      },
      {
        query: "What does processPayment do?",
        expectedTool: "get_hover",
        expectedSymbol: "processPayment"
      }
    ]
    
    for (const testCase of testCases) {
      const toolCall = await mcpSimulator.parseQuery(testCase.query)
      expect(toolCall.tool).toBe(testCase.expectedTool)
      expect(toolCall.arguments.symbol).toBe(testCase.expectedSymbol)
    }
  })
})
```

### Real MCP Client Test

```typescript
// test/e2e/real-mcp-client.test.ts
describe("Real MCP Client Integration", () => {
  test("manual test checklist", () => {
    console.log(`
    Manual Testing Checklist for MCP Client:
    
    1. [ ] Start MCP server: just start-mcp
    2. [ ] Configure Claude: just configure-claude
    3. [ ] Restart Claude Desktop
    4. [ ] Ask: "What tools do you have available?"
       - Should list semantic-code-intelligence tools
    5. [ ] Ask: "Find the definition of CodeAnalyzer"
       - Should return definition location
    6. [ ] Ask: "Find all references to findDefinition"
       - Should return list of references
    7. [ ] Ask: "What patterns have you learned?"
       - Should show learned patterns
    8. [ ] Ask: "Analyze the complexity of this file"
       - Should provide complexity metrics
    
    Record results in test/e2e/manual-test-results.md
    `)
  })
})
```

## 4. Performance Tests

```typescript
// test/performance/benchmark.test.ts
describe("Performance Benchmarks", () => {
  test("findDefinition meets SLA", async () => {
    const iterations = 1000
    const times: number[] = []
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await analyzer.findDefinition({ symbol: `Symbol${i}` })
      times.push(performance.now() - start)
    }
    
    const p50 = percentile(times, 50)
    const p95 = percentile(times, 95)
    const p99 = percentile(times, 99)
    
    expect(p50).toBeLessThan(20)  // 20ms p50
    expect(p95).toBeLessThan(50)  // 50ms p95
    expect(p99).toBeLessThan(100) // 100ms p99
  })
  
  test("handles load without degradation", async () => {
    const concurrentRequests = 100
    const requests = Array(concurrentRequests).fill(null).map((_, i) => 
      analyzer.findDefinition({ symbol: `Symbol${i}` })
    )
    
    const start = performance.now()
    await Promise.all(requests)
    const totalTime = performance.now() - start
    
    const avgTime = totalTime / concurrentRequests
    expect(avgTime).toBeLessThan(100) // 100ms average under load
  })
  
  test("cache improves performance", async () => {
    // First call - no cache
    const firstStart = performance.now()
    await analyzer.findDefinition({ symbol: "TestSymbol" })
    const firstTime = performance.now() - firstStart
    
    // Second call - cached
    const secondStart = performance.now()
    await analyzer.findDefinition({ symbol: "TestSymbol" })
    const secondTime = performance.now() - secondStart
    
    expect(secondTime).toBeLessThan(firstTime * 0.1) // 10x faster with cache
  })
})
```

## 5. Test Utilities

### Mock MCP Client

```typescript
// test/helpers/mcp-client.ts
export class MCPTestClient {
  constructor(private baseUrl: string) {}
  
  async listTools(): Promise<Tool[]> {
    const response = await fetch(`${this.baseUrl}/tools`)
    return response.json()
  }
  
  async callTool(request: ToolRequest): Promise<ToolResponse> {
    const response = await fetch(`${this.baseUrl}/tools/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    })
    return response.json()
  }
}
```

### Test Data Factory

```typescript
// test/helpers/factories.ts
export const factory = {
  definition: (overrides = {}) => ({
    location: { uri: "file.ts", line: 10, column: 5 },
    name: "TestSymbol",
    kind: SymbolKind.Class,
    confidence: 0.95,
    ...overrides
  }),
  
  reference: (overrides = {}) => ({
    location: { uri: "file.ts", line: 20, column: 10 },
    kind: ReferenceKind.Call,
    preview: "testSymbol.method()",
    confidence: 0.9,
    ...overrides
  }),
  
  mcpRequest: (tool: string, args = {}) => ({
    method: "tools/call",
    params: {
      name: tool,
      arguments: args
    }
  })
}
```

## 6. Test Execution Plan

### Continuous Integration

```yaml
# .github/workflows/test.yml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: just init
      
      # Unit tests
      - run: just test-unit
      
      # Integration tests
      - run: just start-test-servers
      - run: just test-integration
      - run: just stop-test-servers
      
      # E2E tests
      - run: just test-e2e
      
      # Performance tests
      - run: just bench
      
      # Coverage report
      - run: just test-coverage
      - uses: codecov/codecov-action@v3
```

### Local Testing

```bash
# Quick test during development
just test-mcp

# Full test suite before commit
just test

# Performance validation
just bench

# Manual Claude Desktop test
just test-mcp-connection
```

### Storage Adapter Gating (Postgres/Triple)

- Postgres parity tests run only when `ONTOLOGY_PG_URL` / `DATABASE_URL` / `PG_URL` is set.
- Triple store tests run only when `TRIPLESTORE_URL` is set.
- CI defaults to SQLite; set `LAYER4_ADAPTER=sqlite` when you want sqlite-only suites.

## 7. Test Coverage Goals

| Component | Unit | Integration | E2E | Total |
|-----------|------|-------------|-----|--------|
| Core Analyzer | 90% | 70% | 50% | 85% |
| MCP Adapter | 85% | 80% | 60% | 80% |
| Translator | 95% | 85% | - | 90% |
| Cache Service | 90% | 70% | - | 85% |
| Overall | 90% | 75% | 50% | 85% |

## 8. Error Scenarios

### Must Test

1. **Network failures** - Connection drops, timeouts
2. **Invalid input** - Malformed requests, missing fields
3. **Resource exhaustion** - Memory limits, queue overflow
4. **Concurrent access** - Race conditions, deadlocks
5. **Version mismatch** - Protocol incompatibility
6. **Permission denied** - File access, authentication
7. **Data corruption** - Invalid cache, corrupt database

### Recovery Testing

```typescript
describe("Error Recovery", () => {
  test("recovers from network failure", async () => {
    // Simulate network failure
    mockNetwork.fail(3) // Fail 3 times
    
    // Should retry and succeed
    const result = await analyzer.findDefinition({ symbol: "Test" })
    expect(result).toBeDefined()
    expect(mockNetwork.attempts).toBe(4) // 3 failures + 1 success
  })
  
  test("circuit breaker prevents cascade", async () => {
    // Trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      mockNetwork.fail()
      await analyzer.findDefinition({ symbol: "Test" }).catch(() => {})
    }
    
    // Circuit should be open
    await expect(analyzer.findDefinition({ symbol: "Test" }))
      .rejects.toThrow("Circuit breaker open")
    
    // Wait for reset
    await sleep(5000)
    
    // Should work again
    mockNetwork.succeed()
    const result = await analyzer.findDefinition({ symbol: "Test" })
    expect(result).toBeDefined()
  })
})
```

## 9. Test Data Management

### Test Database

```sql
-- test/fixtures/test.sql
CREATE TABLE test_concepts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  metadata JSON
);

INSERT INTO test_concepts VALUES
  ('1', 'TestClass', 'class', '{"file": "test.ts"}'),
  ('2', 'testFunction', 'function', '{"file": "test.ts"}'),
  ('3', 'TEST_CONSTANT', 'constant', '{"file": "constants.ts"}');
```

### Seed Data

```typescript
// test/fixtures/seed.ts
export async function seedTestData(db: Database) {
  await db.exec(readFileSync("test/fixtures/test.sql", "utf-8"))
  
  // Add patterns
  await db.run(
    "INSERT INTO patterns (name, template, confidence) VALUES (?, ?, ?)",
    ["Error Handler", "try { $1 } catch (error) { $2 }", 0.95]
  )
}
```

## 10. Success Metrics

### Test Quality Metrics

- **Test execution time**: < 5 minutes for full suite
- **Flakiness rate**: < 1% of test runs
- **Coverage**: > 85% overall
- **Bug escape rate**: < 5% reach production
- **Mean time to detect**: < 10 minutes
- **Mean time to fix**: < 1 hour

### Monitoring

```typescript
// Track test metrics
export function reportTestMetrics(results: TestResults) {
  console.log(`
  Test Metrics:
  ════════════════════════════
  Total tests: ${results.total}
  Passed: ${results.passed} (${results.passRate}%)
  Failed: ${results.failed}
  Skipped: ${results.skipped}
  Duration: ${results.duration}ms
  Coverage: ${results.coverage}%
  
  Slowest tests:
  ${results.slowest.map(t => `  - ${t.name}: ${t.duration}ms`).join('\n')}
  `)
}
```

This comprehensive testing strategy ensures the MCP adapter works reliably with MCP clients while maintaining high performance and quality standards.
