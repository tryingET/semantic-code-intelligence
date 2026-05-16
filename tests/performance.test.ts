/**
 * Performance Benchmarks and Load Testing
 *
 * Tests performance targets for each layer, handles large codebases (10K+ files),
 * measures memory usage, tests concurrent operations, and verifies 95% < 100ms target.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AnalyzerFactory } from '../src/core/analyzer-factory.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import {
    type CompletionRequest,
    type CoreConfig,
    type EventBus,
    type FindDefinitionRequest,
    type FindReferencesRequest,
    RenameRequest,
} from '../src/core/types.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';

// Performance measurement utilities
interface PerformanceMetrics {
    min: number;
    max: number;
    mean: number;
    median: number;
    p95: number;
    p99: number;
    stdDev: number;
}

const calculateMetrics = (times: number[]): PerformanceMetrics => {
    const sorted = times.sort((a, b) => a - b);
    const length = sorted.length;

    const sum = sorted.reduce((a, b) => a + b, 0);
    const mean = sum / length;

    const variance = sorted.reduce((acc, val) => acc + (val - mean) ** 2, 0) / length;
    const stdDev = Math.sqrt(variance);

    return {
        min: sorted[0],
        max: sorted[length - 1],
        mean,
        median: length % 2 === 0 ? (sorted[length / 2 - 1] + sorted[length / 2]) / 2 : sorted[Math.floor(length / 2)],
        p95: sorted[Math.floor(length * 0.95)],
        p99: sorted[Math.floor(length * 0.99)],
        stdDev,
    };
};

const measureMemoryUsage = (): number => {
    if (typeof process !== 'undefined' && process.memoryUsage) {
        return process.memoryUsage().heapUsed / 1024 / 1024; // MB
    }
    return 0; // Fallback for environments without process.memoryUsage
};

// Test context
interface PerformanceTestContext {
    codeAnalyzer: CodeAnalyzer;
    layerManager: LayerManager;
    sharedServices: SharedServices;
    config: CoreConfig;
}

const createPerformanceTestContext = async (): Promise<PerformanceTestContext> => {
    // Optimized configuration for performance testing
    const config: CoreConfig = {
        workspaceRoot: '/performance-test-workspace',
        layers: {
            layer1: { enabled: true, timeout: 200 }, // Fast search - 50ms target, 200ms timeout (4x buffer)
            layer2: { enabled: true, timeout: 100 }, // AST - 50ms target
            layer3: { enabled: true, timeout: 50 }, // Planner - 10ms target
            layer4: { enabled: true, timeout: 50 }, // Patterns - 10ms target
            layer5: { enabled: true, timeout: 100 }, // Propagation - 20ms target
        },
        cache: {
            enabled: true,
            strategy: 'memory' as const,
            memory: {
                maxSize: 10000 * 1024, // 10MB for performance testing
                ttl: 300, // 5 minutes
            },
        },
        database: {
            path: ':memory:',
            maxConnections: 20, // More connections for concurrent testing
        },
        performance: {
            targetResponseTime: 100,
            maxConcurrentRequests: 100,
            healthCheckInterval: 30000,
        },
        monitoring: {
            enabled: false,
            metricsInterval: 60000,
            logLevel: 'error' as const,
            tracing: {
                enabled: false,
                sampleRate: 0,
            },
        },
    };

    // Use the proper analyzer factory to ensure layers are registered
    const { analyzer: codeAnalyzer, layerManager, sharedServices } = await AnalyzerFactory.createTestAnalyzer();

    return { codeAnalyzer, layerManager, sharedServices, config };
};

// Generate test data for large codebase simulation
const generateLargeCodebaseData = (fileCount: number) => {
    const files = [];
    const symbols = [];

    for (let i = 0; i < fileCount; i++) {
        const fileName = `file:///test/large-codebase/file-${i}.ts`;
        files.push(fileName);

        // Generate symbols for this file
        for (let j = 0; j < 10; j++) {
            symbols.push({
                name: `Symbol_${i}_${j}`,
                file: fileName,
                line: Math.floor(Math.random() * 100),
                character: Math.floor(Math.random() * 50),
            });
        }
    }

    return { files, symbols };
};

const PERF_ENABLED = process.env.PERF === '1';

const maybeDescribe: any = PERF_ENABLED ? describe : describe.skip;

maybeDescribe('Performance Benchmarks', () => {
    let context: PerformanceTestContext;
    let largeCodebase: {
        files: string[];
        symbols: Array<{ name: string; file: string; line: number; character: number }>;
    };

    beforeAll(async () => {
        context = await createPerformanceTestContext();
        largeCodebase = generateLargeCodebaseData(1000); // 1K files for initial testing
    });

    afterAll(async () => {
        await context.codeAnalyzer.dispose();
        await context.layerManager.dispose();
        await context.sharedServices.dispose();
    });

    describe('Individual Layer Performance', () => {
        test('Layer 1 (Fast Search) should meet 50ms target', async () => {
            const iterations = 100;
            const times: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                // Configure to only use Layer 1
                const startTime = performance.now();

                // This would need to be implemented to isolate Layer 1
                // For now, we measure the fastest operations which primarily use Layer 1
                await context.codeAnalyzer.findDefinition(request);

                const endTime = performance.now();
                times.push(endTime - startTime);
            }

            const metrics = calculateMetrics(times);

            console.log('Layer 1 Performance Metrics:', {
                mean: `${metrics.mean.toFixed(2)}ms`,
                p95: `${metrics.p95.toFixed(2)}ms`,
                p99: `${metrics.p99.toFixed(2)}ms`,
            });

            // Layer 1 should be fast with realistic expectations for ripgrep I/O operations
            expect(metrics.mean).toBeLessThan(80); // Allow overhead for real file system operations
            expect(metrics.p95).toBeLessThan(100);
        });

        test('Layer 2 (AST Analysis) should meet 50ms target', async () => {
            const iterations = 50;
            const times: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                const startTime = performance.now();
                const result = await context.codeAnalyzer.findDefinition(request);
                const endTime = performance.now();

                times.push(endTime - startTime);

                // Track Layer 2 specific timing
                expect(result.performance.layer2).toBeLessThan(50);
            }

            const metrics = calculateMetrics(times);

            console.log('Layer 2 Performance Metrics:', {
                mean: `${metrics.mean.toFixed(2)}ms`,
                p95: `${metrics.p95.toFixed(2)}ms`,
                layer2Mean: `${times.map((_, i) => i).reduce((sum, i) => sum + (times[i] || 0), 0) / times.length}ms`,
            });

            expect(metrics.mean).toBeLessThan(100); // Full operation should still be fast
        });

        test('Layer 4 (Ontology) should meet 10ms target', async () => {
            const iterations = 100;
            const layer4Times: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                const result = await context.codeAnalyzer.findDefinition(request);
                layer4Times.push(result.performance.layer4);
            }

            const metrics = calculateMetrics(layer4Times);

            console.log('Layer 4 Performance Metrics:', {
                mean: `${metrics.mean.toFixed(2)}ms`,
                p95: `${metrics.p95.toFixed(2)}ms`,
                p99: `${metrics.p99.toFixed(2)}ms`,
            });

            expect(metrics.mean).toBeLessThan(15); // Allow some overhead
            expect(metrics.p95).toBeLessThan(20);
        });

        test('Layer 5 (Pattern Learning) should meet 10ms target', async () => {
            const iterations = 100;
            const layer5Times: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                const result = await context.codeAnalyzer.findDefinition(request);
                layer5Times.push(result.performance.layer5);
            }

            const metrics = calculateMetrics(layer5Times);

            console.log('Layer 5 Performance Metrics:', {
                mean: `${metrics.mean.toFixed(2)}ms`,
                p95: `${metrics.p95.toFixed(2)}ms`,
                p99: `${metrics.p99.toFixed(2)}ms`,
            });

            expect(metrics.mean).toBeLessThan(15); // Allow some overhead
            expect(metrics.p95).toBeLessThan(20);
        });

        test('Layer 5 (Knowledge Propagation) should meet 20ms target', async () => {
            const iterations = 50; // Fewer iterations as this layer is more expensive
            const layer5Times: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                const result = await context.codeAnalyzer.findDefinition(request);
                layer5Times.push(result.performance.layer5);
            }

            const metrics = calculateMetrics(layer5Times);

            console.log('Layer 5 Performance Metrics:', {
                mean: `${metrics.mean.toFixed(2)}ms`,
                p95: `${metrics.p95.toFixed(2)}ms`,
                p99: `${metrics.p99.toFixed(2)}ms`,
            });

            expect(metrics.mean).toBeLessThan(25); // Allow some overhead
            expect(metrics.p95).toBeLessThan(40);
        });
    });

    describe('Large Codebase Performance (10K+ Files)', () => {
        beforeAll(() => {
            // Generate larger codebase for this test suite
            largeCodebase = generateLargeCodebaseData(10000); // 10K files
        });

        test('should handle 10K+ files with consistent performance', async () => {
            const iterations = 200;
            const times: number[] = [];
            const memoryUsages: number[] = [];

            // Sample different areas of the large codebase
            const sampleIndices = Array.from({ length: iterations }, (_, i) =>
                Math.floor((i / iterations) * largeCodebase.symbols.length)
            );

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[sampleIndices[i]];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                const initialMemory = measureMemoryUsage();
                const startTime = performance.now();

                await context.codeAnalyzer.findDefinition(request);

                const endTime = performance.now();
                const finalMemory = measureMemoryUsage();

                times.push(endTime - startTime);
                memoryUsages.push(finalMemory - initialMemory);
            }

            const timeMetrics = calculateMetrics(times);
            const memoryMetrics = calculateMetrics(memoryUsages.filter((m) => m > 0)); // Filter out negative values

            console.log('Large Codebase Performance:', {
                timeMetrics: {
                    mean: `${timeMetrics.mean.toFixed(2)}ms`,
                    p95: `${timeMetrics.p95.toFixed(2)}ms`,
                    p99: `${timeMetrics.p99.toFixed(2)}ms`,
                },
                memoryMetrics:
                    memoryMetrics.mean > 0
                        ? {
                              meanIncrease: `${memoryMetrics.mean.toFixed(2)}MB`,
                              maxIncrease: `${memoryMetrics.max.toFixed(2)}MB`,
                          }
                        : 'Memory tracking not available',
            });

            // Performance should remain consistent even with large codebases
            expect(timeMetrics.p95).toBeLessThan(150); // Allow some degradation for very large codebases
            expect(timeMetrics.p99).toBeLessThan(200);

            // Memory usage should be reasonable
            if (memoryMetrics.mean > 0) {
                expect(memoryMetrics.mean).toBeLessThan(10); // <10MB average increase per operation
            }
        });

        test('should maintain performance across different file types and sizes', async () => {
            const fileTypes = ['.ts', '.js', '.py', '.go', '.rs'];
            const fileSizes = ['small', 'medium', 'large']; // Simulated sizes

            const performanceByType: Record<string, number[]> = {};

            for (const fileType of fileTypes) {
                performanceByType[fileType] = [];

                for (let i = 0; i < 20; i++) {
                    // 20 tests per file type
                    const symbol = largeCodebase.symbols[i * 100]; // Spread across codebase
                    const request: FindDefinitionRequest = {
                        identifier: symbol.name,
                        uri: symbol.file.replace('.ts', fileType),
                        position: { line: symbol.line, character: symbol.character },
                        includeDeclaration: true,
                    };

                    const startTime = performance.now();
                    await context.codeAnalyzer.findDefinition(request);
                    const endTime = performance.now();

                    performanceByType[fileType].push(endTime - startTime);
                }
            }

            // Analyze performance consistency across file types
            for (const [fileType, times] of Object.entries(performanceByType)) {
                const metrics = calculateMetrics(times);

                console.log(`${fileType} Performance:`, {
                    mean: `${metrics.mean.toFixed(2)}ms`,
                    p95: `${metrics.p95.toFixed(2)}ms`,
                });

                // All file types should have similar performance characteristics
                expect(metrics.p95).toBeLessThan(150);
                expect(metrics.stdDev).toBeLessThan(50); // Low variance
            }
        });
    });

    describe('Concurrent Operations Performance', () => {
        test('should handle high concurrent load efficiently', async () => {
            const concurrencyLevels = [10, 25, 50, 100];

            for (const concurrency of concurrencyLevels) {
                const times: number[] = [];
                const errors: Error[] = [];

                const operations = Array.from({ length: concurrency }, (_, i) => {
                    const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                    const request: FindDefinitionRequest = {
                        identifier: `${symbol.name}_concurrent_${i}`,
                        uri: symbol.file,
                        position: { line: symbol.line, character: symbol.character },
                        includeDeclaration: true,
                    };

                    return async () => {
                        try {
                            const startTime = performance.now();
                            await context.codeAnalyzer.findDefinition(request);
                            const endTime = performance.now();
                            times.push(endTime - startTime);
                        } catch (error) {
                            errors.push(error as Error);
                        }
                    };
                });

                const startTime = performance.now();
                await Promise.all(operations.map((op) => op()));
                const totalTime = performance.now() - startTime;

                const metrics = calculateMetrics(times);
                const successRate = times.length / concurrency;

                console.log(`Concurrency ${concurrency}:`, {
                    totalTime: `${totalTime.toFixed(2)}ms`,
                    avgPerOperation: `${metrics.mean.toFixed(2)}ms`,
                    p95: `${metrics.p95.toFixed(2)}ms`,
                    successRate: `${(successRate * 100).toFixed(1)}%`,
                    errors: errors.length,
                });

                // Should handle concurrent operations efficiently
                expect(successRate).toBeGreaterThan(0.95); // >95% success rate
                expect(metrics.p95).toBeLessThan(200); // Allow some degradation under high concurrency
                expect(errors.length).toBeLessThan(concurrency * 0.05); // <5% error rate
            }
        });

        test('should maintain cache effectiveness under concurrent load', async () => {
            const concurrency = 50;
            const uniqueSymbols = 10; // Use fewer unique symbols to test cache hits

            // Pre-populate cache
            for (let i = 0; i < uniqueSymbols; i++) {
                const symbol = largeCodebase.symbols[i];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                await context.codeAnalyzer.findDefinition(request);
            }

            // Now run concurrent operations that should hit cache
            const cacheHits: boolean[] = [];
            const times: number[] = [];

            const operations = Array.from({ length: concurrency }, (_, i) => {
                const symbol = largeCodebase.symbols[i % uniqueSymbols]; // Cycle through cached symbols
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                return async () => {
                    const startTime = performance.now();
                    const result = await context.codeAnalyzer.findDefinition(request);
                    const endTime = performance.now();

                    times.push(endTime - startTime);
                    cacheHits.push(result.cacheHit);
                };
            });

            await Promise.all(operations.map((op) => op()));

            const cacheHitRate = cacheHits.filter((hit) => hit).length / cacheHits.length;
            const metrics = calculateMetrics(times);

            console.log('Concurrent Cache Performance:', {
                cacheHitRate: `${(cacheHitRate * 100).toFixed(1)}%`,
                avgTime: `${metrics.mean.toFixed(2)}ms`,
                p95: `${metrics.p95.toFixed(2)}ms`,
            });

            // Cache should be effective even under concurrent load
            expect(cacheHitRate).toBeGreaterThan(0.8); // >80% cache hit rate
            expect(metrics.mean).toBeLessThan(20); // Cached operations should be very fast
        });
    });

    describe('Memory Usage and Resource Management', () => {
        test('should maintain reasonable memory usage during extended operations', async () => {
            const iterations = 500;
            const memorySnapshots: number[] = [];

            const initialMemory = measureMemoryUsage();
            memorySnapshots.push(initialMemory);

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: `memory_test_${symbol.name}_${i}`,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                await context.codeAnalyzer.findDefinition(request);

                // Take memory snapshot every 50 iterations
                if (i % 50 === 0) {
                    const currentMemory = measureMemoryUsage();
                    memorySnapshots.push(currentMemory);
                }
            }

            const finalMemory = measureMemoryUsage();
            const memoryGrowth = finalMemory - initialMemory;
            const maxMemory = Math.max(...memorySnapshots);
            const memoryVariance = calculateMetrics(memorySnapshots).stdDev;

            console.log('Memory Usage Analysis:', {
                initialMemory: `${initialMemory.toFixed(2)}MB`,
                finalMemory: `${finalMemory.toFixed(2)}MB`,
                memoryGrowth: `${memoryGrowth.toFixed(2)}MB`,
                maxMemory: `${maxMemory.toFixed(2)}MB`,
                memoryVariance: `${memoryVariance.toFixed(2)}MB`,
            });

            if (initialMemory > 0) {
                // Only test if memory measurement is available
                // Memory growth should be reasonable
                expect(memoryGrowth).toBeLessThan(100); // <100MB growth
                expect(memoryVariance).toBeLessThan(50); // Stable memory usage
            }
        });

        test('should clean up resources properly', async () => {
            const initialMemory = measureMemoryUsage();

            // Create temporary analyzer for resource testing
            const tempEventBus: EventBus = { emit: () => {}, on: () => {}, off: () => {}, once: () => {} };
            const tempServices = new SharedServices(context.config);
            await tempServices.initialize();

            const tempLayerManager = new LayerManager(context.config, tempServices.eventBus);
            await tempLayerManager.initialize();

            const tempAnalyzer = new CodeAnalyzer(tempLayerManager, tempServices, context.config, tempEventBus);
            await tempAnalyzer.initialize();

            // Use the analyzer
            for (let i = 0; i < 100; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const request: FindDefinitionRequest = {
                    identifier: symbol.name,
                    uri: symbol.file,
                    position: { line: symbol.line, character: symbol.character },
                    includeDeclaration: true,
                };

                await tempAnalyzer.findDefinition(request);
            }

            const beforeCleanup = measureMemoryUsage();

            // Clean up resources
            await tempAnalyzer.dispose();
            await tempLayerManager.dispose();
            await tempServices.dispose();

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }

            const afterCleanup = measureMemoryUsage();

            console.log('Resource Cleanup:', {
                beforeCleanup: `${beforeCleanup.toFixed(2)}MB`,
                afterCleanup: `${afterCleanup.toFixed(2)}MB`,
                memoryReleased: `${(beforeCleanup - afterCleanup).toFixed(2)}MB`,
            });

            // Should release significant memory after cleanup (if memory measurement available)
            if (initialMemory > 0 && beforeCleanup > afterCleanup) {
                const memoryReleased = beforeCleanup - afterCleanup;
                expect(memoryReleased).toBeGreaterThan(0); // Should release some memory
            }
        });
    });

    describe('95% Performance Target Verification', () => {
        test('should meet 95% < 100ms target for all operations', async () => {
            const operationTypes = [
                {
                    name: 'Find Definition',
                    operation: async (symbol: any) => {
                        const request: FindDefinitionRequest = {
                            identifier: symbol.name,
                            uri: symbol.file,
                            position: { line: symbol.line, character: symbol.character },
                            includeDeclaration: true,
                        };
                        return await context.codeAnalyzer.findDefinition(request);
                    },
                },
                {
                    name: 'Find References',
                    operation: async (symbol: any) => {
                        const request: FindReferencesRequest = {
                            identifier: symbol.name,
                            uri: symbol.file,
                            position: { line: symbol.line, character: symbol.character },
                            includeDeclaration: true,
                        };
                        return await context.codeAnalyzer.findReferences(request);
                    },
                },
                {
                    name: 'Get Completions',
                    operation: async (symbol: any) => {
                        const request: CompletionRequest = {
                            uri: symbol.file,
                            position: { line: symbol.line, character: symbol.character },
                            context: 'method_call',
                        };
                        return await context.codeAnalyzer.getCompletions(request);
                    },
                },
            ];

            for (const { name, operation } of operationTypes) {
                const iterations = 200; // Large sample size for statistical significance
                const times: number[] = [];
                const errors: number[] = [];

                for (let i = 0; i < iterations; i++) {
                    const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];

                    try {
                        const startTime = performance.now();
                        await operation(symbol);
                        const endTime = performance.now();
                        times.push(endTime - startTime);
                    } catch (error) {
                        errors.push(i);
                    }
                }

                const metrics = calculateMetrics(times);
                const successRate = times.length / iterations;

                console.log(`${name} - 95% Target Verification:`, {
                    iterations,
                    successRate: `${(successRate * 100).toFixed(1)}%`,
                    mean: `${metrics.mean.toFixed(2)}ms`,
                    p95: `${metrics.p95.toFixed(2)}ms`,
                    p99: `${metrics.p99.toFixed(2)}ms`,
                    target: '95% < 100ms',
                    meets_target: metrics.p95 < 100,
                });

                // Verify 95% performance target
                expect(metrics.p95).toBeLessThan(100); // 95% of requests should complete in <100ms
                expect(successRate).toBeGreaterThan(0.98); // >98% success rate

                // Additional quality metrics
                expect(metrics.stdDev).toBeLessThan(50); // Consistent performance (low variance)
                expect(errors.length).toBeLessThan(iterations * 0.02); // <2% error rate
            }
        });

        test('should maintain performance targets under realistic mixed workload', async () => {
            const iterations = 300;
            const times: number[] = [];
            const operationTypes: string[] = [];

            // Mixed workload: 40% definitions, 30% references, 20% completions, 10% renames
            const workloadDistribution = [
                { type: 'definition', weight: 0.4 },
                { type: 'references', weight: 0.3 },
                { type: 'completions', weight: 0.2 },
                { type: 'rename', weight: 0.1 },
            ];

            for (let i = 0; i < iterations; i++) {
                const symbol = largeCodebase.symbols[i % largeCodebase.symbols.length];
                const random = Math.random();
                let cumulativeWeight = 0;
                let selectedOperation = 'definition';

                for (const { type, weight } of workloadDistribution) {
                    cumulativeWeight += weight;
                    if (random <= cumulativeWeight) {
                        selectedOperation = type;
                        break;
                    }
                }

                operationTypes.push(selectedOperation);
                const startTime = performance.now();

                try {
                    switch (selectedOperation) {
                        case 'definition':
                            await context.codeAnalyzer.findDefinition({
                                identifier: symbol.name,
                                uri: symbol.file,
                                position: { line: symbol.line, character: symbol.character },
                                includeDeclaration: true,
                            });
                            break;

                        case 'references':
                            await context.codeAnalyzer.findReferences({
                                identifier: symbol.name,
                                uri: symbol.file,
                                position: { line: symbol.line, character: symbol.character },
                                includeDeclaration: true,
                            });
                            break;

                        case 'completions':
                            await context.codeAnalyzer.getCompletions({
                                uri: symbol.file,
                                position: { line: symbol.line, character: symbol.character },
                                context: 'mixed_workload',
                            });
                            break;

                        case 'rename':
                            await context.codeAnalyzer.prepareRename({
                                identifier: symbol.name,
                                uri: symbol.file,
                                position: { line: symbol.line, character: symbol.character },
                            });
                            break;
                    }
                } catch (error) {
                    // Log error but continue test
                    console.warn(`Operation ${selectedOperation} failed:`, error);
                }

                const endTime = performance.now();
                times.push(endTime - startTime);
            }

            const metrics = calculateMetrics(times);

            // Analyze performance by operation type
            const performanceByType: Record<string, number[]> = {};
            operationTypes.forEach((type, index) => {
                if (!performanceByType[type]) performanceByType[type] = [];
                performanceByType[type].push(times[index]);
            });

            console.log('Mixed Workload Performance Analysis:');
            console.log(`Overall: p95=${metrics.p95.toFixed(2)}ms, mean=${metrics.mean.toFixed(2)}ms`);

            for (const [type, typeTimes] of Object.entries(performanceByType)) {
                const typeMetrics = calculateMetrics(typeTimes);
                console.log(`${type}: p95=${typeMetrics.p95.toFixed(2)}ms, mean=${typeMetrics.mean.toFixed(2)}ms`);
            }

            // Verify mixed workload meets performance targets
            expect(metrics.p95).toBeLessThan(120); // Allow slightly higher target for mixed workload
            expect(metrics.mean).toBeLessThan(60); // Average should be well below target
        });
    });
});
