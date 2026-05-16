#!/usr/bin/env bun

import { ClaudeToolsLayer } from './src/layers/claude-tools';
import { SearchQuery } from './src/types/core';
import { ClaudeToolsLayerConfig } from './src/types/claude-tools';

console.log('🔍 Testing Bloom Filter Specific Functionality');

// Config with cache DISABLED to test bloom filter specifically
const config: ClaudeToolsLayerConfig = {
    caching: { enabled: false, ttl: 300, maxEntries: 1000 }, // Cache disabled
    optimization: { bloomFilter: true, frequencyCache: true, parallelSearch: true },
    grep: {
        defaultTimeout: 1000,
        maxResults: 20,
        contextLines: 1,
        strategies: ['exact'],
        enableRegex: true,
    },
    glob: {
        defaultTimeout: 500,
        maxFiles: 100,
        ignorePatterns: ['node_modules/**', '.git/**'],
        followSymlinks: false,
    },
    ls: {
        defaultTimeout: 300,
        maxEntries: 100,
        includeDotfiles: false,
        includeMetadata: true,
    },
};

const layer = new ClaudeToolsLayer(config);

async function testBloomFilterSpecific() {
    console.log('\n1. Testing negative bloom filter with cache disabled');

    // Multiple unique non-existent identifiers to test bloom filter
    const nonExistentQueries = ['UniqueNonExistent1AbCdEf', 'UniqueNonExistent2GhIjKl', 'UniqueNonExistent3MnOpQr'];

    const results = [];

    for (let i = 0; i < nonExistentQueries.length; i++) {
        const query: SearchQuery = {
            identifier: nonExistentQueries[i],
            searchPath: './src/types', // Small search space
            fileTypes: ['ts'],
            caseSensitive: true,
            includeTests: false,
        };

        console.log(`\n   Search ${i + 1}: "${query.identifier}"`);

        const result = await layer.process(query);
        results.push(result);

        console.log(`   - Total matches: ${result.exact.length + result.fuzzy.length + result.conceptual.length}`);
        console.log(`   - Search time: ${result.searchTime}ms`);
        console.log(`   - Tools used: ${result.toolsUsed.join(', ')}`);
        console.log(`   - Uses bloom filter: ${result.toolsUsed.includes('bloomFilter')}`);
    }

    console.log('\n2. Testing repeated searches to trigger bloom filter');

    // Now repeat the same searches - should use bloom filter
    for (let i = 0; i < nonExistentQueries.length; i++) {
        const query: SearchQuery = {
            identifier: nonExistentQueries[i],
            searchPath: './src/types',
            fileTypes: ['ts'],
            caseSensitive: true,
            includeTests: false,
        };

        console.log(`\n   Repeat search ${i + 1}: "${query.identifier}"`);

        const result = await layer.process(query);

        console.log(`   - Total matches: ${result.exact.length + result.fuzzy.length + result.conceptual.length}`);
        console.log(`   - Search time: ${result.searchTime}ms`);
        console.log(`   - Tools used: ${result.toolsUsed.join(', ')}`);
        console.log(`   - Uses bloom filter: ${result.toolsUsed.includes('bloomFilter')}`);

        if (result.toolsUsed.includes('bloomFilter')) {
            console.log(`   ✅ SUCCESS: Used bloom filter negative cache`);
            console.log(`   ✅ Performance: ${result.searchTime}ms (vs ${results[i].searchTime}ms original)`);
        }
    }

    console.log('\n3. Final metrics');
    const metrics = layer.getMetrics();
    console.log(`   - Total searches: ${metrics.layer.searches}`);
    console.log(`   - Cache hits: ${metrics.layer.cacheHits}`);
    console.log(`   - Bloom filter entries: ${metrics.cacheStats.bloomFilterSize}`);

    await layer.dispose();

    console.log('\n🎉 Bloom filter specific test completed');
}

testBloomFilterSpecific().catch(console.error);
