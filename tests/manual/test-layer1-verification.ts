#!/usr/bin/env bun

import { createDefaultCoreConfig } from './src/adapters/utils.js';
import { ClaudeToolsLayer } from './src/layers/claude-tools.js';

async function testLayer1() {
    console.log('🔍 Testing Layer 1 for AsyncEnhancedGrep class definition');

    const config = createDefaultCoreConfig();
    const layer = new ClaudeToolsLayer(config.layers.layer1);

    const result = await layer.process({
        identifier: 'AsyncEnhancedGrep',
        searchPath: '.',
        fileTypes: ['typescript'],
        caseSensitive: false,
        includeTests: true, // Include all files to see what's happening
    });

    console.log('\n📊 Results:');
    console.log(`Total exact matches: ${result.exact?.length || 0}`);

    // Check for the class definition
    const classDefinition = result.exact?.find(
        (m) => m.file.includes('src/layers/enhanced-search-tools-async.ts') && m.line === 264
    );

    if (classDefinition) {
        console.log('✅ Found class definition at line 264 in src/layers/enhanced-search-tools-async.ts');
    } else {
        console.log('❌ Class definition NOT found at expected location');

        // Show what paths are being returned
        console.log('\nSample file paths returned:');
        result.exact?.slice(0, 5).forEach((m) => {
            console.log(`  ${m.file}`);
        });

        // Try different path patterns
        const srcMatches = result.exact?.filter(
            (m) => m.file.includes('src/') || m.file.includes('./src/') || m.file.startsWith('src/')
        );
        console.log(`\nMatches found with src/ in path: ${srcMatches?.length || 0}`);
        srcMatches?.slice(0, 5).forEach((m) => {
            console.log(`  ${m.file}:${m.line} - ${m.text.substring(0, 60)}`);
        });

        // Check for enhanced-search-tools-async.ts specifically
        const enhancedSearchFile = result.exact?.filter((m) => m.file.includes('enhanced-search-tools-async'));
        console.log(`\nMatches in enhanced-search-tools-async.ts: ${enhancedSearchFile?.length || 0}`);
        enhancedSearchFile?.slice(0, 3).forEach((m) => {
            console.log(`  ${m.file}:${m.line}`);
        });
    }
}

testLayer1().catch(console.error);
