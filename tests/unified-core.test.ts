/**
 * Unified Core Architecture Integration Tests
 *
 * Tests the unified CodeAnalyzer that provides protocol-agnostic functionality
 * across all 5 layers with performance targets and comprehensive error handling.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

function enforceBudget(metric: string, observedMs: number, defaultBudgetMs: number, envName: string): void {
    const explicitBudget = process.env[envName];
    const shouldEnforce = process.env.PERF === '1' || explicitBudget !== undefined;
    const budgetMs = Number(explicitBudget ?? defaultBudgetMs);
    if (shouldEnforce) {
        expect(observedMs).toBeLessThan(budgetMs);
    } else if (observedMs >= budgetMs) {
        console.warn(`[advisory] ${metric} took ${observedMs}ms; non-enforced normal-suite budget is ${budgetMs}ms`);
    }
}

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

            // Verify performance shape; enforce wall-clock targets only in explicit performance runs.
            enforceBudget('findDefinition duration', duration, 100, 'UNIFIED_CORE_FIND_DEFINITION_BUDGET_MS');
            enforceBudget(
                'findDefinition reported total',
                result.performance.total,
                100,
                'UNIFIED_CORE_FIND_DEFINITION_REPORTED_BUDGET_MS'
            );

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

            // Verify performance shape; enforce wall-clock targets only in explicit performance runs.
            enforceBudget('findReferences duration', duration, 500, 'UNIFIED_CORE_FIND_REFERENCES_BUDGET_MS');
            enforceBudget(
                'findReferences reported total',
                result.performance.total,
                500,
                'UNIFIED_CORE_FIND_REFERENCES_REPORTED_BUDGET_MS'
            );

            // Verify result structure and non-cache layered timing evidence.
            expect(result.requestId).toBeDefined();
            expect(Array.isArray(result.data)).toBe(true);
            expect(typeof result.cacheHit).toBe('boolean');
            expect(result.cacheHit).toBe(false);
            expect(result.performance.layer1).toBeGreaterThan(0);
            expect(result.performance.total).toBeGreaterThan(0);
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

        test('should account ambiguous reference result shaping as Layer 1 when escalation is disabled', async () => {
            const analyzerAny = context.codeAnalyzer as any;
            const originalSearch = analyzerAny.asyncSearchTools.search;
            const originalEscalation = (context.config.performance as any).escalation;

            const names = [
                ...Array.from({ length: 40 }, () => 'fooDominant'),
                ...Array.from({ length: 5 }, () => 'fooAlpha'),
                ...Array.from({ length: 5 }, () => 'fooBeta'),
                ...Array.from({ length: 5 }, () => 'fooGamma'),
                ...Array.from({ length: 5 }, () => 'fooDelta'),
            ];
            analyzerAny.asyncSearchTools.search = async () =>
                names.map((name, index) => ({
                    file: `/tmp/sci-reference-shaping-${index}.ts`,
                    line: index + 1,
                    column: 7,
                    text: `const ${name} = ${index};`,
                }));
            (context.config.performance as any).escalation = { policy: 'never' };

            try {
                const result = await context.codeAnalyzer.findReferences({
                    identifier: 'foo',
                    uri: 'file:///tmp/sci-reference-shaping.ts',
                    position: testPosition,
                    maxResults: 100,
                });

                expect(result.cacheHit).toBe(false);
                expect(result.data.length).toBe(40);
                expect(new Set(result.data.map((ref) => ref.name))).toEqual(new Set(['fooDominant']));
                expect(result.performance.layer1).toBeGreaterThan(0);
                expect(result.performance.layer2).toBe(0);
                expect(result.performance.total).toBe(result.performance.layer1);
            } finally {
                analyzerAny.asyncSearchTools.search = originalSearch;
                (context.config.performance as any).escalation = originalEscalation;
            }
        });
    });

    describe('Rename Operations', () => {
        test('should reject prepare rename when AST validation is unavailable', async () => {
            mkdirSync(context.config.workspaceRoot, { recursive: true });
            const renameFixture = join(context.config.workspaceRoot, 'rename-fixture.ts');
            writeFileSync(renameFixture, 'export function TestFunction() { return 1; }\n', 'utf8');
            const request: PrepareRenameRequest = {
                identifier: testSymbol,
                uri: pathToFileURL(renameFixture).href,
                position: { line: 0, character: 16 },
            };

            await expect(context.codeAnalyzer.prepareRename(request)).rejects.toThrow('not found or cannot be renamed');
        });

        test('should reject rename when AST validation is unavailable instead of returning a false no-op', async () => {
            mkdirSync(context.config.workspaceRoot, { recursive: true });
            const renameFixture = join(context.config.workspaceRoot, 'rename-execute-fixture.ts');
            writeFileSync(
                renameFixture,
                'export const ExecuteRenameSymbol = 1;\nconsole.log(ExecuteRenameSymbol);\n',
                'utf8'
            );
            const request: RenameRequest = {
                identifier: 'ExecuteRenameSymbol',
                newName: 'RenamedFunction',
                uri: pathToFileURL(renameFixture).href,
                position: { line: 0, character: 14 },
                dryRun: true,
            };

            await expect(context.codeAnalyzer.rename(request)).rejects.toThrow(
                'text-only matches are unsafe to rename'
            );
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

            // Verify performance shape; enforce wall-clock targets only in explicit performance runs.
            enforceBudget('getCompletions duration', duration, 100, 'UNIFIED_CORE_COMPLETIONS_BUDGET_MS');
            enforceBudget(
                'getCompletions reported total',
                result.performance.total,
                100,
                'UNIFIED_CORE_COMPLETIONS_REPORTED_BUDGET_MS'
            );

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

            // Average per request target remains visible but non-enforced in the normal suite.
            const avgDuration = totalDuration / requests.length;
            enforceBudget(
                'findDefinition batch average duration',
                avgDuration,
                150,
                'UNIFIED_CORE_BATCH_AVG_BUDGET_MS'
            );

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

            // Should complete reasonably quickly (cache may help with symbol resolution).
            enforceBudget(
                'cached findReferences duration',
                referencesDuration,
                500,
                'UNIFIED_CORE_CACHED_REFERENCES_BUDGET_MS'
            );
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

            // This assertion is about an actual layered execution, not a stale/cache-hit response.
            expect(result.cacheHit).toBe(false);

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
