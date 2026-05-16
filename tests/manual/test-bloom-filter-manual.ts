#!/usr/bin/env bun

import { ClaudeToolsLayer } from './src/layers/claude-tools';
import { SearchQuery } from './src/types/core';
import { ClaudeToolsLayerConfig } from './src/types/claude-tools';

console.log('🧪 Testing Bloom Filter Fix Manually');

// Config with bloom filter enabled
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

const layer = new ClaudeToolsLayer(config);

async function testBloomFilter() {
    console.log('\n1. Testing first-time search (should work, not blocked by bloom filter)');

    const firstQuery: SearchQuery = {
        identifier: 'AsyncEnhancedGrep', // This exists in our codebase
        searchPath: './src',
        fileTypes: ['ts'],
        caseSensitive: false,
        includeTests: false,
    };

    try {
        const firstResult = await layer.process(firstQuery);
        console.log(`✅ First-time search for "AsyncEnhancedGrep":`);
        console.log(`   - Exact matches: ${firstResult.exact.length}`);
        console.log(`   - Fuzzy matches: ${firstResult.fuzzy.length}`);
        console.log(`   - Search time: ${firstResult.searchTime}ms`);
        console.log(`   - Tools used: ${firstResult.toolsUsed.join(', ')}`);
        console.log(`   - Uses bloom filter: ${firstResult.toolsUsed.includes('bloomFilter')}`);

        if (firstResult.exact.length + firstResult.fuzzy.length > 0) {
            console.log('✅ SUCCESS: First-time search found results (bloom filter not blocking)');
        } else {
            console.log("⚠️  WARNING: No results found (may be expected if identifier doesn't exist)");
        }
    } catch (error) {
        console.error('❌ ERROR: First-time search failed:', error);
    }

    console.log('\n2. Testing bloom filter negative cache');

    // Use a completely made up identifier that shouldn't match anything
    const nonExistentQuery: SearchQuery = {
        identifier: 'ZqXmNvBcDfGhJkLpOiUyTrEwQaS',
        searchPath: './src/types', // Smaller search space
        fileTypes: ['ts'],
        caseSensitive: true, // Make it more strict
        includeTests: false,
    };

    try {
        // First search - should populate negative cache
        console.log(`\n   First search for non-existent: "${nonExistentQuery.identifier}"`);
        const firstNegativeResult = await layer.process(nonExistentQuery);
        console.log(
            `   - Total matches: ${firstNegativeResult.exact.length + firstNegativeResult.fuzzy.length + firstNegativeResult.conceptual.length}`
        );
        console.log(`   - Search time: ${firstNegativeResult.searchTime}ms`);
        console.log(`   - Uses bloom filter: ${firstNegativeResult.toolsUsed.includes('bloomFilter')}`);

        // Second search - should use bloom filter
        console.log(`\n   Second search for same non-existent identifier:`);
        const secondNegativeResult = await layer.process(nonExistentQuery);
        console.log(
            `   - Total matches: ${secondNegativeResult.exact.length + secondNegativeResult.fuzzy.length + secondNegativeResult.conceptual.length}`
        );
        console.log(`   - Search time: ${secondNegativeResult.searchTime}ms`);
        console.log(`   - Uses bloom filter: ${secondNegativeResult.toolsUsed.includes('bloomFilter')}`);

        if (secondNegativeResult.toolsUsed.includes('bloomFilter')) {
            console.log('✅ SUCCESS: Second search used bloom filter negative cache');
            if (secondNegativeResult.searchTime < firstNegativeResult.searchTime) {
                console.log('✅ SUCCESS: Bloom filter provided performance benefit');
            }
        } else {
            console.log("⚠️  WARNING: Second search didn't use bloom filter");
        }
    } catch (error) {
        console.error('❌ ERROR: Negative cache test failed:', error);
    }

    console.log('\n3. Checking bloom filter metrics');
    const metrics = layer.getMetrics();
    console.log(`   - Total searches: ${metrics.layer.searches}`);
    console.log(`   - Cache hits: ${metrics.layer.cacheHits}`);
    console.log(`   - Bloom filter entries: ${metrics.cacheStats.bloomFilterSize}`);

    await layer.dispose();

    console.log('\n🎉 Bloom filter test completed');
}

testBloomFilter().catch(console.error);
