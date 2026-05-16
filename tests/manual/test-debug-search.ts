#!/usr/bin/env bun

import { AsyncEnhancedGrep } from './src/layers/enhanced-search-tools-async.js';

async function testSearch() {
    console.log('Current working directory:', process.cwd());

    const asyncSearchTools = new AsyncEnhancedGrep({
        maxProcesses: 2,
        cacheSize: 100,
        cacheTTL: 30000,
        defaultTimeout: 5000,
    });

    try {
        console.log('Testing search with AsyncEnhancedGrep...');

        const searchOptions = {
            pattern: '\\bAsyncEnhancedGrep\\b',
            path: '.',
            maxResults: 50,
            timeout: 5000,
            caseInsensitive: false,
            fileType: 'ts',
        };

        console.log('Search options:', JSON.stringify(searchOptions, null, 2));

        const results = await asyncSearchTools.search(searchOptions);
        console.log(`Found ${results.length} results:`);

        for (const result of results) {
            console.log(`- ${result.file}:${result.line} - ${result.text.trim()}`);

            if (result.file.includes('src/layers/enhanced-search-tools-async.ts')) {
                console.log('✅ Found the source file!');
            }
        }

        // Check if we found the actual definition
        const sourceFileResults = results.filter((r) => r.file.includes('src/layers/enhanced-search-tools-async.ts'));
        console.log(`\nSource file results: ${sourceFileResults.length}`);

        if (sourceFileResults.length === 0) {
            console.log('❌ Source file not found in results');
        }
    } catch (error) {
        console.error('Search failed:', error);
    } finally {
        asyncSearchTools.destroy();
    }
}

testSearch().catch(console.error);
