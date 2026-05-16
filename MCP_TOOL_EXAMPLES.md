# MCP Tool Usage Examples

This document provides examples of how to use each of the 16 MCP tools exposed by the Ontology LSP server.

## Architecture Overview

The tools are organized in a 5-layer architecture, with each layer providing progressively more sophisticated capabilities:

1. **Fast Search Layer (Layer 1)** (5ms) - Fast file/content search
2. **Tree-sitter Layer** (50ms) - AST-based code analysis
3. **Ontology Layer** (10ms) - Concept relationships
4. **Pattern Layer** (10ms) - Pattern detection and learning
5. **Knowledge Layer** (20ms) - Change propagation

## Tool Examples

### Layer 1: Fast Search Tools

#### search_files
Find files matching patterns with optional content filtering.

```json
{
  "name": "search_files",
  "arguments": {
    "pattern": "**/*.ts",
    "content": "export class",
    "workspace": "./src"
  }
}
```

**Response:**
```json
{
  "files": ["src/server.ts", "src/layers/orchestrator.ts"],
  "count": 2,
  "pattern": "**/*.ts",
  "contentFilter": "export class"
}
```

#### grep_content
Search file contents with regex patterns.

```json
{
  "name": "grep_content", 
  "arguments": {
    "pattern": "TODO|FIXME",
    "files": "**/*.{ts,js}",
    "context": 2
  }
}
```

**Response:**
```json
{
  "matches": [
    {
      "file": "src/index.ts",
      "line": 42,
      "content": "// TODO: Implement caching",
      "context": ["...", "// TODO: Implement caching", "..."]
    }
  ],
  "count": 1
}
```

### Layer 2: Semantic Analysis Tools

#### find_definition
Find symbol definitions with fuzzy matching.

```json
{
  "name": "find_definition",
  "arguments": {
    "symbol": "LayerOrchestrator",
    "file": "src/index.ts",
    "position": {"line": 10, "character": 15}
  }
}
```

**Response:**
```json
{
  "location": {
    "file": "src/layers/orchestrator.ts",
    "line": 31,
    "character": 13
  },
  "definition": "export class LayerOrchestrator {",
  "confidence": 0.95
}
```

#### find_references
Find all references to a symbol.

```json
{
  "name": "find_references",
  "arguments": {
    "symbol": "executeTool",
    "includeDeclaration": true,
    "scope": "workspace"
  }
}
```

**Response:**
```json
{
  "references": [
    {"file": "src/layers/orchestrator.ts", "line": 47, "type": "declaration"},
    {"file": "src/index.ts", "line": 82, "type": "call"},
    {"file": "tests/orchestrator.test.ts", "line": 15, "type": "call"}
  ],
  "count": 3
}
```

#### analyze_complexity
Analyze code complexity metrics.

```json
{
  "name": "analyze_complexity",
  "arguments": {
    "file": "src/layers/orchestrator.ts",
    "metrics": ["cyclomatic", "cognitive"]
  }
}
```

**Response:**
```json
{
  "complexity": {
    "cyclomatic": 15,
    "cognitive": 22,
    "functions": [
      {"name": "executeTool", "cyclomatic": 8, "cognitive": 12}
    ]
  },
  "suggestions": ["Consider breaking down executeTool into smaller functions"]
}
```

### Layer 4: Ontology Tools

#### find_related_concepts
Find concepts related to a given symbol.

```json
{
  "name": "find_related_concepts",
  "arguments": {
    "concept": "Server",
    "relationTypes": ["extends", "implements", "uses"],
    "depth": 2
  }
}
```

**Response:**
```json
{
  "concepts": [
    {"name": "OntologyMCPServer", "relation": "extends", "distance": 1},
    {"name": "StdioServerTransport", "relation": "uses", "distance": 1},
    {"name": "LayerOrchestrator", "relation": "uses", "distance": 2}
  ],
  "graph": "digraph { Server -> OntologyMCPServer; ... }"
}
```

#### analyze_dependencies
Analyze dependency graph and detect issues.

```json
{
  "name": "analyze_dependencies",
  "arguments": {
    "target": "src/index.ts",
    "detectCycles": true,
    "includeTransitive": true
  }
}
```

**Response:**
```json
{
  "dependencies": {
    "direct": ["./layers/orchestrator", "@modelcontextprotocol/sdk"],
    "transitive": ["./layers/layer1-fast-search", "./layers/tree-sitter"],
    "cycles": [],
    "depth": 3
  },
  "issues": []
}
```

### Layer 5: Pattern Detection Tools

#### detect_patterns
Detect design patterns in code.

```json
{
  "name": "detect_patterns",
  "arguments": {
    "scope": "src/layers",
    "patterns": ["singleton", "factory", "observer"],
    "minConfidence": 0.7
  }
}
```

**Response:**
```json
{
  "patterns": [
    {
      "type": "singleton",
      "location": "src/layers/orchestrator.ts:31",
      "confidence": 0.85,
      "description": "LayerOrchestrator uses singleton pattern"
    }
  ]
}
```

#### suggest_refactoring
Suggest refactoring based on patterns.

```json
{
  "name": "suggest_refactoring",
  "arguments": {
    "file": "src/index.ts",
    "types": ["extract", "simplify"],
    "autoApply": false
  }
}
```

**Response:**
```json
{
  "suggestions": [
    {
      "type": "extract",
      "description": "Extract tool registration into separate method",
      "location": {"line": 45, "endLine": 89},
      "preview": "private registerTools() { ... }"
    }
  ]
}
```

#### learn_pattern
Learn a new refactoring pattern.

```json
{
  "name": "learn_pattern",
  "arguments": {
    "before": "if (x !== null && x !== undefined) { return x; }",
    "after": "return x ?? defaultValue;",
    "name": "nullish-coalescing",
    "description": "Use nullish coalescing operator"
  }
}
```

**Response:**
```json
{
  "success": true,
  "patternId": "pattern_123",
  "message": "Pattern 'nullish-coalescing' learned successfully"
}
```

### Layer 5: Refactoring Tools

#### rename_symbol
Rename symbol with intelligent propagation.

```json
{
  "name": "rename_symbol",
  "arguments": {
    "oldName": "executeQuery",
    "newName": "runDatabaseQuery",
    "scope": "related",
    "preview": true
  }
}
```

**Response:**
```json
{
  "changes": [
    {"file": "src/db.ts", "line": 15, "before": "executeQuery", "after": "runDatabaseQuery"},
    {"file": "src/api.ts", "line": 42, "before": "executeQuery", "after": "runDatabaseQuery"}
  ],
  "related": ["executeQueryAsync", "queryExecutor"],
  "impact": "2 files, 5 occurrences"
}
```

#### apply_refactoring
Apply refactoring with change propagation.

```json
{
  "name": "apply_refactoring",
  "arguments": {
    "refactoring": {
      "type": "extract",
      "target": "handleRequest",
      "parameters": {
        "newName": "validateAndHandleRequest",
        "scope": "function"
      }
    },
    "propagate": true
  }
}
```

**Response:**
```json
{
  "result": {
    "success": true,
    "filesModified": 3,
    "changes": [
      {"file": "src/server.ts", "type": "extract", "lines": [45, 67]}
    ]
  }
}
```

#### extract_interface
Extract interface from implementation.

```json
{
  "name": "extract_interface",
  "arguments": {
    "source": "DatabaseConnection",
    "name": "IDatabaseConnection",
    "members": ["connect", "query", "disconnect"],
    "updateImplementations": true
  }
}
```

**Response:**
```json
{
  "interface": {
    "name": "IDatabaseConnection",
    "members": [
      "connect(): Promise<void>",
      "query(sql: string): Promise<any>",
      "disconnect(): Promise<void>"
    ]
  },
  "implementations": ["PostgresConnection", "MySQLConnection"]
}
```

### Utility Tools

#### explain_code
Explain code using semantic understanding.

```json
{
  "name": "explain_code",
  "arguments": {
    "code": "const result = await Promise.all(items.map(async (item) => process(item)))",
    "level": "intermediate"
  }
}
```

**Response:**
```json
{
  "explanation": "This code processes multiple items concurrently using Promise.all(). It maps each item to an async processing function and waits for all promises to resolve before continuing.",
  "concepts": ["async/await", "Promise.all", "concurrent processing"],
  "complexity": "moderate"
}
```

#### optimize_performance
Analyze and optimize performance.

```json
{
  "name": "optimize_performance",
  "arguments": {
    "target": "src/api/handler.ts",
    "metrics": ["time", "memory"],
    "constraints": {
      "maintainApi": true,
      "maxComplexity": 10
    }
  }
}
```

**Response:**
```json
{
  "optimizations": [
    {
      "type": "caching",
      "description": "Add memoization to expensive computations",
      "impact": "30% reduction in response time",
      "location": {"line": 45}
    }
  ]
}
```

#### generate_tests
Generate tests for code.

```json
{
  "name": "generate_tests",
  "arguments": {
    "target": "src/utils/validator.ts",
    "framework": "bun",
    "coverage": "comprehensive"
  }
}
```

**Response:**
```json
{
  "tests": [
    {
      "name": "should validate email addresses",
      "code": "test('validates email', () => { expect(validateEmail('test@example.com')).toBe(true); })"
    },
    {
      "name": "should reject invalid emails",
      "code": "test('rejects invalid', () => { expect(validateEmail('invalid')).toBe(false); })"
    }
  ],
  "coverage": "5 test cases covering edge cases and happy paths"
}
```

## MCP Integration

When these tools are called from an MCP client, the Fast Search Layer can access native Glob, Grep, and LS implementations (ripgrep/fast-glob/ls) for enhanced performance. The system automatically falls back to internal implementations when running standalone.

## Performance Characteristics

- **Layer 1**: 5ms average response time
- **Layer 2**: 50ms for AST parsing
- **Layer 3**: 10ms for ontology queries
- **Layer 4**: 10ms for pattern detection
- **Layer 5**: 20ms for refactoring operations

The orchestrator intelligently routes requests to minimize latency while maximizing accuracy.
