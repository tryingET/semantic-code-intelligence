---
summary: "Comprehensive Integration Tests for Unified Architecture for the Semantic Code Intelligence repo."
read_when:
  - "You need README information for Semantic Code Intelligence."
  - "You are changing tests/README.md or related behavior."
type: "reference"
---

# Comprehensive Integration Tests for Unified Architecture

This directory contains comprehensive integration tests for the Semantic Code Intelligence unified architecture. These tests verify that all components work together correctly and meet the performance targets outlined in VISION.md.

## Test Suite Overview

### 1. Unified Core Tests (`unified-core.test.ts`)
**Purpose**: Tests the unified CodeAnalyzer that provides protocol-agnostic functionality across all 5 layers.

**Key Features**:
- Tests all operations (findDefinition, findReferences, rename, completion)
- Verifies performance targets (<100ms for 95% of requests)
- Tests error handling and recovery
- Verifies caching and optimization
- Tests all 5 layers work together progressively

**Performance Targets Verified**:
- Layer 1 (Fast Search): ~5ms
- Layer 2 (AST Analysis): ~50ms
- Layer 3 (Planner): ~10ms
- Layer 4 (Ontology): ~10ms
- Layer 5 (Pattern Learning): ~10ms
- Layer 5 (Knowledge Propagation): ~20ms

### 2. Adapter Integration Tests (`adapters.test.ts`)
**Purpose**: Tests all protocol adapters (LSP, MCP, HTTP, CLI) to ensure correct conversion and backward compatibility.

**Key Features**:
- Tests LSP adapter converts correctly to/from LSP protocol
- Tests MCP adapter handles all tools properly
- Tests HTTP adapter REST endpoints work correctly
- Tests CLI adapter commands execute properly
- Verifies backward compatibility with existing clients

**Protocols Tested**:
- **LSP**: Definition, References, Rename, Completion providers
- **MCP**: search_files, find_definition, find_references, analyze_complexity, suggest_refactoring tools
- **HTTP**: REST API endpoints with proper JSON responses
- **CLI**: Command-line interface with all major commands

### 3. Learning System Tests (`learning-system.test.ts`)
**Purpose**: Tests the complete learning system including feedback loops, evolution tracking, and team knowledge sharing.

**Key Features**:
- Tests feedback loop collects and applies feedback
- Tests evolution tracking records and analyzes changes
- Tests team knowledge sharing and validation
- Tests pattern detection and application
- Verifies learning performance (<20ms)

**Learning Components Tested**:
- **FeedbackLoopSystem**: Pattern confidence adjustment, correction learning
- **CodeEvolutionTracker**: Change pattern detection, architectural trends
- **TeamKnowledgeSystem**: Knowledge sharing, pattern validation, conflict resolution
- **LearningOrchestrator**: Cross-system integration and comprehensive analysis

### 4. Performance Benchmarks (`performance.test.ts`)
**Purpose**: Benchmarks each layer against targets, tests with large codebases, measures memory usage, and tests concurrent operations.

**Key Features**:
- Benchmarks individual layers against performance targets
- Tests with large codebases (10K+ files)
- Measures memory usage and resource management
- Tests concurrent operations scalability
- Verifies 95% < 100ms target across all operations

**Performance Scenarios**:
- **Individual Layers**: Each layer tested in isolation
- **Large Codebase**: 1K-10K files with consistent performance
- **Concurrent Load**: 10-100 concurrent operations
- **Memory Management**: Resource cleanup and memory growth tracking

### 5. Cross-Protocol Consistency Tests (`consistency.test.ts`)
**Purpose**: Verifies all protocols return consistent results, handle errors consistently, and maintain shared learning.

**Key Features**:
- Verifies all protocols return equivalent results
- Tests error handling consistency across protocols
- Verifies caching works across protocol boundaries
- Tests learning is shared between protocols
- Ensures performance consistency across protocols

**Consistency Areas**:
- **Result Consistency**: Same queries return similar results across protocols
- **Error Handling**: Consistent error responses and recovery
- **Cache Coherence**: Shared cache benefits all protocols
- **Learning Integration**: Feedback and evolution data shared across protocols

## Running the Tests

### Prerequisites
```bash
# Ensure Bun is installed and up to date
bun --version  # Should be v1.2.20+

# Install dependencies
bun install
```

### Run All Tests
```bash
# Run the complete test suite
bun test tests/

# Run with coverage
bun test --coverage tests/

# Run with performance timing
time bun test tests/
```

### Run Individual Test Suites
```bash
# Unified core tests
bun test tests/unified-core.test.ts

# Adapter integration tests  
bun test tests/adapters.test.ts

# Learning system tests
bun test tests/learning-system.test.ts

# Performance benchmarks
bun test tests/performance.test.ts

# Cross-protocol consistency tests
bun test tests/consistency.test.ts
```

### Run Tests with Filtering
```bash
# Run only performance-related tests
bun test tests/ --test-name-pattern "performance"

# Run only consistency tests
bun test tests/ --test-name-pattern "consistency"

# Run only error handling tests
bun test tests/ --test-name-pattern "error"
```

### Development Testing
```bash
# Run tests in watch mode during development
bun test --watch tests/

# Run specific test with debugging
bun test tests/unified-core.test.ts --verbose

# Run tests with timeout for performance testing
bun test tests/performance.test.ts --timeout 60000
```

## Test Configuration

### Performance Test Configuration
The performance tests use realistic configurations:
- **Cache Size**: 10,000 items for performance testing
- **Database**: In-memory SQLite for fast testing
- **Concurrent Connections**: Up to 20 for concurrent testing
- **Response Time Targets**: 95% < 100ms

### Perf/Flake Control (Env Knobs)
- `PERF=1` enables performance-only suites and sections guarded for perf runs.
- `E2E=1` enables end-to-end tests; keep off for fast local runs.
- `L2_MAX_PARSE_FILES` caps how many files Layer 2 (AST) parses per request (default 20; clamp 1–100). Lowering this can reduce variance on constrained hosts during perf runs.
  - Examples:
    - `PERF=1 L2_MAX_PARSE_FILES=10 bun test tests/performance.test.ts --test-name-pattern "Layer 2 (AST Analysis)"`
    - `PERF=1 L2_MAX_PARSE_FILES=15 bun test tests/enhanced-search-async.test.ts`

### Large Codebase Simulation
Performance tests simulate large codebases:
- **File Count**: 1K-10K TypeScript files
- **Symbol Count**: 10 symbols per file (100K+ total symbols)
- **Test Scenarios**: Mixed workload with realistic distribution

### Memory Testing
Memory usage is monitored throughout tests:
- **Initial Memory**: Baseline measurement before tests
- **Peak Memory**: Maximum memory usage during operations
- **Memory Cleanup**: Verification of proper resource disposal
- **Memory Growth**: Long-running operation memory stability

## Expected Test Results

### Performance Benchmarks
All tests should meet these targets:
- **95% Response Time**: < 100ms for all operations
- **Average Response Time**: < 60ms for most operations
- **Memory Growth**: < 100MB over extended operations
- **Cache Hit Rate**: > 90% for repeated operations

### Consistency Verification
All protocols should show:
- **Result Similarity**: > 80% consistency across protocols
- **Error Handling**: Consistent error types and recovery
- **Performance Variance**: < 3x overhead for adapter layers
- **Cache Benefits**: Shared cache improves all protocol performance

### Learning System Metrics
Learning components should demonstrate:
- **Feedback Processing**: < 10ms per feedback event
- **Evolution Tracking**: < 15ms per code change
- **Pattern Learning**: Increasing confidence over time
- **System Health**: 'healthy' status under normal operations

## Troubleshooting

### Common Issues

**Test Timeouts**
```bash
# Increase timeout for performance tests
bun test tests/performance.test.ts --timeout 120000
```

**Memory Issues**
```bash
# Run tests with more memory
bun --max-old-space-size=4096 test tests/
```

**Database Lock Issues**
```bash
# Each test uses in-memory database, but if issues persist:
# Delete any leftover database files
rm -f tests/*.db tests/*.db-wal tests/*.db-shm
```

**Port Conflicts**
```bash
# Tests use different ports for HTTP adapters
# If conflicts occur, check for running processes:
lsof -i :7010  # Test HTTP adapter port
lsof -i :7020  # Consistency test HTTP adapter port
```

### Performance Issues
If performance tests fail to meet targets:
1. Check system load: `htop` or Activity Monitor
2. Disable other resource-intensive applications
3. Run tests individually to isolate issues
4. Check for memory leaks in long-running tests

### Consistency Issues
If consistency tests show protocol differences:
1. Check adapter implementation for protocol-specific handling
2. Verify result normalization functions are correct
3. Check for timing-dependent race conditions
4. Ensure cache configuration is consistent

## Test Development Guidelines

### Adding New Tests
1. Follow existing test structure and naming conventions
2. Use comprehensive beforeAll/afterAll setup and cleanup
3. Include performance measurements where appropriate
4. Test both success and failure scenarios
5. Add logging for debugging complex scenarios

### Performance Test Guidelines
1. Use realistic data sizes and scenarios
2. Measure timing with high precision (performance.now())
3. Include statistical analysis (mean, median, p95, p99)
4. Test under various load conditions
5. Monitor memory usage for long-running tests

### Consistency Test Guidelines
1. Test the same operation across all protocols
2. Normalize results for comparison across different formats
3. Allow for reasonable variance due to protocol differences
4. Test error scenarios as well as success scenarios
5. Verify timing consistency as well as result consistency

## Integration with CI/CD

### GitHub Actions Configuration
```yaml
name: Integration Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test tests/ --coverage
      - run: bun test tests/performance.test.ts --timeout 180000
```

### Performance Regression Detection
```bash
# Run performance tests and save results
bun test tests/performance.test.ts > performance-results.txt

# Compare with previous results
diff previous-performance.txt performance-results.txt
```

These comprehensive integration tests ensure that the unified architecture works correctly, meets all performance targets, maintains consistency across protocols, and provides reliable learning capabilities as outlined in the VISION.md requirements.
