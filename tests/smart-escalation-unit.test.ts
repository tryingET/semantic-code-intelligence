/**
 * Unit tests for Smart Escalation Logic (Phase 2 of Hybrid Intelligence)
 *
 * Direct tests of the shouldEscalateToLayer2 method without full CodeAnalyzer initialization.
 * This tests the pure logic of the smart escalation algorithm.
 */

import { describe, expect, test } from 'bun:test';
import type { Definition, DefinitionKind } from '../src/core/types.ts';

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

// Direct implementation of the smart escalation logic for testing
function shouldEscalateToLayer2(definitions: Definition[]): boolean {
    if (definitions.length === 0) {
        return true; // No results from Layer 1, definitely need Layer 2
    }

    // Count high-confidence likely definitions
    let highConfidenceDefinitions = 0;
    let likelyDefinitions = 0;
    let totalConfidenceScore = 0;

    for (const def of definitions) {
        // Check if this definition has categorization metadata (from Layer 1)
        const hasCategory = 'category' in def && 'categoryConfidence' in def;

        if (hasCategory) {
            const category = (def as any).category;
            const categoryConfidence = (def as any).categoryConfidence || 0;

            if (category === 'likely-definition') {
                likelyDefinitions++;
                totalConfidenceScore += categoryConfidence;

                // High confidence definition: category confidence > 0.8 AND overall confidence > 0.7
                if (categoryConfidence > 0.8 && def.confidence > 0.7) {
                    highConfidenceDefinitions++;
                }
            }
        }
    }

    // Skip Layer 2 if we have multiple high-confidence definitions
    if (highConfidenceDefinitions >= 2) {
        return false;
    }

    // Skip Layer 2 if we have a single very high confidence definition
    if (highConfidenceDefinitions === 1 && likelyDefinitions === 1) {
        const avgCategoryConfidence = totalConfidenceScore / likelyDefinitions;
        if (avgCategoryConfidence > 0.9) {
            return false;
        }
    }

    // Skip Layer 2 if we have multiple likely definitions with high average confidence
    if (likelyDefinitions >= 3) {
        const avgCategoryConfidence = totalConfidenceScore / likelyDefinitions;
        if (avgCategoryConfidence > 0.8) {
            return false;
        }
    }

    // Default: escalate to Layer 2 for better precision
    return true;
}

describe('Smart Escalation Logic (Unit Tests)', () => {
    describe('No Results Scenarios', () => {
        test('should escalate when Layer 1 found no results', () => {
            const definitions: Definition[] = [];
            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('High Confidence Definition Scenarios', () => {
        test('should skip Layer 2 with multiple high-confidence definitions', () => {
            const definitions = [
                createDefinition('ClassA', 0.8, 'likely-definition', 0.95),
                createDefinition('ClassB', 0.85, 'likely-definition', 0.9),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(false);
        });

        test('should skip Layer 2 with single very high confidence definition', () => {
            const definitions = [createDefinition('MyClass', 0.9, 'likely-definition', 0.95)];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(false);
        });

        test('should skip Layer 2 with multiple likely definitions with high average confidence', () => {
            const definitions = [
                createDefinition('FuncA', 0.7, 'likely-definition', 0.85),
                createDefinition('FuncB', 0.75, 'likely-definition', 0.8),
                createDefinition('FuncC', 0.8, 'likely-definition', 0.85),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(false);
        });
    });

    describe('Medium Confidence Scenarios', () => {
        test('should escalate with medium confidence definitions', () => {
            const definitions = [createDefinition('SomeFunc', 0.6, 'likely-definition', 0.7)];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should escalate with mixed confidence levels', () => {
            const definitions = [
                createDefinition('HighConf', 0.9, 'likely-definition', 0.95),
                createDefinition('LowConf', 0.4, 'likely-definition', 0.5),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Import vs Definition Scenarios', () => {
        test('should escalate when results are primarily imports', () => {
            const definitions = [
                createDefinition('ImportedClass', 0.8, 'likely-import', 0.9),
                createDefinition('ImportedFunc', 0.85, 'likely-import', 0.85),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should escalate when results are mixed imports and usages', () => {
            const definitions = [
                createDefinition('ImportedClass', 0.8, 'likely-import', 0.9),
                createDefinition('UsageCall', 0.7, 'likely-usage', 0.75),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Usage vs Definition Scenarios', () => {
        test('should escalate when results are primarily usage', () => {
            const definitions = [
                createDefinition('MethodCall', 0.7, 'likely-usage', 0.8),
                createDefinition('PropertyAccess', 0.6, 'likely-usage', 0.65),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should skip Layer 2 when mixed with high-confidence definitions', () => {
            const definitions = [
                createDefinition('ClassDef', 0.9, 'likely-definition', 0.95),
                createDefinition('ClassUsage', 0.7, 'likely-usage', 0.75),
                createDefinition('AnotherDef', 0.85, 'likely-definition', 0.9),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(false);
        });
    });

    describe('Unknown Category Scenarios', () => {
        test('should escalate when results have unknown categories', () => {
            const definitions = [
                createDefinition('Unknown1', 0.8, 'unknown', 0.5),
                createDefinition('Unknown2', 0.75, 'unknown', 0.5),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should escalate when mixed unknown and low-confidence definitions', () => {
            const definitions = [
                createDefinition('Unknown', 0.8, 'unknown', 0.5),
                createDefinition('LowConfDef', 0.6, 'likely-definition', 0.6),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Legacy Definitions Without Categorization', () => {
        test('should escalate when definitions lack categorization metadata', () => {
            const definitions = [
                createDefinition('LegacyResult', 0.9), // No category/categoryConfidence
                createDefinition('AnotherLegacy', 0.85),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should escalate when mixed legacy and categorized results', () => {
            const definitions = [
                createDefinition('Legacy', 0.9), // No categorization
                createDefinition('Categorized', 0.85, 'likely-definition', 0.9),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Confidence Threshold Edge Cases', () => {
        test('should escalate when category confidence is high but overall confidence is low', () => {
            const definitions = [
                createDefinition('HighCat', 0.4, 'likely-definition', 0.95), // High category, low overall
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should escalate when overall confidence is high but category confidence is low', () => {
            const definitions = [
                createDefinition('LowCat', 0.9, 'likely-definition', 0.5), // Low category, high overall
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should handle exactly threshold values', () => {
            // Exactly at the thresholds: should escalate (not >= threshold)
            const definitions = [createDefinition('EdgeCase', 0.7, 'likely-definition', 0.8)];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Real-world Scenarios', () => {
        test('should skip Layer 2 for clear class definition search', () => {
            const definitions = [createDefinition('AsyncEnhancedGrep', 0.95, 'likely-definition', 0.95)];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(false);
        });

        test('should escalate for ambiguous search results', () => {
            const definitions = [
                createDefinition('process', 0.6, 'likely-usage', 0.75), // Method call
                createDefinition('process', 0.5, 'unknown', 0.5), // String mention
                createDefinition('process', 0.7, 'likely-import', 0.85), // Import from node
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });

        test('should skip Layer 2 for multiple exported functions found', () => {
            const definitions = [
                createDefinition('validateRequest', 0.85, 'likely-definition', 0.85),
                createDefinition('processRequest', 0.8, 'likely-definition', 0.85),
                createDefinition('handleRequest', 0.82, 'likely-definition', 0.83),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(false);
        });

        test('should escalate when searching for common utility functions', () => {
            const definitions = [
                createDefinition('map', 0.6, 'likely-usage', 0.7), // Array.prototype.map
                createDefinition('map', 0.5, 'likely-usage', 0.65), // Other usage
                createDefinition('map', 0.7, 'likely-definition', 0.6), // Low confidence def
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Performance and Edge Cases', () => {
        test('should handle large numbers of definitions efficiently', () => {
            const manyDefinitions: Definition[] = [];
            for (let i = 0; i < 100; i++) {
                manyDefinitions.push(createDefinition(`Test${i}`, 0.7, 'likely-definition', 0.8));
            }

            const startTime = Date.now();
            shouldEscalateToLayer2(manyDefinitions);
            const duration = Date.now() - startTime;

            // Should complete in under 5ms even with 100 definitions
            expect(duration).toBeLessThan(5);
        });

        test('should handle malformed definition objects gracefully', () => {
            const malformedDefinitions = [
                {
                    // Missing required fields
                    uri: 'file:///test.ts',
                    confidence: 0.8,
                } as any,
                createDefinition('Valid', 0.6, 'likely-definition', 0.7), // Lower confidence
            ];

            // Should not throw and should escalate due to uncertainty from malformed object
            const result = shouldEscalateToLayer2(malformedDefinitions);
            expect(result).toBe(true);
        });

        test('should handle null/undefined category metadata', () => {
            const definitions = [
                createDefinition('NullCategory', 0.8, null as any, 0.9),
                createDefinition('UndefinedCategory', 0.8, undefined as any, undefined),
            ];

            const result = shouldEscalateToLayer2(definitions);
            expect(result).toBe(true);
        });
    });

    describe('Algorithm Validation', () => {
        test('should consistently make fast decisions', () => {
            const testCases = [
                [createDefinition('Test1', 0.9, 'likely-definition', 0.95)],
                [createDefinition('Test2', 0.5, 'likely-usage', 0.6)],
                [createDefinition('Test3', 0.8, 'unknown', 0.5)],
                [],
            ];

            for (const definitions of testCases) {
                const startTime = Date.now();
                shouldEscalateToLayer2(definitions);
                const duration = Date.now() - startTime;

                // Should complete within ~1ms (allow equal due to timer granularity)
                expect(duration).toBeLessThanOrEqual(1);
            }
        });

        test('should have consistent behavior with equivalent inputs', () => {
            const definitions1 = [
                createDefinition('ClassA', 0.9, 'likely-definition', 0.95),
                createDefinition('ClassB', 0.85, 'likely-definition', 0.9),
            ];

            const definitions2 = [
                createDefinition('ClassX', 0.9, 'likely-definition', 0.95),
                createDefinition('ClassY', 0.85, 'likely-definition', 0.9),
            ];

            const result1 = shouldEscalateToLayer2(definitions1);
            const result2 = shouldEscalateToLayer2(definitions2);

            expect(result1).toBe(result2);
            expect(result1).toBe(false); // Should skip Layer 2
        });
    });
});
