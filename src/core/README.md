# Unified Core Architecture

This directory contains the unified, protocol-agnostic core architecture for the ontology-lsp project. The architecture eliminates duplicate code between protocol adapters (LSP, MCP, HTTP) and provides a single source of truth for all code analysis functionality.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Protocol Adapters (Thin)                    │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌──────────┐  │
│  │     LSP     │ │     MCP     │ │    HTTP     │ │   CLI    │  │
│  │   Adapter   │ │   Adapter   │ │   Adapter   │ │ Adapter  │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                    Unified Core Architecture                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 CodeAnalyzer                            │    │
│  │          (Protocol-Agnostic Core)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                │                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                LayerManager                             │    │
│  │       (Performance & Health Monitoring)                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                │                                │
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐            │
│  │Layer1 │ │Layer2 │ │Layer3 │ │Layer4 │ │Layer5 │            │
│  │ ~5ms  │ │~50ms  │ │~10ms  │ │~10ms  │ │~20ms  │            │
│  │Fast   │ │ AST   │ │Concept│ │Pattern│ │Propag │            │
│  │Search │ │Analysis│ │ Graph │ │ Learn │ │ation  │            │
│  └───────┘ └───────┘ └───────┘ └───────┘ └───────┘            │
│                                │                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                SharedServices                           │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐   │    │
│  │  │ Cache   │ │Database │ │EventBus │ │ Monitoring  │   │    │
│  │  │Service  │ │Service  │ │Service  │ │   Service   │   │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. CodeAnalyzer (`unified-analyzer.ts`)
The main entry point that provides all core functionality:
- `findDefinition()` - Find symbol definitions
- `findReferences()` - Find all references to a symbol
- `prepareRename()` - Validate rename operations
- `rename()` - Execute rename with learning and propagation
- `getCompletions()` - Intelligent completions
- `buildSymbolMap()` - Layer 3 targeted symbol/declaration/reference map (TS/JS)

### 2. LayerManager (`layer-manager.ts`)
Orchestrates the 5 performance layers:
- **Layer 1**: Fast search (~5ms target)
- **Layer 2**: AST analysis (~50ms target)
 - **Layer 3**: Planner (~10ms target)
 - **Layer 4**: Ontology concepts (~10ms target)
 - **Layer 5**: Pattern learning & propagation (~20ms target)
- **Total**: <100ms for 95% of requests

### 3. SharedServices (`services/`)
- **CacheService**: Memory and Redis/Valkey caching
- **DatabaseService**: Unified SQLite with connection pooling
- **MonitoringService**: Performance metrics and health monitoring
- **EventBusService**: Inter-service communication

### 4. Error Handling (`error-handler.ts`)
- Circuit breakers for layer protection
- Retry logic with exponential backoff
- Graceful degradation strategies
- Comprehensive error normalization

### 5. Performance Validation (`performance-validator.ts`)
- Real-time performance monitoring
- Target compliance tracking
- Optimization recommendations
- Trend analysis

## Usage Examples

### Basic Usage

```typescript
import { createUnifiedAnalyzer } from './core/index.js';

// Create analyzer for a workspace
const { analyzer, layerManager, sharedServices } = 
  await createUnifiedAnalyzer('/path/to/workspace');

// Find definitions
const definitions = await analyzer.findDefinition({
  uri: 'file:///path/to/file.ts',
  position: { line: 10, character: 5 },
  identifier: 'myFunction',
  maxResults: 10
});

console.log(`Found ${definitions.data.length} definitions`);
console.log(`Performance: ${definitions.performance.total}ms total`);
console.log(`Cache hit: ${definitions.cacheHit}`);

// Clean up
await analyzer.dispose();
```

### Advanced Configuration

```typescript
import { AnalyzerFactory } from './core/analyzer-factory.js';

// Custom configuration
const config = {
  layers: {
    layer1: {
      enabled: true,
      timeout: 8, // Faster timeout for layer 1
      maxResults: 50,
      optimization: {
        bloomFilter: true,
        frequencyCache: true,
        negativeLookup: true
      }
    },
    layer2: {
      enabled: false // Disable AST analysis for speed
    },
    layer3: {
      enabled: true,
      dbPath: '/custom/path/ontology.db',
      cacheSize: 2000
    }
  },
  cache: {
    strategy: 'hybrid' as const,
    memory: { maxSize: 200 * 1024 * 1024, ttl: 600 },
    redis: {
      url: 'redis://localhost:6379',
      ttl: 3600,
      keyPrefix: 'ontology-lsp:'
    }
  },
  monitoring: {
    enabled: true,
    metricsInterval: 30000
  }
};

const { analyzer } = await AnalyzerFactory.createAnalyzer(config);
```

### Protocol Adapter Example

```typescript
// Example LSP adapter using the unified core
import { CodeAnalyzer, FindDefinitionRequest, Definition } from './core/index.js';
import { Location } from 'vscode-languageserver';

class LSPAdapter {
  constructor(private analyzer: CodeAnalyzer) {}
  
  async onDefinition(params: any): Promise<Location[]> {
    // Convert LSP request to core request
    const request: FindDefinitionRequest = {
      uri: params.textDocument.uri,
      position: params.position,
      identifier: this.getSymbolAtPosition(params),
      maxResults: 20
    };
    
    // Use unified core
    const result = await this.analyzer.findDefinition(request);
    
    // Convert core response to LSP response
    return result.data.map(def => this.coreDefinitionToLSP(def));
  }
  
  private coreDefinitionToLSP(def: Definition): Location {
    return {
      uri: def.uri,
      range: {
        start: def.range.start,
        end: def.range.end
      }
    };
  }
}
```

### Performance Monitoring

```typescript
import { PerformanceValidator } from './core/performance-validator.js';

// Monitor performance
const validator = new PerformanceValidator(eventBus);
validator.startPeriodicValidation(30000); // Every 30 seconds

// Listen for performance reports
eventBus.on('performance-validator:report', (report) => {
  console.log(`System Status: ${report.systemStatus}`);
  console.log(`Overall Compliance: ${(report.overallCompliance * 100).toFixed(1)}%`);
  
  if (report.recommendations.length > 0) {
    console.log('Recommendations:');
    report.recommendations.forEach(rec => console.log(`- ${rec}`));
  }
});

// Listen for critical violations
eventBus.on('performance-validator:critical-violation', (data) => {
  console.error('CRITICAL PERFORMANCE VIOLATION:', data.violations);
  // Implement alerting logic
});
```

### Health Monitoring

```typescript
import { ErrorHandler, HealthChecker } from './core/error-handler.js';

const errorHandler = new ErrorHandler(eventBus);
const healthChecker = new HealthChecker(eventBus);

// Start health monitoring
healthChecker.startHealthCheck(layerManager.layers, errorHandler, 30000);

// Listen for health changes
eventBus.on('health-checker:status-change', (data) => {
  if (!data.isHealthy) {
    console.error('SYSTEM UNHEALTHY:', data.report);
    // Implement alerting/recovery logic
  } else {
    console.log('System recovered to healthy state');
  }
});
```

## Performance Targets

The system is designed to meet these performance targets from VISION.md:

| Layer | Target | Purpose |
|-------|--------|---------|
| Layer 1 | ~5ms | Fast search with bloom filters and indexes |
| Layer 2 | ~50ms | AST analysis with tree-sitter |
| Layer 3 | ~10ms | Symbol map & planner |
| Layer 4 | ~10ms | Ontology / semantic graph |
| Layer 5 | ~20ms | Pattern learning & propagation |
| **Total** | **<100ms** | **95% of requests** |

## Error Handling

The unified architecture provides comprehensive error handling:

1. **Circuit Breakers**: Prevent cascade failures
2. **Retry Logic**: Exponential backoff with jitter
3. **Graceful Degradation**: Continue with partial results
4. **Error Normalization**: Consistent error types
5. **Health Monitoring**: Automatic recovery detection

## Caching Strategy

Multi-tier caching for optimal performance:

1. **Memory Cache**: Fastest access for frequently used data
2. **Redis/Valkey**: Distributed caching for scalability
3. **Database Cache**: Built-in SQLite caching
4. **Layer-specific Cache**: Optimized for each layer's needs

## Migration Guide

To migrate existing protocol adapters:

1. Replace direct layer calls with `CodeAnalyzer` methods
2. Convert protocol-specific types to core types
3. Handle core response types and convert back to protocol types
4. Remove duplicate logic - let the core handle it
5. Add error handling for core error types

## Testing

```typescript
import { createTestAnalyzer } from './core/index.js';

// Create lightweight test analyzer
const { analyzer } = await createTestAnalyzer();

// Test with minimal configuration
const result = await analyzer.findDefinition({
  uri: 'test://file.ts',
  position: { line: 0, character: 0 },
  identifier: 'test'
});

expect(result.performance.total).toBeLessThan(100);
```

## Monitoring and Observability

The unified architecture provides extensive monitoring:

- Real-time performance metrics
- Layer health monitoring
- Cache hit/miss rates
- Error rates and patterns
- Trend analysis
- Optimization recommendations

All metrics are available through the event bus and can be exported to external monitoring systems.
## Tool Registry

The universal tool registry (`src/core/tools/registry.ts`) declares a canonical list of capabilities. Adapters (MCP/HTTP/CLI) derive their public tools/endpoints from here, ensuring consistency.

Highlights: `find_definition`, `find_references`, `explore_codebase`, `build_symbol_map`, `plan_rename`, `apply_rename`, `rename_symbol`, `get_completions`, `list_symbols`, `diagnostics`, `pattern_stats`, `knowledge_insights`, `cache_controls`, and more.

## LSP Extensions

The LSP server exposes additional custom requests:
- `symbol/buildSymbolMap` – params: `{ symbol, uri?, maxFiles?, astOnly? }` → returns declarations/references.
- `refactor/planRename` – params: `{ oldName, newName, uri? }` → returns a WorkspaceEdit preview and summary.

## HTTP Endpoints

Under `/api/v1`, the HTTP adapter exposes: `/definition`, `/references`, `/explore`, `/rename`, `/plan-rename`, `/apply-rename`, `/symbol-map`, `/completions`.
