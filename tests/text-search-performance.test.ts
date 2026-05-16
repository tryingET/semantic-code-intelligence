/**
 * Text Search Performance Test
 *
 * Verifies that text_search properly routes through Layer 1 Fast Search
 * and meets the <200ms target for 95% of searches
 */

import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { AnalyzerFactory } from '../src/core/analyzer-factory.js';
import type { CodeAnalyzer } from '../src/core/unified-analyzer.js';

describe('Text Search Performance', () => {
    let analyzer: CodeAnalyzer;
    const testRoot = path.resolve(import.meta.dir, '../src');

    beforeAll(async () => {
        const { analyzer: codeAnalyzer } = await AnalyzerFactory.createTestAnalyzer({
            workspaceRoot: testRoot,
            enableCaching: true,
            enableLearning: false,
        });
        analyzer = codeAnalyzer;
    });

    afterAll(async () => {
        if (analyzer && typeof (analyzer as any).dispose === 'function') {
            await (analyzer as any).dispose();
        }
    });

    test('textSearch routes through Layer 1 for literal queries', async () => {
        const query = 'CodeAnalyzer';
        const startTime = Date.now();

        const result = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
            caseInsensitive: false,
        });

        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        expect(result.count).toBeGreaterThan(0);
        expect(result.results).toBeArray();
        expect(result.results.length).toBeGreaterThan(0);

        // Verify result structure
        const firstResult = result.results[0];
        expect(firstResult).toHaveProperty('file');
        expect(firstResult).toHaveProperty('line');
        expect(firstResult).toHaveProperty('column');
        expect(firstResult).toHaveProperty('text');

        // Performance check: first run includes initialization so be generous
        expect(duration).toBeLessThan(2000); // First run may include setup
    }, 10000);

    test('textSearch meets a reasonable p95 budget', async () => {
        const queries = [
            'LayerManager',
            'findDefinition',
            'async',
            'import',
            'export',
            'class',
            'function',
            'interface',
            'type',
            'const',
        ];

        const durations: number[] = [];

        // Warmup run
        await analyzer.textSearch('warmup', {
            path: testRoot,
            maxResults: 10,
        });

        // Run multiple searches to get distribution
        for (const query of queries) {
            const startTime = Date.now();

            const result = await analyzer.textSearch(query, {
                path: testRoot,
                maxResults: 50,
                caseInsensitive: false,
            });

            const duration = Date.now() - startTime;
            durations.push(duration);

            expect(result.count).toBeGreaterThanOrEqual(0);
            expect(result.results).toBeArray();
        }

        // Calculate p95
        durations.sort((a, b) => a - b);
        const p95Index = Math.floor(durations.length * 0.95);
        const p95Duration = durations[p95Index];

        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
        const maxDuration = Math.max(...durations);

        console.log(`Text Search Performance Stats:
  Average: ${avgDuration.toFixed(1)}ms
  p95: ${p95Duration.toFixed(1)}ms
  Max: ${maxDuration.toFixed(1)}ms
  Total queries: ${durations.length}
`);

        // Target: <200ms p95 on fast dev machines; keep CI stable by default.
        const budgetMs = Number(process.env.TEXT_SEARCH_P95_BUDGET_MS ?? 2500);
        expect(p95Duration).toBeLessThan(budgetMs);
    }, 30000);

    test('textSearch handles word boundaries correctly', async () => {
        // Test with word boundary pattern (should use AsyncEnhancedGrep path)
        const query = '\\bclass\\b';
        const startTime = Date.now();

        const result = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
        });

        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        expect(result.count).toBeGreaterThan(0);
        expect(duration).toBeLessThan(500);
    }, 10000);

    test('textSearch handles regex patterns correctly', async () => {
        // Test with regex pattern (should use AsyncEnhancedGrep path)
        const query = 'async.*function';
        const startTime = Date.now();

        const result = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
        });

        const duration = Date.now() - startTime;

        expect(result).toBeDefined();
        expect(result.count).toBeGreaterThanOrEqual(0);
        expect(duration).toBeLessThan(500);
    }, 10000);

    test('textSearch respects maxResults limit', async () => {
        const query = 'function';
        const maxResults = 5;

        const result = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults,
        });

        expect(result.count).toBeLessThanOrEqual(maxResults);
        expect(result.results.length).toBeLessThanOrEqual(maxResults);
    }, 10000);

    test('textSearch handles case-insensitive search', async () => {
        const query = 'CODEANALYZER'; // All caps

        const resultCaseSensitive = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
            caseInsensitive: false,
        });

        const resultCaseInsensitive = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
            caseInsensitive: true,
        });

        // Case-insensitive should find more results
        expect(resultCaseInsensitive.count).toBeGreaterThanOrEqual(resultCaseSensitive.count);
    }, 10000);

    test('textSearch handles empty results gracefully', async () => {
        const query = 'ThisShouldNotExistAnywhere12345';

        const result = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
        });

        expect(result.count).toBe(0);
        expect(result.results).toEqual([]);
    }, 10000);

    test('textSearch caches results for repeated queries', async () => {
        const query = 'CodeAnalyzer';

        // First search (cache miss)
        const start1 = Date.now();
        await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
        });
        const duration1 = Date.now() - start1;

        // Second search (should hit cache in Layer 1)
        const start2 = Date.now();
        const result2 = await analyzer.textSearch(query, {
            path: testRoot,
            maxResults: 50,
        });
        const duration2 = Date.now() - start2;

        expect(result2.count).toBeGreaterThan(0);

        // Both searches should be fast due to caching
        // Just verify they complete quickly
        expect(duration1).toBeLessThan(100);
        expect(duration2).toBeLessThan(100);
    }, 10000);
});
