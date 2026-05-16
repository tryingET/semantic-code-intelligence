#!/usr/bin/env bun

import { createDefaultCoreConfig } from './src/adapters/utils.js';
import { ClaudeToolsLayer } from './src/layers/claude-tools.js';

async function testLayer1() {
    console.log('🔍 Debugging Layer 1 search for AsyncEnhancedGrep class definition');

    const config = createDefaultCoreConfig();
    const layer = new ClaudeToolsLayer(config.layers.layer1);

    const searchQuery = {
        identifier: 'AsyncEnhancedGrep',
        searchPath: '.',
        fileTypes: ['typescript'],
        caseSensitive: false,
        includeTests: false,
    };

    console.log('Search query:', JSON.stringify(searchQuery, null, 2));

    try {
        console.log('\n⏳ Running Layer 1 search...');
        const result = await layer.process(searchQuery);

        console.log(`\n📊 Results summary:`);
        console.log(`- Exact matches: ${result.exact?.length || 0}`);
        console.log(`- Fuzzy matches: ${result.fuzzy?.length || 0}`);
        console.log(`- Conceptual matches: ${result.conceptual?.length || 0}`);
        console.log(`- Search time: ${result.searchTime}ms`);
        console.log(`- Confidence: ${result.confidence}`);
        console.log(`- Tools used: ${result.toolsUsed?.join(', ')}`);

        // Check exact matches for source file
        if (result.exact && result.exact.length > 0) {
            console.log('\n📍 Exact matches:');
            let foundSourceFile = false;
            for (const match of result.exact) {
                console.log(
                    `- ${match.file}:${match.line} (conf: ${match.confidence}) - ${match.text?.slice(0, 80)}...`
                );
                if (match.file.includes('src/layers/enhanced-search-tools-async.ts')) {
                    console.log('  ✅ Found source file in exact matches!');
                    foundSourceFile = true;
                }
            }

            if (!foundSourceFile) {
                console.log('  ❌ Source file not found in exact matches');
            }
        }

        // Check fuzzy matches for source file
        if (result.fuzzy && result.fuzzy.length > 0) {
            console.log('\n🔍 Fuzzy matches:');
            let foundSourceFile = false;
            for (const match of result.fuzzy) {
                console.log(
                    `- ${match.file}:${match.line} (conf: ${match.confidence}) - ${match.text?.slice(0, 80)}...`
                );
                if (match.file.includes('src/layers/enhanced-search-tools-async.ts')) {
                    console.log('  ✅ Found source file in fuzzy matches!');
                    foundSourceFile = true;
                }
            }

            if (!foundSourceFile) {
                console.log('  ❌ Source file not found in fuzzy matches');
            }
        }

        // Check if source file is in files set
        if (result.files) {
            console.log(`\n📁 Files found: ${result.files.size}`);
            for (const file of result.files) {
                if (file.includes('src/layers/enhanced-search-tools-async.ts')) {
                    console.log('  ✅ Source file is in files set!');
                    break;
                }
            }
        }

        // Health check
        console.log('\n🩺 Layer health check...');
        const isHealthy = await layer.healthCheck();
        console.log(`Health check: ${isHealthy ? '✅ Healthy' : '❌ Unhealthy'}`);

        // Get metrics
        console.log('\n📈 Layer metrics:');
        const metrics = layer.getMetrics();
        console.log(JSON.stringify(metrics, null, 2));

        // Dispose
        await layer.dispose();
    } catch (error) {
        console.error('❌ Layer 1 search failed:', error);
    }
}

testLayer1().catch(console.error);
