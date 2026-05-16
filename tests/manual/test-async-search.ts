#!/usr/bin/env bun

import * as path from 'node:path';
import { AsyncEnhancedGrep } from './src/layers/enhanced-search-tools-async.js';

async function testAsyncSearch() {
    console.log('🔍 Testing AsyncEnhancedGrep directly');

    const searcher = new AsyncEnhancedGrep({
        maxProcesses: 2,
        cacheSize: 100,
        cacheTTL: 10000,
        defaultTimeout: 5000,
    });

    const searchOptions = {
        pattern: 'AsyncEnhancedGrep',
        path: path.resolve('src'),
        maxResults: 10,
        timeout: 5000,
        caseInsensitive: false,
        fileType: 'typescript',
    };

    console.log('Search options:', searchOptions);

    try {
        const results = await searcher.search(searchOptions);
        console.log(`Found ${results.length} results:`);
        results.forEach((result, i) => {
            console.log(`  ${i + 1}. ${result.file}:${result.line} - confidence: ${result.confidence}`);
            console.log(`     Text: ${result.text.trim()}`);
        });

        if (results.length > 0) {
            console.log('\n✅ Layer 1 search is working!');
            console.log('🎯 This means Layer 2 optimization should now work with real data');
        } else {
            console.log('\n⚠️  No results found - checking search parameters...');
        }
    } catch (error) {
        console.error('❌ Search failed:', error);
    } finally {
        searcher.destroy();
    }
}

testAsyncSearch();
