#!/usr/bin/env bun

/**
 * Quick Performance Test for Layer Optimizations
 * Tests our timeout and performance fixes with controlled inputs
 */

import { ClaudeToolsLayer } from './src/layers/claude-tools.ts';
import { TreeSitterLayer } from './src/layers/tree-sitter.ts';

// Mock search query
const testQuery = {
    identifier: 'testFunction',
    searchPath: 'src',
    fileTypes: ['ts', 'js'],
    caseSensitive: false,
    includeTests: false,
};

// Test configuration
const testConfig = {
    grep: {
        maxResults: 50,
        defaultTimeout: 1000,
        contextLines: 2,
        useRipgrep: true,
        enableCache: true,
    },
    glob: {
        ignorePatterns: ['node_modules', '.git'],
        maxFiles: 1000,
        defaultTimeout: 500,
    },
    ls: {
        maxEntries: 1000,
        defaultTimeout: 300,
        includeDotfiles: false,
    },
    caching: {
        enabled: true,
        ttl: 300,
        maxEntries: 1000,
    },
    optimization: {
        bloomFilter: true,
        earlyTermination: true,
        parallelSearch: true,
    },
};

// Tree-sitter configuration
const treeSitterConfig = {
    languages: ['typescript', 'javascript'],
    parseTimeout: 100,
    maxFileSize: 1024 * 1024,
    cacheEnabled: true,
    cacheTTL: 300,
};

async function testLayerPerformance() {
    console.log('🧪 Testing Layer Performance Optimizations...\n');

    try {
        // Test Layer 1 (Claude Tools)
        console.log('Testing Layer 1 (ClaudeToolsLayer)...');
        const layer1 = new ClaudeToolsLayer(testConfig);

        const layer1Times = [];
        for (let i = 0; i < 5; i++) {
            const start = Date.now();
            try {
                await layer1.process(testQuery);
                const duration = Date.now() - start;
                layer1Times.push(duration);
                console.log(`  Run ${i + 1}: ${duration}ms`);
            } catch (error) {
                const duration = Date.now() - start;
                layer1Times.push(duration);
                console.log(`  Run ${i + 1}: ${duration}ms (timeout/error: ${error.message})`);
            }
        }

        const layer1Avg = layer1Times.reduce((a, b) => a + b, 0) / layer1Times.length;
        console.log(`  Average: ${layer1Avg.toFixed(2)}ms (target: <80ms)\n`);

        // Test Layer 2 (TreeSitter)
        console.log('Testing Layer 2 (TreeSitterLayer)...');
        const layer2 = new TreeSitterLayer(treeSitterConfig);

        // Create mock enhanced matches for Layer 2 input
        const mockMatches = {
            exact: [
                {
                    file: './src/test.ts',
                    line: 10,
                    column: 5,
                    text: 'testFunction',
                    length: 12,
                    confidence: 1.0,
                    source: 'exact',
                },
            ],
            fuzzy: [],
            conceptual: [],
            files: new Set(['./src/test.ts']),
            searchTime: 10,
            toolsUsed: ['grep'],
            confidence: 1.0,
        };

        const layer2Times = [];
        for (let i = 0; i < 5; i++) {
            const start = Date.now();
            try {
                await layer2.process(mockMatches);
                const duration = Date.now() - start;
                layer2Times.push(duration);
                console.log(`  Run ${i + 1}: ${duration}ms`);
            } catch (error) {
                const duration = Date.now() - start;
                layer2Times.push(duration);
                console.log(`  Run ${i + 1}: ${duration}ms (error: ${error.message})`);
            }
        }

        const layer2Avg = layer2Times.reduce((a, b) => a + b, 0) / layer2Times.length;
        console.log(`  Average: ${layer2Avg.toFixed(2)}ms (target: <50ms)\n`);

        // Summary
        console.log('📊 Performance Summary:');
        console.log(`Layer 1: ${layer1Avg.toFixed(2)}ms (target: <80ms) - ${layer1Avg < 80 ? '✅ PASS' : '❌ FAIL'}`);
        console.log(`Layer 2: ${layer2Avg.toFixed(2)}ms (target: <50ms) - ${layer2Avg < 50 ? '✅ PASS' : '❌ FAIL'}`);

        // Test concurrent operations
        console.log('\nTesting concurrent operations...');
        const concurrentPromises = [];
        const concurrentStart = Date.now();

        for (let i = 0; i < 5; i++) {
            concurrentPromises.push(
                layer1
                    .process({ ...testQuery, identifier: `test${i}` })
                    .catch((e) => ({ error: e.message, duration: 0 }))
            );
        }

        await Promise.allSettled(concurrentPromises);
        const concurrentDuration = Date.now() - concurrentStart;
        console.log(
            `Concurrent 5 operations: ${concurrentDuration}ms (target: <200ms) - ${concurrentDuration < 200 ? '✅ PASS' : '❌ FAIL'}`
        );

        console.log('\n✅ Performance test completed!');
    } catch (error) {
        console.error('❌ Performance test failed:', error);
    }
}

// Run the test
testLayerPerformance();
