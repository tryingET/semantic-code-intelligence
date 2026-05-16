/**
 * Tests for Smart Escalation Logic (Phase 2 of Hybrid Intelligence)
 *
 * Tests the shouldEscalateToLayer2 method's ability to make intelligent
 * decisions about when to escalate from Layer 1 to Layer 2 based on
 * categorization results and confidence scores.
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Gate micro performance checks behind PERF=1 to reduce flakiness in default runs
const perfOnly = process.env.PERF === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

import { EventEmitter } from 'node:events';
import type { LayerManager } from '../src/core/layer-manager.ts';
import type { SharedServices } from '../src/core/services/index.ts';
import type { CoreConfig, Definition, DefinitionKind } from '../src/core/types.ts';
import { CodeAnalyzer } from '../src/core/unified-analyzer.ts';

// Helper to create a mock CodeAnalyzer instance for testing
function createMockAnalyzer(): CodeAnalyzer {
    const mockLayerManager = {
        initialize: mock(() => Promise.resolve()),
        getLayer: mock(() => null),
        executeWithLayer: mock(() => Promise.resolve([])),
        getDiagnostics: mock(() => ({})),
    } as unknown as LayerManager;

    const mockSharedServices = {
        initialize: mock(() => Promise.resolve()),
        cache: {
            get: mock(() => Promise.resolve(null)),
            set: mock(() => Promise.resolve()),
            clear: mock(() => Promise.resolve()),
            has: mock(() => Promise.resolve(false)),
            invalidatePattern: mock(() => Promise.resolve(0)),
        },
        database: {
            query: mock(async (sql: string) => {
                if (typeof sql === 'string' && sql.includes('sqlite_master')) {
                    if (sql.includes('evolution_events')) return [{ name: 'evolution_events' }];
                    if (sql.includes('quality_metrics')) return [{ name: 'quality_metrics' }];
                    if (sql.includes('learning_feedback')) return [{ name: 'learning_feedback' }];
                    if (sql.includes('feedback_corrections')) return [{ name: 'feedback_corrections' }];
                    return [{ name: 'sqlite_master' }];
                }
                return [];
            }),
            execute: mock(async () => ({ changes: 1 })),
            insertWithConstraintValidation: mock(async () => {}),
            transaction: mock(async (fn: any) => {
                await fn(
                    async () => [],
                    async () => {}
                );
            }),
            transactionWithConstraintValidation: mock(async (fn: any) => {
                await fn(
                    async () => [],
                    async () => {}
                );
            }),
            close: mock(async () => {}),
        },
        getDiagnostics: mock(() => ({})),
    } as unknown as SharedServices;

    const mockConfig: CoreConfig = {
        workspaceRoot: '/test',
        layers: {
            layer1: { enabled: true, timeout: 200 },
            layer2: { enabled: true, timeout: 2000 },
            layer3: { enabled: true, timeout: 100 },
            layer4: { enabled: true, timeout: 100 },
            layer5: { enabled: true, timeout: 200 },
        },
        performance: {
            caching: { enabled: true },
            parallelism: { maxConcurrency: 4 },
            timeouts: { default: 5000 },
        },
        features: {
            learning: { enabled: true },
            propagation: { enabled: true },
            analytics: { enabled: false },
        },
    };

    const mockEventBus = new EventEmitter();

    return new CodeAnalyzer(mockLayerManager, mockSharedServices, mockConfig, mockEventBus);
}

// Helper to access private shouldEscalateToLayer2 method
function shouldEscalateToLayer2(analyzer: CodeAnalyzer, definitions: Definition[]): boolean {
    return (analyzer as any).shouldEscalateToLayer2(definitions);
}

// Helper to create a Definition with categorization metadata
function createDefinition(
    name: string,
    confidence: number,
    category?: string,
    categoryConfidence?: number
): Definition {
    const def: any = {
        uri: `file:///test/${name}.ts`,
        range: {
            start: { line: 10, character: 5 },
            end: { line: 10, character: 20 },
        },
        kind: 'function' as DefinitionKind,
        name,
        source: 'exact' as const,
        confidence,
        layer: 'layer1',
    };

    if (category && categoryConfidence !== undefined) {
        def.category = category;
        def.categoryConfidence = categoryConfidence;
    }

    return def;
}

describe('Smart Escalation Logic', () => {
    let analyzer: CodeAnalyzer;

    beforeEach(async () => {
        analyzer = createMockAnalyzer();
        await analyzer.initialize();
    });

    describe('No Results Scenarios', () => {
        test('should escalate when Layer 1 found no results', () => {
            const definitions: Definition[] = [];
            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    describe('High Confidence Definition Scenarios', () => {
        test('should skip Layer 2 with multiple high-confidence definitions', () => {
            const definitions = [
                createDefinition('ClassA', 0.8, 'likely-definition', 0.95),
                createDefinition('ClassB', 0.85, 'likely-definition', 0.9),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(false);
        });

        test('should skip Layer 2 with single very high confidence definition', () => {
            const definitions = [createDefinition('MyClass', 0.9, 'likely-definition', 0.95)];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(false);
        });

        test('should skip Layer 2 with multiple likely definitions with high average confidence', () => {
            const definitions = [
                createDefinition('FuncA', 0.7, 'likely-definition', 0.85),
                createDefinition('FuncB', 0.75, 'likely-definition', 0.8),
                createDefinition('FuncC', 0.8, 'likely-definition', 0.85),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(false);
        });
    });

    describe('Medium Confidence Scenarios', () => {
        test('should escalate with medium confidence definitions', () => {
            const definitions = [createDefinition('SomeFunc', 0.6, 'likely-definition', 0.7)];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should escalate with mixed confidence levels', () => {
            const definitions = [
                createDefinition('HighConf', 0.9, 'likely-definition', 0.95),
                createDefinition('LowConf', 0.4, 'likely-definition', 0.5),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    describe('Import vs Definition Scenarios', () => {
        test('should escalate when results are primarily imports', () => {
            const definitions = [
                createDefinition('ImportedClass', 0.8, 'likely-import', 0.9),
                createDefinition('ImportedFunc', 0.85, 'likely-import', 0.85),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should escalate when results are mixed imports and usages', () => {
            const definitions = [
                createDefinition('ImportedClass', 0.8, 'likely-import', 0.9),
                createDefinition('UsageCall', 0.7, 'likely-usage', 0.75),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    describe('Usage vs Definition Scenarios', () => {
        test('should escalate when results are primarily usage', () => {
            const definitions = [
                createDefinition('MethodCall', 0.7, 'likely-usage', 0.8),
                createDefinition('PropertyAccess', 0.6, 'likely-usage', 0.65),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should skip Layer 2 when mixed with high-confidence definitions', () => {
            const definitions = [
                createDefinition('ClassDef', 0.9, 'likely-definition', 0.95),
                createDefinition('ClassUsage', 0.7, 'likely-usage', 0.75),
                createDefinition('AnotherDef', 0.85, 'likely-definition', 0.9),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(false);
        });
    });

    describe('Unknown Category Scenarios', () => {
        test('should escalate when results have unknown categories', () => {
            const definitions = [
                createDefinition('Unknown1', 0.8, 'unknown', 0.5),
                createDefinition('Unknown2', 0.75, 'unknown', 0.5),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should escalate when mixed unknown and low-confidence definitions', () => {
            const definitions = [
                createDefinition('Unknown', 0.8, 'unknown', 0.5),
                createDefinition('LowConfDef', 0.6, 'likely-definition', 0.6),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    describe('Legacy Definitions Without Categorization', () => {
        test('should escalate when definitions lack categorization metadata', () => {
            const definitions = [
                createDefinition('LegacyResult', 0.9), // No category/categoryConfidence
                createDefinition('AnotherLegacy', 0.85),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should escalate when mixed legacy and categorized results', () => {
            const definitions = [
                createDefinition('Legacy', 0.9), // No categorization
                createDefinition('Categorized', 0.85, 'likely-definition', 0.9),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    describe('Confidence Threshold Edge Cases', () => {
        test('should escalate when category confidence is high but overall confidence is low', () => {
            const definitions = [
                createDefinition('HighCat', 0.4, 'likely-definition', 0.95), // High category, low overall
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should escalate when overall confidence is high but category confidence is low', () => {
            const definitions = [
                createDefinition('LowCat', 0.9, 'likely-definition', 0.5), // Low category, high overall
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should handle exactly threshold values', () => {
            // Exactly at the thresholds: should escalate (not >= threshold)
            const definitions = [createDefinition('EdgeCase', 0.7, 'likely-definition', 0.8)];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    describe('Real-world Scenarios', () => {
        test('should skip Layer 2 for clear class definition search', () => {
            const definitions = [createDefinition('AsyncEnhancedGrep', 0.95, 'likely-definition', 0.95)];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(false);
        });

        test('should escalate for ambiguous search results', () => {
            const definitions = [
                createDefinition('process', 0.6, 'likely-usage', 0.75), // Method call
                createDefinition('process', 0.5, 'unknown', 0.5), // String mention
                createDefinition('process', 0.7, 'likely-import', 0.85), // Import from node
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });

        test('should skip Layer 2 for multiple exported functions found', () => {
            const definitions = [
                createDefinition('validateRequest', 0.85, 'likely-definition', 0.85),
                createDefinition('processRequest', 0.8, 'likely-definition', 0.85),
                createDefinition('handleRequest', 0.82, 'likely-definition', 0.83),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(false);
        });

        test('should escalate when searching for common utility functions', () => {
            const definitions = [
                createDefinition('map', 0.6, 'likely-usage', 0.7), // Array.prototype.map
                createDefinition('map', 0.5, 'likely-usage', 0.65), // Other usage
                createDefinition('map', 0.7, 'likely-definition', 0.6), // Low confidence def
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });

    perfDescribe('Performance Optimization Validation', () => {
        test('should consistently make fast decisions', () => {
            const testCases = [
                [createDefinition('Test1', 0.9, 'likely-definition', 0.95)],
                [createDefinition('Test2', 0.5, 'likely-usage', 0.6)],
                [createDefinition('Test3', 0.8, 'unknown', 0.5)],
                [],
            ];

            for (const definitions of testCases) {
                const startTime = Date.now();
                shouldEscalateToLayer2(analyzer, definitions);
                const duration = Date.now() - startTime;

                // Should complete in under 1ms
                expect(duration).toBeLessThan(1);
            }
        });

        test('should handle large numbers of definitions efficiently', () => {
            const manyDefinitions: Definition[] = [];
            for (let i = 0; i < 100; i++) {
                manyDefinitions.push(createDefinition(`Test${i}`, 0.7, 'likely-definition', 0.8));
            }

            const startTime = Date.now();
            shouldEscalateToLayer2(analyzer, manyDefinitions);
            const duration = Date.now() - startTime;

            // Should complete in under 5ms even with 100 definitions
            expect(duration).toBeLessThan(5);
        });
    });

    describe('Error Handling', () => {
        test('should handle malformed definition objects gracefully', () => {
            const malformedDefinitions = [
                {
                    // Missing required fields
                    uri: 'file:///test.ts',
                    confidence: 0.8,
                } as any,
                createDefinition('Valid', 0.9, 'likely-definition', 0.95),
            ];

            // Should not throw and should escalate due to uncertainty
            const result = shouldEscalateToLayer2(analyzer, malformedDefinitions);
            expect(result).toBe(true);
        });

        test('should handle null/undefined category metadata', () => {
            const definitions = [
                createDefinition('NullCategory', 0.8, null as any, 0.9),
                createDefinition('UndefinedCategory', 0.8, undefined as any, undefined),
            ];

            const result = shouldEscalateToLayer2(analyzer, definitions);
            expect(result).toBe(true);
        });
    });
});
