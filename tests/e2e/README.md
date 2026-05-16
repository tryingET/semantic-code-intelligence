# End-to-End Integration Tests

This directory contains comprehensive end-to-end tests that validate the Ontology-LSP system against real-world codebases. These tests ensure the system works correctly with actual open-source projects and meets performance requirements under realistic conditions.

## 🎯 Test Objectives

The E2E tests validate:
- **Multi-Protocol Consistency**: All protocols (LSP, MCP, HTTP, CLI) return consistent results
- **Real-World Performance**: System meets targets with actual codebases of varying sizes
- **Memory Management**: Memory usage remains stable under load
- **Learning System**: Pattern learning improves over time with real code
- **Cache Effectiveness**: Caching provides expected performance improvements
- **Cross-Language Support**: Works with TypeScript, JavaScript, and other languages
- **Scalability**: Performance scales appropriately with codebase size

## 📁 Structure

```
tests/e2e/
├── README.md                    # This documentation
├── e2e-integration.test.ts      # Main E2E test suite
├── fixtures/
│   ├── repository-configs.ts    # Test repository configurations
│   └── setup-repositories.ts    # Repository management utilities
└── results/
    └── performance-reports/     # Generated performance reports
```

## 🔧 Test Configuration

### Repository Categories

The tests use three categories of repositories:

**Small (100-500 files)**
- TypeScript Node Starter
- Vue Create Template  
- Target: <50ms avg response, <100ms p95

**Medium (1000-5000 files)**
- Create React App
- NestJS Framework
- Target: <100ms avg response, <200ms p95

**Large (5000+ files)**
- TypeScript Compiler
- VS Code (if available)
- Target: <200ms avg response, <500ms p95

### Environment Variables

```bash
# Use local test workspace instead of cloning repos
USE_LOCAL_REPOS=true

# Run full test suite with all repositories
E2E_FULL_TEST=true

# Skip slow cloning for CI
E2E_SKIP_CLONE=true

# Set memory limits for testing
E2E_MEMORY_LIMIT=2048
```

## 🚀 Running Tests

### Prerequisites

```bash
# Ensure git is installed for repository cloning
git --version

# Install dependencies
bun install

# Ensure sufficient disk space (2-3GB for all repositories)
df -h
```

### Basic Test Execution

```bash
# Run all E2E tests
just test-e2e

# Run with local test workspace only (fastest)
USE_LOCAL_REPOS=true bun test tests/e2e/

# Run full test suite with all repositories
E2E_FULL_TEST=true bun test tests/e2e/

# Run specific test categories
bun test tests/e2e/ --test-name-pattern "Repository Management"
bun test tests/e2e/ --test-name-pattern "Performance"
bun test tests/e2e/ --test-name-pattern "Multi-Protocol"
```

### Advanced Options

```bash
# Run with extended timeout for large repositories
bun test tests/e2e/ --timeout 600000  # 10 minutes

# Run with coverage (slower but comprehensive)
bun test tests/e2e/ --coverage

# Run single repository size
REPO_SIZE=small bun test tests/e2e/

# Debug mode with verbose logging
DEBUG=ontology-lsp:* bun test tests/e2e/
```

## 📊 Performance Targets

### Response Time Targets
- **Small codebases**: 95% < 100ms, avg < 50ms
- **Medium codebases**: 95% < 200ms, avg < 100ms  
- **Large codebases**: 95% < 500ms, avg < 200ms

### Memory Usage Targets
- **Small codebases**: <50MB growth per operation
- **Medium codebases**: <100MB growth per operation
- **Large codebases**: <200MB growth per operation
- **Total growth**: <500MB across all tests

### Cache Performance Targets
- **Cache hit rate**: >85% after warmup
- **Cache speedup**: >2x improvement on repeated operations
- **Memory efficiency**: Cache overhead <20% of total memory

### Learning System Targets
- **Pattern detection**: >1 pattern per 5 operations
- **Confidence improvement**: Measurable increase over time
- **Learning persistence**: Patterns survive system restart

## 🧪 Test Scenarios

### 1. Repository Management
- Clone repositories efficiently
- Validate repository structure
- Handle missing or corrupted repositories
- Clean up resources properly

### 2. Multi-Protocol Consistency
- Find definition returns consistent results across protocols
- Find references returns similar results
- Error handling is consistent across protocols
- Response format normalization works correctly

### 3. Performance Under Load
- Response times meet targets across repository sizes
- Concurrent operations don't degrade performance significantly
- Memory usage remains stable during extended operation
- System recovers gracefully from resource pressure

### 4. Memory Management
- Memory grows linearly with operation count
- No memory leaks during extended operation
- Garbage collection is effective
- Cache memory is bounded appropriately

### 5. Learning System Effectiveness
- Patterns are learned from real code
- Suggestions improve over time
- Pattern confidence adjusts based on usage
- Learning persists across restarts

### 6. Cache Performance
- First operation is slower (cold cache)
- Repeated operations show significant speedup
- Cache hit rates meet targets
- Cache invalidation works correctly

## 🔍 Test Data Analysis

### Performance Metrics Collected
```javascript
interface PerformanceMetrics {
  average: number      // Average response time
  p95: number         // 95th percentile response time
  p99: number         // 99th percentile response time
  min: number         // Minimum response time
  max: number         // Maximum response time
  errors: number      // Number of failed operations
  operations: number  // Total operations performed
}
```

### Memory Metrics Collected
```javascript
interface MemoryMetrics {
  initial: number     // Initial heap usage
  peak: number        // Peak heap usage
  final: number       // Final heap usage
  growth: number      // Net memory growth
  gcCount: number     // Garbage collection count
}
```

### Learning Metrics Collected
```javascript
interface LearningMetrics {
  patternsLearned: number     // New patterns discovered
  confidenceGrowth: number    // Average confidence improvement
  operationsPerformed: number // Operations that triggered learning
  learningRate: number        // Patterns per operation
}
```

## 📈 Results and Reporting

### Test Output Format
```
🚀 Setting up E2E test environment...
✅ E2E test environment ready

📥 Cloning small-express-typescript...
⏱️  Clone completed in 2847ms
✅ Repository cloned: small-express-typescript (156 files)

🔍 Running 10 operations on 156 files (small-express-typescript)...
📊 Progress: 10/10 operations, avg: 42ms
📊 Small codebase performance: avg=42ms, p95=89ms

💾 Initial memory: 145MB
📈 Memory growth for small-express-typescript: 23MB
📊 Total memory growth: 23MB

🧠 Learning results: 3 new patterns from 8 operations
📈 Suggestion confidence: 0.65 -> 0.72
```

### Performance Report Generation
```bash
# Generate detailed performance report
just test-e2e-report

# View latest performance report
cat tests/e2e/results/performance-reports/latest.json
```

## 🛠️ Troubleshooting

### Common Issues

**Git Clone Failures**
```bash
# Check network connectivity
curl -I https://github.com

# Use HTTP instead of SSH
git config --global url."https://".insteadOf git://

# Increase git timeout
git config --global http.timeout 300
```

**Memory Issues**
```bash
# Run with increased memory limit
bun --max-old-space-size=4096 test tests/e2e/

# Run smaller subsets
USE_LOCAL_REPOS=true bun test tests/e2e/
REPO_SIZE=small bun test tests/e2e/
```

**Port Conflicts**
```bash
# Check for conflicting processes
lsof -i :7010 :7011 :7012

# Kill conflicting processes
just stop

# Use different ports
E2E_HTTP_PORT=7020 E2E_MCP_PORT=7021 E2E_LSP_PORT=7022 bun test tests/e2e/
```

**Repository Issues**
```bash
# Clean up failed clones
rm -rf .e2e-test-workspace

# Use local workspace only
cp -r test-workspace .e2e-test-workspace/local-test-workspace
USE_LOCAL_REPOS=true bun test tests/e2e/
```

### Performance Debugging

**Slow Operations**
```bash
# Profile individual operations
DEBUG=ontology-lsp:performance bun test tests/e2e/

# Check layer performance
DEBUG=ontology-lsp:layers bun test tests/e2e/

# Monitor system resources
top -p $(pgrep -f "bun test")
```

**Memory Leaks**
```bash
# Enable garbage collection logging
bun --expose-gc --trace-gc test tests/e2e/

# Monitor heap snapshots
bun --inspect test tests/e2e/
```

**Cache Issues**
```bash
# Clear all caches
rm -rf .ontology-test-cache

# Monitor cache performance
DEBUG=ontology-lsp:cache bun test tests/e2e/
```

## 🎛️ Configuration

### Custom Repository Configuration
```typescript
// Add custom repository to tests/e2e/fixtures/repository-configs.ts
const CUSTOM_REPO: TestRepository = {
  name: "my-project",
  url: "https://github.com/user/repo.git",
  sizeCategory: "medium",
  language: "typescript",
  expectedFiles: 1000,
  testCases: {
    findDefinition: [...],
    findReferences: [...],
    renameSymbol: [...],
    patternLearning: [...]
  },
  performanceTargets: {
    avgResponseTime: 80,
    p95ResponseTime: 150,
    maxMemoryGrowth: 80,
    cacheHitRate: 85
  }
}
```

### Performance Tuning
```typescript
// Adjust timeouts in test configuration
const TEST_CONFIG = {
  performance: {
    timeouts: {
      layer1: 5000,   // Increase for slower systems
      layer2: 10000,  // Increase for large files
      layer3: 2000,
      layer4: 2000,
      layer5: 3000
    }
  },
  cache: {
    memory: {
      maxSize: 100000,  // Increase for better caching
      ttl: 600000      // Increase for longer retention
    }
  }
}
```

## 📋 Integration with CI/CD

### GitHub Actions Configuration
```yaml
name: E2E Tests
on: [push, pull_request]

jobs:
  e2e-test:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest
          
      - name: Install dependencies
        run: bun install
        
      - name: Run E2E tests (local only for CI)
        run: |
          USE_LOCAL_REPOS=true bun test tests/e2e/
        env:
          E2E_MEMORY_LIMIT: 2048
          
      - name: Run full E2E tests (nightly)
        if: github.event_name == 'schedule'
        run: |
          E2E_FULL_TEST=true bun test tests/e2e/
        timeout-minutes: 60
        
      - name: Upload performance reports
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: e2e-performance-reports
          path: tests/e2e/results/
```

### Performance Regression Detection
```yaml
- name: Check performance regression
  run: |
    # Compare with baseline
    bun run scripts/compare-performance.js \
      --baseline tests/e2e/results/baseline.json \
      --current tests/e2e/results/latest.json \
      --threshold 0.1  # 10% regression threshold
```

## 🏆 Success Criteria

The E2E tests pass when:

1. **All repositories set up successfully** OR local workspace tests pass
2. **Multi-protocol consistency** shows >80% similarity across protocols
3. **Performance targets met** for all available repository sizes
4. **Memory usage stable** with <500MB total growth
5. **Learning system functional** with measurable pattern detection
6. **Cache performance** shows >2x speedup on repeated operations
7. **No critical errors** during extended operation

## 🔄 Maintenance

### Regular Updates
- Update repository configurations as projects evolve
- Adjust performance targets based on system improvements
- Add new test scenarios for edge cases discovered in production
- Update baseline performance metrics quarterly

### Repository Maintenance
- Monitor test repository availability and update URLs if needed
- Refresh repository branches/tags periodically
- Add new representative repositories as they become available
- Remove repositories that become unmaintained

This comprehensive E2E test suite ensures the Ontology-LSP system works reliably with real-world codebases and meets all performance and functionality requirements.