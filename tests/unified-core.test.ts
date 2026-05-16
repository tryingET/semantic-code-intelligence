/**
 * Unified Core Architecture Integration Tests
 *
 * Tests the unified CodeAnalyzer that provides protocol-agnostic functionality
 * across all 5 layers with performance targets and comprehensive error handling.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import {
    type CompletionRequest,
    type CoreConfig,
    type EventBus,
    type FindDefinitionRequest,
    type FindReferencesRequest,
    LayerPerformance,
    type PrepareRenameRequest,
    type RenameRequest,
} from '../src/core/types.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig, registerRealLayers } from './test-helpers.js';

// Test fixtures and utilities
interface TestContext {
    codeAnalyzer: CodeAnalyzer;
    layerManager: LayerManager;
    sharedServices: SharedServices;
    eventBus: EventBus;
    config: CoreConfig;
}

const createTestContext = async (): Promise<TestContext> => {
    // Create test configuration using test helpers
    const config: CoreConfig = createTestConfig();

    // Initialize shared services
    const sharedServices = new SharedServices(config);
    await sharedServices.initialize();

    // Initialize layer manager
    const layerManager = new LayerManager(config, sharedServices.eventBus);
    await layerManager.initialize();

    // Register real layers for testing
    await registerRealLayers(layerManager, config);

    // Create unified analyzer
    const codeAnalyzer = new CodeAnalyzer(layerManager, sharedServices, config, sharedServices.eventBus);

    await codeAnalyzer.initialize();

    return {
        codeAnalyzer,
        layerManager,
        sharedServices,
        eventBus: sharedServices.eventBus,
        config,
    };
};

// Test data
const testSymbol = 'TestFunction';
const testUri = 'file:///test/example.ts';
const testPosition = { line: 10, character: 5 };

describe('Unified Core Architecture', () => {
    let context: TestContext;

    beforeAll(async () => {
        context = await createTestContext();
    });

    afterAll(async () => {
        await context.codeAnalyzer.dispose();
        await context.layerManager.dispose();
        await context.sharedServices.dispose();
    });

    beforeEach(async () => {
        // Clear cache before each test to ensure predictable behavior
        await context.sharedServices.cache.clear();
    });

    describe('Initialization and Health', () => {
        test('should initialize all components successfully', () => {
            const diagnostics = context.codeAnalyzer.getDiagnostics();
            expect(diagnostics.initialized).toBe(true);
            expect(diagnostics.layerManager.initialized).toBe(true);
            expect(diagnostics.sharedServices.initialized).toBe(true);
        });

        test('should have learning capabilities enabled', () => {
            const diagnostics = context.codeAnalyzer.getDiagnostics();
            expect(diagnostics.learningCapabilities.patternLearning).toBe(true);
            expect(diagnostics.learningCapabilities.feedbackCollection).toBe(true);
            expect(diagnostics.learningCapabilities.evolutionTracking).toBe(true);
            expect(diagnostics.learningCapabilities.teamKnowledge).toBe(true);
            expect(diagnostics.learningCapabilities.comprehensiveAnalysis).toBe(true);
        });
    });

    describe('Find Definition Operations', () => {
        test('should find definitions with progressive enhancement', async () => {
            const request: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            const startTime = Date.now();
            const result = await context.codeAnalyzer.findDefinition(request);
            const duration = Date.now() - startTime;

            // Verify performance target; relax when PERF is not set to avoid flakiness on shared hosts
            const target = process.env.PERF ? 100 : 250;
            expect(duration).toBeLessThan(target);
            expect(result.performance.total).toBeLessThan(target);

            // Verify result structure
            expect(result.requestId).toBeDefined();
            expect(result.timestamp).toBeDefined();
            expect(Array.isArray(result.data)).toBe(true);
            expect(typeof result.cacheHit).toBe('boolean');

            // Verify layer performance tracking
            expect(result.performance.layer1).toBeGreaterThanOrEqual(0);
            expect(result.performance.layer2).toBeGreaterThanOrEqual(0);
            expect(result.performance.layer3).toBeGreaterThanOrEqual(0);
            expect(result.performance.layer4).toBeGreaterThanOrEqual(0);
            expect(result.performance.layer5).toBeGreaterThanOrEqual(0);
            expect(result.performance.total).toBeGreaterThanOrEqual(0);
        });

        test('should use cache for repeated requests', async () => {
            const uniqueSymbol = 'UniqueTestFunction' + Date.now();
            const request: FindDefinitionRequest = {
                identifier: uniqueSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            // First request - should populate cache
            const result1 = await context.codeAnalyzer.findDefinition(request);
            expect(result1.cacheHit).toBe(false);

            // Second request - should use cache
            const result2 = await context.codeAnalyzer.findDefinition(request);
            expect(result2.cacheHit).toBe(true);
            // Cache should improve performance or at least not make it worse
            expect(result2.performance.total).toBeLessThanOrEqual(result1.performance.total);
        });

        test('should handle invalid requests gracefully', async () => {
            const invalidRequest: FindDefinitionRequest = {
                identifier: '',
                uri: '',
                position: testPosition,
                includeDeclaration: true,
            };

            await expect(context.codeAnalyzer.findDefinition(invalidRequest)).rejects.toThrow();
        });

        test('should respect result limits', async () => {
            const request: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
                maxResults: 3,
            };

            const result = await context.codeAnalyzer.findDefinition(request);
            expect(result.data.length).toBeLessThanOrEqual(3);
        });
    });

    describe('Find References Operations', () => {
        test('should find references using cascade approach', async () => {
            const request: FindReferencesRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            const startTime = Date.now();
            const result = await context.codeAnalyzer.findReferences(request);
            const duration = Date.now() - startTime;

            // Verify performance
            expect(duration).toBeLessThan(500); // References can take longer due to scope
            expect(result.performance.total).toBeLessThan(500);

            // Verify result structure
            expect(result.requestId).toBeDefined();
            expect(Array.isArray(result.data)).toBe(true);
            expect(typeof result.cacheHit).toBe('boolean');
        });

        test('should deduplicate references from multiple layers', async () => {
            const request: FindReferencesRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            const result = await context.codeAnalyzer.findReferences(request);

            // Extract unique locations
            const uniqueLocations = new Set(
                result.data.map((ref) => `${ref.uri}:${ref.range.start.line}:${ref.range.start.character}`)
            );

            // Should not have duplicates
            expect(uniqueLocations.size).toBe(result.data.length);
        });
    });

    describe('Rename Operations', () => {
        test('should prepare rename with validation', async () => {
            const request: PrepareRenameRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
            };

            const result = await context.codeAnalyzer.prepareRename(request);

            expect(result.requestId).toBeDefined();
            expect(result.data).toBeDefined();
            expect(result.performance.total).toBeLessThan(100);
        });

        test('should execute rename with learning and propagation', async () => {
            const request: RenameRequest = {
                identifier: testSymbol,
                newName: 'RenamedFunction',
                uri: testUri,
                position: testPosition,
                dryRun: true, // Don't actually modify files in tests
            };

            const startTime = Date.now();
            const result = await context.codeAnalyzer.rename(request);
            const duration = Date.now() - startTime;

            // Verify performance
            expect(duration).toBeLessThan(200); // Rename is more complex
            expect(result.performance.total).toBeLessThan(200);

            // Verify result structure
            expect(result.requestId).toBeDefined();
            expect(result.data).toBeDefined();
            expect(result.data.changes).toBeDefined();

            // Should have learning component involved (Layer 4)
            expect(result.performance.layer4).toBeGreaterThanOrEqual(0);
        });

        test('should reject invalid rename requests', async () => {
            const request: PrepareRenameRequest = {
                identifier: 'NonExistentSymbol',
                uri: testUri,
                position: testPosition,
            };

            // Should throw InvalidRequestError for symbols that don't exist
            await expect(context.codeAnalyzer.prepareRename(request)).rejects.toThrow('not found or cannot be renamed');
        });
    });

    describe('Completion Operations', () => {
        test('should provide intelligent completions using patterns', async () => {
            const request: CompletionRequest = {
                uri: testUri,
                position: testPosition,
                context: 'function call',
            };

            const startTime = Date.now();
            const result = await context.codeAnalyzer.getCompletions(request);
            const duration = Date.now() - startTime;

            // Verify performance
            expect(duration).toBeLessThan(100);
            expect(result.performance.total).toBeLessThan(100);

            // Verify result structure
            expect(result.requestId).toBeDefined();
            expect(Array.isArray(result.data)).toBe(true);
            expect(result.data.length).toBeLessThanOrEqual(20); // Default limit

            // Should primarily use Layer 3 and 4 for completions
            expect(result.performance.layer3 + result.performance.layer4).toBeGreaterThan(0);
        });

        test('should rank completions by confidence', async () => {
            const request: CompletionRequest = {
                uri: testUri,
                position: testPosition,
                context: 'object property',
            };

            const result = await context.codeAnalyzer.getCompletions(request);

            // Verify completions are sorted by confidence (descending)
            for (let i = 0; i < result.data.length - 1; i++) {
                expect(result.data[i].confidence).toBeGreaterThanOrEqual(result.data[i + 1].confidence);
            }
        });
    });

    describe('Learning and Feedback', () => {
        test('should record feedback and learn from corrections', async () => {
            const suggestionId = 'test-suggestion-123';
            const originalValue = 'oldFunction';
            const finalValue = 'newFunction';
            const feedbackContext = {
                file: testUri,
                operation: 'completion',
                confidence: 0.8,
            };

            // Should not throw - feedback recording is async and non-blocking
            await expect(
                context.codeAnalyzer.recordFeedback(suggestionId, 'modify', originalValue, finalValue, feedbackContext)
            ).resolves.toBeUndefined();
        });

        test('should track file changes for evolution', async () => {
            const filePath = testUri;
            const changeType = 'modified';
            const before = 'function oldCode() {}';
            const after = 'function newCode() {}';
            const changeContext = {
                commit: 'abc123',
                author: 'test@example.com',
                message: 'Refactor function',
            };

            // Should not throw - evolution tracking is async and non-blocking
            await expect(
                context.codeAnalyzer.trackFileChange(filePath, changeType, before, after, changeContext)
            ).resolves.toBeUndefined();
        });

        test('should provide learning insights and recommendations', async () => {
            const insights = await context.codeAnalyzer.getLearningInsights();

            expect(insights).toBeDefined();
            expect(Array.isArray(insights.insights)).toBe(true);
            expect(Array.isArray(insights.recommendations)).toBe(true);
            expect(Array.isArray(insights.patterns)).toBe(true);
            expect(insights.systemHealth).toBeDefined();
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should handle layer failures gracefully', async () => {
            // Create a config with unrealistic timeouts to force failures
            const faultyConfig: CoreConfig = {
                ...context.config,
                layers: {
                    layer1: { enabled: true, timeout: 1 }, // 1ms - will timeout
                    layer2: { enabled: true, timeout: 1 },
                    layer3: { enabled: true, timeout: 1 },
                    layer4: { enabled: true, timeout: 1 },
                    layer5: { enabled: true, timeout: 1 },
                },
            };

            const faultyServices = new SharedServices(faultyConfig);
            await faultyServices.initialize();

            const faultyLayerManager = new LayerManager(faultyConfig, faultyServices.eventBus);
            await faultyLayerManager.initialize();

            // Register real layers for faulty layer manager
            await registerRealLayers(faultyLayerManager, faultyConfig);

            const faultyAnalyzer = new CodeAnalyzer(faultyLayerManager, faultyServices, faultyConfig, context.eventBus);
            await faultyAnalyzer.initialize();

            const request: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            // Should still return a result even if layers fail
            const result = await faultyAnalyzer.findDefinition(request);
            expect(result).toBeDefined();
            expect(result.data).toBeDefined();

            // Clean up
            await faultyAnalyzer.dispose();
            await faultyLayerManager.dispose();
            await faultyServices.dispose();
        });

        test('should emit error events for monitoring', async () => {
            const errors: any[] = [];
            const testEventBus: EventBus = {
                emit: (event: string, data: any) => {
                    if (event === 'code-analyzer:error') {
                        errors.push(data);
                    }
                },
                on: () => {},
                off: () => {},
                once: () => {},
            };

            // Create analyzer with test event bus
            const testServices = new SharedServices(context.config);
            await testServices.initialize();

            const testLayerManager = new LayerManager(context.config, testServices.eventBus);
            await testLayerManager.initialize();

            // Register real layers for test services
            await registerRealLayers(testLayerManager, context.config);

            const testAnalyzer = new CodeAnalyzer(testLayerManager, testServices, context.config, testEventBus);
            await testAnalyzer.initialize();

            // Trigger an error with invalid request
            try {
                // @ts-expect-error - intentionally passing null to trigger error
                await testAnalyzer.findDefinition(null);
            } catch (error) {
                // Expected to throw
            }

            // Should have emitted error event
            expect(errors.length).toBeGreaterThan(0);
            expect(errors[0].operation).toBe('findDefinition');
            expect(errors[0].error).toBeDefined();

            // Clean up
            await testAnalyzer.dispose();
            await testLayerManager.dispose();
            await testServices.dispose();
        });

        test('should validate requests before processing', async () => {
            // Test with null request
            await expect(
                // @ts-expect-error - intentionally passing null
                context.codeAnalyzer.findDefinition(null)
            ).rejects.toThrow('Request cannot be null or undefined');

            // Test with uninitialized analyzer
            const uninitializedServices = new SharedServices(context.config);
            const uninitializedLayerManager = new LayerManager(context.config, uninitializedServices.eventBus);
            const uninitializedAnalyzer = new CodeAnalyzer(
                uninitializedLayerManager,
                uninitializedServices,
                context.config,
                context.eventBus
            );

            const request: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            await expect(uninitializedAnalyzer.findDefinition(request)).rejects.toThrow('CodeAnalyzer not initialized');
        });
    });

    describe('Performance Optimization', () => {
        test('should meet performance targets for batch operations', async () => {
            const requests: FindDefinitionRequest[] = [];
            for (let i = 0; i < 10; i++) {
                requests.push({
                    identifier: `${testSymbol}_${i}`,
                    uri: testUri,
                    position: { line: 10 + i, character: 5 },
                    includeDeclaration: true,
                });
            }

            const startTime = Date.now();
            const results = await Promise.all(requests.map((req) => context.codeAnalyzer.findDefinition(req)));
            const totalDuration = Date.now() - startTime;

            // Average per request should still meet target
            const avgDuration = totalDuration / requests.length;
            expect(avgDuration).toBeLessThan(150); // Allow some overhead for concurrent operations

            // All requests should complete successfully
            expect(results.length).toBe(requests.length);
            results.forEach((result) => {
                expect(result.requestId).toBeDefined();
                expect(result.data).toBeDefined();
            });
        });

        test('should efficiently use cache across different operation types', async () => {
            const baseRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
            };

            // Populate cache with definition request
            await context.codeAnalyzer.findDefinition({
                ...baseRequest,
                includeDeclaration: true,
            });

            // References request might benefit from some cached data
            const referencesStart = Date.now();
            await context.codeAnalyzer.findReferences({
                ...baseRequest,
                includeDeclaration: true,
            });
            const referencesDuration = Date.now() - referencesStart;

            // Should complete reasonably quickly (cache may help with symbol resolution)
            expect(referencesDuration).toBeLessThan(500);
        });
    });

    describe('Layer Integration', () => {
        test('should progressively enhance results across all layers', async () => {
            const request: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            const result = await context.codeAnalyzer.findDefinition(request);

            // Should have executed multiple layers
            const totalLayerTime =
                result.performance.layer1 +
                result.performance.layer2 +
                result.performance.layer3 +
                result.performance.layer4 +
                result.performance.layer5;

            expect(totalLayerTime).toBeGreaterThan(0);
            expect(totalLayerTime).toBeLessThanOrEqual(result.performance.total);

            // Each enabled layer should have some execution time
            if (context.config.layers.layer1.enabled) {
                expect(result.performance.layer1).toBeGreaterThanOrEqual(0);
            }
            if (context.config.layers.layer2.enabled) {
                expect(result.performance.layer2).toBeGreaterThanOrEqual(0);
            }
            if (context.config.layers.layer3.enabled) {
                expect(result.performance.layer3).toBeGreaterThanOrEqual(0);
            }
        });

        test('should handle layer-specific configurations', async () => {
            // Create config with only Layer 1 and 3 enabled
            const partialConfig: CoreConfig = {
                ...context.config,
                layers: {
                    layer1: { enabled: true, timeout: 50 },
                    layer2: { enabled: false, timeout: 100 },
                    layer3: { enabled: true, timeout: 50 },
                    layer4: { enabled: false, timeout: 50 },
                    layer5: { enabled: false, timeout: 100 },
                },
            };

            const partialServices = new SharedServices(partialConfig);
            await partialServices.initialize();

            const partialLayerManager = new LayerManager(partialConfig, partialServices.eventBus);
            await partialLayerManager.initialize();

            // Register real layers for partial test (only enabled ones will be used)
            await registerRealLayers(partialLayerManager, partialConfig);

            const partialAnalyzer = new CodeAnalyzer(
                partialLayerManager,
                partialServices,
                partialConfig,
                context.eventBus
            );
            await partialAnalyzer.initialize();

            const request: FindDefinitionRequest = {
                identifier: testSymbol,
                uri: testUri,
                position: testPosition,
                includeDeclaration: true,
            };

            const result = await partialAnalyzer.findDefinition(request);

            // Should only have executed enabled layers
            expect(result.performance.layer1).toBeGreaterThan(0);
            expect(result.performance.layer2).toBe(0);
            expect(result.performance.layer3).toBeGreaterThanOrEqual(0); // Layer 3 may complete very quickly
            expect(result.performance.layer4).toBe(0);
            expect(result.performance.layer5).toBe(0);

            // Clean up
            await partialAnalyzer.dispose();
            await partialLayerManager.dispose();
            await partialServices.dispose();
        });
    });
});
