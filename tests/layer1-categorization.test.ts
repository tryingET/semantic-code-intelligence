/**
 * Tests for Layer 1 Smart Categorization (Phase 2 of Hybrid Intelligence)
 *
 * Tests the categorizeMatch method's ability to distinguish between:
 * - likely-definition: Class/function/variable declarations
 * - likely-import: Import statements
 * - likely-usage: Function calls, constructor usage, property access
 * - unknown: Unrecognized patterns
 */

import { beforeEach, describe, expect, test } from 'bun:test';
import { ClaudeToolsLayer } from '../src/layers/claude-tools.ts';
import type { ClaudeToolsLayerConfig } from '../src/types/claude-tools.ts';
import type { MatchCategory } from '../src/types/core.ts';

// Helper to create a test ClaudeToolsLayer instance
function createTestLayer(): ClaudeToolsLayer {
    const config: ClaudeToolsLayerConfig = {
        grep: {
            enabled: true,
            defaultTimeout: 5000,
            maxResults: 100,
            contextLines: 2,
            includeHidden: false,
            followSymlinks: false,
        },
        glob: {
            enabled: true,
            defaultTimeout: 3000,
            maxFiles: 1000,
            ignorePatterns: ['node_modules', '.git'],
            includeDotfiles: false,
        },
        ls: {
            enabled: true,
            defaultTimeout: 2000,
            maxEntries: 500,
            includeDotfiles: false,
        },
        caching: {
            enabled: true,
            ttl: 300,
            maxEntries: 1000,
        },
        optimization: {
            bloomFilter: false, // Disable for tests
            prefetch: false,
            parallelSearch: true,
        },
    };

    return new ClaudeToolsLayer(config);
}

// Helper to access private categorizeMatch method via reflection
function categorizeMatch(
    layer: ClaudeToolsLayer,
    text: string,
    identifier: string
): { category: MatchCategory; confidence: number } {
    return (layer as any).categorizeMatch(text, identifier);
}

describe('Layer 1 Smart Categorization', () => {
    let layer: ClaudeToolsLayer;

    beforeEach(() => {
        layer = createTestLayer();
    });

    describe('Definition Categorization', () => {
        test('should categorize export class definitions with high confidence', () => {
            const result = categorizeMatch(layer, 'export class AsyncEnhancedGrep {', 'AsyncEnhancedGrep');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.95);
        });

        test('should categorize interface definitions', () => {
            const result = categorizeMatch(layer, 'export interface SearchOptions {', 'SearchOptions');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.95);
        });

        test('should categorize type definitions', () => {
            const result = categorizeMatch(
                layer,
                "export type MatchCategory = 'likely-definition' | 'likely-import'",
                'MatchCategory'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.95);
        });

        test('should categorize enum definitions', () => {
            const result = categorizeMatch(layer, 'export enum PatternCategory {', 'PatternCategory');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.95);
        });

        test('should categorize const variable declarations', () => {
            const result = categorizeMatch(layer, 'const searchTools = new EnhancedSearchTools({', 'searchTools');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize exported const declarations', () => {
            const result = categorizeMatch(
                layer,
                'export const asyncSearchTools = new AsyncEnhancedGrep({',
                'asyncSearchTools'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize function declarations', () => {
            const result = categorizeMatch(layer, 'function createTestLayer() {', 'createTestLayer');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize exported functions', () => {
            const result = categorizeMatch(
                layer,
                'export function categorizeMatch(text: string): MatchCategory {',
                'categorizeMatch'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize arrow function assignments', () => {
            const result = categorizeMatch(
                layer,
                'const processResults = async (results: StreamingResult[]) => {',
                'processResults'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize method definitions in classes', () => {
            const result = categorizeMatch(
                layer,
                '  async process(query: SearchQuery): Promise<EnhancedMatches> {',
                'process'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.8);
        });

        test('should categorize private methods', () => {
            const result = categorizeMatch(
                layer,
                '  private categorizeMatch(text: string, identifier: string) {',
                'categorizeMatch'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.8);
        });

        test('should categorize public methods', () => {
            const result = categorizeMatch(layer, '  public getMetrics() {', 'getMetrics');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.8);
        });
    });

    describe('Import Categorization', () => {
        test('should categorize named imports with high confidence', () => {
            const result = categorizeMatch(
                layer,
                "import { AsyncEnhancedGrep, SearchStream } from '../layers/enhanced-search-tools-async.js';",
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('likely-import');
            expect(result.confidence).toBe(0.9);
        });

        test('should categorize default imports', () => {
            const result = categorizeMatch(
                layer,
                "import AsyncEnhancedGrep from '../layers/enhanced-search-tools-async.js';",
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('likely-import');
            expect(result.confidence).toBe(0.9);
        });

        test('should categorize generic import statements', () => {
            const result = categorizeMatch(layer, "import * as searchTools from './search-tools';", 'searchTools');
            expect(result.category).toBe('likely-import');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize CommonJS require statements', () => {
            const result = categorizeMatch(
                layer,
                "const asyncSearchTools = require('./async-search');",
                'asyncSearchTools'
            );
            expect(result.category).toBe('likely-import');
            expect(result.confidence).toBe(0.85);
        });

        test('should categorize destructured require statements', () => {
            const result = categorizeMatch(
                layer,
                "const { AsyncEnhancedGrep } = require('./enhanced-search');",
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('likely-import');
            expect(result.confidence).toBe(0.85);
        });
    });

    describe('Usage Categorization', () => {
        test('should categorize constructor usage with high confidence', () => {
            const result = categorizeMatch(layer, 'const searcher = new AsyncEnhancedGrep({', 'AsyncEnhancedGrep');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.8);
        });

        test('should categorize function calls', () => {
            const result = categorizeMatch(
                layer,
                'const results = await categorizeMatch(text, identifier);',
                'categorizeMatch'
            );
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.7);
        });

        test('should categorize method calls', () => {
            const result = categorizeMatch(layer, 'layer.process(searchQuery);', 'process');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.75);
        });

        test('should categorize property assignment as usage', () => {
            const result = categorizeMatch(layer, 'result.searchTime = Date.now() - startTime;', 'searchTime');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.65);
        });

        test('should categorize chained method calls', () => {
            const result = categorizeMatch(layer, 'matches.exact.push(...convertedMatches);', 'push');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.75);
        });

        test('should distinguish usage in expressions', () => {
            const result = categorizeMatch(layer, 'if (asyncSearchTools && results.length > 0) {', 'asyncSearchTools');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.6);
        });
    });

    describe('Assignment vs Usage Detection', () => {
        test('should categorize property assignment as usage', () => {
            const result = categorizeMatch(layer, 'matches.confidence = totalMatches > 0 ?', 'confidence');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.65);
        });

        test('should categorize object property assignment as usage', () => {
            const result = categorizeMatch(layer, 'result: { searchTime: Date.now() - start }', 'searchTime');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.6);
        });
    });

    describe('Unknown Patterns', () => {
        test('should categorize unrecognizable patterns as unknown', () => {
            const result = categorizeMatch(
                layer,
                '// This is a comment mentioning AsyncEnhancedGrep',
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('unknown');
            expect(result.confidence).toBe(0.5);
        });

        test('should categorize string literals as unknown', () => {
            const result = categorizeMatch(
                layer,
                "console.log('Processing with AsyncEnhancedGrep');",
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('unknown');
            expect(result.confidence).toBe(0.5);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty text gracefully', () => {
            const result = categorizeMatch(layer, '', 'identifier');
            expect(result.category).toBe('unknown');
            expect(result.confidence).toBe(0.5);
        });

        test('should handle whitespace-only text', () => {
            const result = categorizeMatch(layer, '   \t  ', 'identifier');
            expect(result.category).toBe('unknown');
            expect(result.confidence).toBe(0.5);
        });

        test('should handle special characters in identifier', () => {
            const result = categorizeMatch(layer, 'const $specialVar = new SomeClass();', '$specialVar');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });

        test('should handle regex metacharacters in identifier', () => {
            const result = categorizeMatch(layer, 'function test$with^special+chars() {', 'test$with^special+chars');
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.85);
        });
    });

    describe('TypeScript Specific Patterns', () => {
        test('should categorize TypeScript interface implementations', () => {
            const result = categorizeMatch(layer, 'class MyClass implements SearchInterface {', 'SearchInterface');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.6);
        });

        test('should categorize generic type parameters', () => {
            const result = categorizeMatch(layer, 'class Container<T> {', 'T');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.6);
        });

        test('should categorize type annotations', () => {
            const result = categorizeMatch(
                layer,
                'function process(query: SearchQuery): Promise<Results> {',
                'SearchQuery'
            );
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.6);
        });
    });

    describe('Confidence Score Validation', () => {
        test('should return confidence scores between 0 and 1', () => {
            const testCases = [
                'export class TestClass {',
                "import { TestImport } from 'module';",
                'new TestConstructor()',
                'testMethod.call()',
                '// comment with TestComment',
            ];

            for (const testCase of testCases) {
                const result = categorizeMatch(layer, testCase, 'Test');
                expect(result.confidence).toBeGreaterThanOrEqual(0);
                expect(result.confidence).toBeLessThanOrEqual(1);
            }
        });

        test('should assign higher confidence to more specific patterns', () => {
            const exportClass = categorizeMatch(layer, 'export class MyClass {', 'MyClass');
            const usage = categorizeMatch(layer, 'new MyClass()', 'MyClass');
            const unknown = categorizeMatch(layer, '// Comment about MyClass', 'MyClass');

            expect(exportClass.confidence).toBeGreaterThan(usage.confidence);
            expect(usage.confidence).toBeGreaterThan(unknown.confidence);
        });
    });

    describe('Real-world Code Examples', () => {
        test('should correctly categorize AsyncEnhancedGrep class definition', () => {
            const result = categorizeMatch(
                layer,
                'export class AsyncEnhancedGrep extends EventEmitter {',
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('likely-definition');
            expect(result.confidence).toBe(0.95);
        });

        test('should correctly categorize AsyncEnhancedGrep import', () => {
            const result = categorizeMatch(
                layer,
                "import { AsyncEnhancedGrep } from '../layers/enhanced-search-tools-async.js';",
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('likely-import');
            expect(result.confidence).toBe(0.9);
        });

        test('should correctly categorize AsyncEnhancedGrep constructor usage', () => {
            const result = categorizeMatch(
                layer,
                'this.asyncSearchTools = new AsyncEnhancedGrep({',
                'AsyncEnhancedGrep'
            );
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.8);
        });

        test('should correctly categorize method calls in fluent interfaces', () => {
            const result = categorizeMatch(layer, 'results.filter(r => r.confidence > 0.8).map(r => r.file)', 'filter');
            expect(result.category).toBe('likely-usage');
            expect(result.confidence).toBe(0.75);
        });
    });
});
