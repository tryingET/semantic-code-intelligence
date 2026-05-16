#!/usr/bin/env bun

import { ClaudeToolsLayer } from './src/layers/claude-tools.js';

async function testLayer1Direct() {
    console.log('🔍 Testing Layer 1 search directly for AsyncEnhancedGrep');

    const layer = new ClaudeToolsLayer({
        enabled: true,
        timeout: 5000,
        maxResults: 100,
        fileTypes: ['ts', 'tsx', 'js', 'jsx'],
        optimization: {
            bloomFilter: true,
            frequencyCache: true,
            parallelSearch: true,
        },
        caching: {
            enabled: true,
            ttl: 60000,
            maxSize: 1000,
        },
    });

    const searchQuery = {
        identifier: 'AsyncEnhancedGrep',
        searchPath: '.', // Search entire workspace
        fileTypes: ['typescript'],
        caseSensitive: false,
        includeTests: false,
    };

    console.log('\n📍 Searching with query:', searchQuery);

    const result = await layer.process(searchQuery);

    console.log(`\n📊 Results summary:`);
    console.log(`   Exact matches: ${result.exact?.length || 0}`);
    console.log(`   Fuzzy matches: ${result.fuzzy?.length || 0}`);
    console.log(`   Total files: ${result.files?.size || 0}`);
    console.log(`   Search time: ${result.searchTime}ms`);
    console.log(`   Tools used: ${result.toolsUsed?.join(', ')}`);

    // Look for the class definition
    const classDefinitionInExact = result.exact?.find((m) =>
        m.file.includes('src/layers/enhanced-search-tools-async.ts')
    );

    const classDefinitionInFuzzy = result.fuzzy?.find((m) =>
        m.file.includes('src/layers/enhanced-search-tools-async.ts')
    );

    if (classDefinitionInExact) {
        console.log('\n✅ Found class definition in EXACT matches:');
        console.log(`   File: ${classDefinitionInExact.file}`);
        console.log(`   Line: ${classDefinitionInExact.line}`);
        console.log(`   Text: ${classDefinitionInExact.text}`);
    } else if (classDefinitionInFuzzy) {
        console.log('\n⚠️ Found class definition in FUZZY matches:');
        console.log(`   File: ${classDefinitionInFuzzy.file}`);
        console.log(`   Line: ${classDefinitionInFuzzy.line}`);
        console.log(`   Text: ${classDefinitionInFuzzy.text}`);
    } else {
        console.log('\n❌ Class definition NOT found in src/layers/enhanced-search-tools-async.ts');
    }

    // Show all exact match locations
    console.log('\n📋 All exact match locations:');
    result.exact?.forEach((m, i) => {
        const shortPath = m.file.replace(process.cwd() + '/', '');
        console.log(`   ${i + 1}. ${shortPath}:${m.line} - ${m.text.substring(0, 80)}`);
    });
}

testLayer1Direct().catch(console.error);
