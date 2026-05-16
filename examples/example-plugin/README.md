# Enhanced Search Plugin

An example Ontology-LSP plugin that demonstrates how to enhance Layer 1 (Fast Search) with advanced fuzzy matching, caching optimizations, and real-time indexing.

## Features

- **Advanced Fuzzy Search**: Uses Fuse.js for intelligent fuzzy matching with configurable thresholds
- **Smart Caching**: LRU cache with TTL for frequently accessed search results
- **Real-time Indexing**: Automatically updates search index when files change
- **Performance Monitoring**: Comprehensive metrics and health reporting
- **Configurable**: Extensive configuration options for fine-tuning behavior

## Installation

### From Plugin Marketplace

```bash
ontology-lsp plugin install enhanced-search
```

### Manual Installation

1. Clone or download this plugin
2. Copy to your plugins directory: `~/.ontology-lsp/plugins/enhanced-search/`
3. Restart your LSP server or reload plugins

### Development Installation

```bash
# Clone the repository
git clone https://github.com/ontology-lsp/plugin-enhanced-search.git
cd plugin-enhanced-search

# Install dependencies
npm install

# Build the plugin
npm run build

# Link for development
ontology-lsp plugin link .
```

## Configuration

Add to your `.ontology-lsp-config.yaml`:

```yaml
plugins:
  enhanced-search:
    enabled: true
    priority: 10
    config:
      fuzzyThreshold: 0.3        # 0 = exact match, 1 = very fuzzy
      maxResults: 50             # Maximum search results
      cacheSize: 1000            # Number of results to cache
      enableAdvancedPatterns: true # Enable regex/glob patterns
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fuzzyThreshold` | number | 0.3 | Fuzzy matching threshold (0-1) |
| `maxResults` | number | 50 | Maximum search results to return |
| `cacheSize` | number | 1000 | LRU cache size for search results |
| `enableAdvancedPatterns` | boolean | true | Enable regex and glob patterns |

## How It Works

### Layer Enhancement Architecture

This plugin enhances Layer 1 (Fast Search) by:

1. **Intercepting Search Requests**: Hooks into the core search pipeline
2. **Building Smart Index**: Creates a fuzzy-searchable index of workspace symbols
3. **Caching Results**: Stores frequently accessed results for fast retrieval  
4. **Real-time Updates**: Watches file changes and updates index automatically

### Search Process

```mermaid
graph TD
    A[Search Request] --> B{Cache Hit?}
    B -->|Yes| C[Return Cached Result]
    B -->|No| D[Fuzzy Search Index]
    D --> E[Score & Rank Results]
    E --> F[Cache Results]
    F --> G[Return Enhanced Results]
```

### Performance Optimizations

- **Lazy Loading**: Index built incrementally as files are accessed
- **Smart Caching**: Cache invalidation based on file changes
- **Memory Efficient**: Uses streaming and pagination for large result sets
- **CPU Throttling**: Respects performance budgets and resource limits

## API Usage

### For Plugin Developers

```typescript
import { EnhancedSearchPlugin } from '@ontology-lsp/enhanced-search';

// The plugin automatically integrates with Layer 1
// No direct API usage required - works through core LSP methods

// Example: Using enhanced search through LSP
const definitions = await lspClient.sendRequest('textDocument/definition', {
  textDocument: { uri: 'file:///path/to/file.ts' },
  position: { line: 10, character: 5 }
});

// Enhanced search results include additional metadata
console.log(definitions[0].metadata.fuzzyScore); // 0.95
console.log(definitions[0].metadata.cacheHit);   // false
```

### Performance Monitoring

```typescript
// Health check returns detailed metrics
const health = await plugin.onHealthCheck();
console.log({
  cacheHitRate: health.cacheHitRate,     // 0.85
  averageLatency: health.latency,        // 5.2ms
  indexedFiles: health.metrics.indexSize // 1250
});
```

## Development Guide

### Project Structure

```
enhanced-search-plugin/
├── src/
│   ├── index.ts           # Main plugin implementation
│   ├── search-engine.ts   # Fuzzy search logic
│   ├── cache-manager.ts   # Caching implementation
│   └── file-watcher.ts    # File change monitoring
├── tests/
│   ├── index.test.ts      # Plugin tests
│   └── fixtures/          # Test data
├── plugin.json            # Plugin manifest
├── package.json           # NPM package config
├── tsconfig.json          # TypeScript config
└── README.md              # This file
```

### Building the Plugin

```bash
# Development build with watch mode
npm run dev

# Production build
npm run build

# Run tests
npm run test

# Validate plugin
npm run validate

# Package for distribution
npm run package
```

### Testing

The plugin includes comprehensive tests:

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --testNamePattern="search functionality"

# Run tests with coverage
npm test -- --coverage
```

### Plugin Lifecycle Testing

```typescript
describe('Enhanced Search Plugin', () => {
  let plugin: EnhancedSearchPlugin;
  let mockContext: PluginContext;

  beforeEach(async () => {
    mockContext = createMockContext();
    plugin = new EnhancedSearchPlugin();
    
    await plugin.onLoad(mockContext);
    await plugin.onInitialize(createTestConfig());
    await plugin.onActivate();
  });

  test('should enhance search results', async () => {
    const input = {
      type: 'definition',
      identifier: 'myFunction',
      uri: 'test-file.ts'
    };

    const result = await plugin.process(input, createTestContext());
    
    expect(result.results).toHaveLength(1);
    expect(result.confidence).toBeGreaterThan(0.8);
    expect(result.source).toBe('enhanced-search-fuzzy');
  });
});
```

## Performance Benchmarks

### Search Performance

| Scenario | Original Layer 1 | Enhanced Plugin | Improvement |
|----------|------------------|-----------------|-------------|
| Exact match | 2.1ms | 1.8ms | 14% faster |
| Fuzzy search | N/A | 4.2ms | New capability |
| Cached results | 2.1ms | 0.3ms | 86% faster |

### Memory Usage

- **Index Size**: ~2MB for 10,000 symbols
- **Cache Overhead**: ~5MB for 1,000 cached results  
- **Total Plugin Memory**: ~15MB typical usage

### Cache Efficiency

- **Hit Rate**: 85-95% after warm-up period
- **TTL**: 5 minutes for search results
- **Eviction**: LRU with file change invalidation

## Troubleshooting

### Common Issues

**Plugin not loading:**
```bash
# Check plugin validation
ontology-lsp plugin validate enhanced-search

# Check logs
ontology-lsp logs --plugin=enhanced-search
```

**Poor search performance:**
```yaml
# Reduce fuzzy threshold for more precise matches
plugins:
  enhanced-search:
    config:
      fuzzyThreshold: 0.1  # More precise matching
      maxResults: 20       # Fewer results
```

**High memory usage:**
```yaml
# Reduce cache size
plugins:
  enhanced-search:
    config:
      cacheSize: 500      # Smaller cache
```

### Debug Mode

Enable debug logging:

```yaml
plugins:
  enhanced-search:
    logging:
      level: debug
      includeStackTrace: true
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md).

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and add tests
4. Ensure tests pass: `npm test`
5. Submit a pull request

### Plugin Development Standards

- **Type Safety**: Full TypeScript with strict mode
- **Testing**: >90% test coverage required
- **Performance**: Must meet Layer 1 latency targets (<10ms)
- **Documentation**: Comprehensive API documentation
- **Security**: Follow plugin security guidelines

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: https://ontology-lsp.dev/plugins/enhanced-search
- **Issues**: https://github.com/ontology-lsp/plugin-enhanced-search/issues
- **Discord**: https://discord.gg/ontology-lsp
- **Email**: plugins@ontology-lsp.dev

## Related Plugins

- **Advanced AST Plugin**: Enhances Layer 2 with better parsing
- **Semantic Analysis Plugin**: Adds Layer 6 for code quality
- **Git Integration Plugin**: Connects with version control
- **Performance Monitor Plugin**: System performance tracking

---

*This plugin demonstrates the power and flexibility of the Ontology-LSP plugin system. Use it as a template for building your own enhancements!*