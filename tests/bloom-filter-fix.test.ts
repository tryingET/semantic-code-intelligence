import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ClaudeToolsLayer } from '../src/layers/claude-tools';
import type { ClaudeToolsLayerConfig } from '../src/types/claude-tools';
import type { SearchQuery } from '../src/types/core';

describe('Bloom Filter Fix', () => {
    let layer: ClaudeToolsLayer;

    // Use optimized config with bloom filter enabled
    const config: ClaudeToolsLayerConfig = {
        caching: { enabled: true, ttl: 300, maxEntries: 1000 },
        optimization: { bloomFilter: true, frequencyCache: true, parallelSearch: true },
        grep: {
            defaultTimeout: 2000,
            maxResults: 50,
            contextLines: 2,
            strategies: ['exact', 'fuzzy', 'semantic'],
            enableRegex: true,
        },
        glob: {
            defaultTimeout: 1000,
            maxFiles: 1000,
            ignorePatterns: ['node_modules/**', '.git/**'],
            followSymlinks: false,
        },
        ls: {
            defaultTimeout: 500,
            maxEntries: 500,
            includeDotfiles: false,
            includeMetadata: true,
        },
    };

    beforeEach(async () => {
        layer = new ClaudeToolsLayer(config);
    });

    test('first-time search should work (not blocked by empty bloom filter)', async () => {
        const query: SearchQuery = {
            identifier: 'AsyncEnhancedGrep',
            searchPath: './src',
            fileTypes: ['ts'],
            caseSensitive: false,
            includeTests: false,
        };

        // This should work now - previously failed due to bloom filter blocking
        const results = await layer.process(query);

        // Should find actual results, not be blocked by bloom filter
        expect(results).toBeDefined();
        expect(results.searchTime).toBeGreaterThan(0);
        expect(results.toolsUsed).not.toContain('bloomFilter'); // First time shouldn't use bloom filter

        // We should find AsyncEnhancedGrep in the codebase
        const totalMatches = results.exact.length + results.fuzzy.length + results.conceptual.length;
        expect(totalMatches).toBeGreaterThan(0);
    });

    test('repeated search for non-existent symbol should use bloom filter negative cache', async () => {
        const nonExistentQuery: SearchQuery = {
            identifier: 'XyZ1234ThisSymbolDefinitelyDoesNotExist987654321',
            searchPath: './src',
            fileTypes: ['ts'],
            caseSensitive: false,
            includeTests: false,
        };

        // First search - should actually search and find no exact matches
        const firstResults = await layer.process(nonExistentQuery);
        expect(firstResults.exact.length).toBe(0);
        expect(firstResults.toolsUsed).not.toContain('bloomFilter'); // First search doesn't use bloom filter

        // Second search - should use bloom filter negative cache
        const secondResults = await layer.process(nonExistentQuery);
        expect(secondResults.exact.length).toBe(0);
        expect(secondResults.toolsUsed).toContain('bloomFilter'); // Should use bloom filter now
        expect(secondResults.searchTime).toBeLessThan(firstResults.searchTime); // Should be faster
    });

    test('bloom filter should not affect positive results', async () => {
        const existingQuery: SearchQuery = {
            identifier: 'SearchQuery', // This definitely exists in our codebase
            searchPath: './src',
            fileTypes: ['ts'],
            caseSensitive: false,
            includeTests: false,
        };

        // First search - should find results
        const firstResults = await layer.process(existingQuery);
        const firstTotalMatches = firstResults.exact.length + firstResults.fuzzy.length;
        expect(firstTotalMatches).toBeGreaterThan(0);

        // Second search - should still find the same results (bloom filter shouldn't interfere)
        const secondResults = await layer.process(existingQuery);
        const secondTotalMatches = secondResults.exact.length + secondResults.fuzzy.length;

        // Results should be consistent
        expect(secondTotalMatches).toBe(firstTotalMatches);

        // Second search should use cache or bloom filter for optimization
        expect(secondResults.searchTime).toBeLessThanOrEqual(firstResults.searchTime);
    });

    test('bloom filter performance benefit for negative results', async () => {
        if (!process.env.PERF) {
            // Skip expensive perf assertion unless PERF=1 is set
            const quick = await layer.process({
                identifier: 'DefinitelyDoesNotExist_PrefCheck',
                searchPath: './src',
                fileTypes: ['ts'],
                caseSensitive: false,
                includeTests: false,
            });
            expect(quick.exact.length).toBe(0);
            return;
        }
        const queries = ['XyZ9999NonExistent1QwErTy', 'AbC8888NonExistent2ZxCvBn'].map((id) => ({
            identifier: id,
            searchPath: './src',
            fileTypes: ['ts'] as string[],
            caseSensitive: false,
            includeTests: false,
        }));

        // First round - populate bloom filter
        const firstRoundTimes: number[] = [];
        for (const query of queries) {
            const result = await layer.process(query);
            firstRoundTimes.push(result.searchTime);
            // Only assert that there are no true exact matches; fuzzy/conceptual can have false positives
            expect(result.exact.length).toBe(0);
        }

        // Second round - should use bloom filter
        const secondRoundTimes: number[] = [];
        for (const query of queries) {
            const result = await layer.process(query);
            secondRoundTimes.push(result.searchTime);
            expect(result.toolsUsed).toContain('bloomFilter');
        }

        // Performance improvement check (second round should be faster on average)
        const firstAvg = firstRoundTimes.reduce((a, b) => a + b, 0) / firstRoundTimes.length;
        const secondAvg = secondRoundTimes.reduce((a, b) => a + b, 0) / secondRoundTimes.length;

        expect(secondAvg).toBeLessThan(firstAvg * 0.5); // At least 50% faster
    });

    test('metrics should reflect bloom filter usage', async () => {
        const query: SearchQuery = {
            identifier: 'ZxY4321BloomFilterMetricsTestQwErTyUi',
            searchPath: './src',
            fileTypes: ['ts'],
            caseSensitive: false,
            includeTests: false,
        };

        // Search twice
        await layer.process(query);
        await layer.process(query);

        const metrics = layer.getMetrics();
        expect(metrics.cacheStats.bloomFilterSize).toBeGreaterThan(0);
        expect(metrics.layer.searches).toBe(2);
    });

    afterEach(async () => {
        await layer.dispose();
    });
});
