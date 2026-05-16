#!/usr/bin/env bun

/**
 * Direct test of the unified analyzer to verify Layer 2 optimization
 */

import { CodeAnalyzer } from './src/core/unified-analyzer.js';
import { LayerManager } from './src/core/layer-manager.js';
import { SharedServices } from './src/core/services/index.js';
import { createTestConfig, registerRealLayers } from './tests/test-helpers.js';
import { FindDefinitionRequest } from './src/core/types.js';
import * as path from 'path';

async function testDirectAnalyzer() {
    console.log('🎯 Direct test of Layer 2 optimization');
    console.log('='.repeat(50));

    // Enable debug mode
    process.env.DEBUG = '1';

    try {
        const config = createTestConfig();
        const sharedServices = new SharedServices(config);
        await sharedServices.initialize();

        const layerManager = new LayerManager(config, sharedServices.eventBus);
        await layerManager.initialize();
        await registerRealLayers(layerManager, config);

        const codeAnalyzer = new CodeAnalyzer(layerManager, sharedServices, config, sharedServices.eventBus);
        await codeAnalyzer.initialize();

        // Test with actual file in our codebase
        const testFile = path.resolve('src/layers/enhanced-search-tools-async.ts');
        console.log(`\n🔍 Testing with file: ${testFile}`);

        const request: FindDefinitionRequest = {
            identifier: 'AsyncEnhancedGrep',
            uri: `file://${testFile}`,
            position: { line: 0, character: 0 },
            includeDeclaration: true,
            maxResults: 20,
        };

        console.log('🚀 Starting findDefinition call...');
        const result = await codeAnalyzer.findDefinition(request);

        console.log('\n📊 Results:');
        console.log(`   Found definitions: ${result.data.length}`);
        console.log(`   Total time: ${result.performance.total}ms`);
        console.log(`   Layer 1 time: ${result.performance.layer1}ms`);
        console.log(`   Layer 2 time: ${result.performance.layer2}ms`);

        if (result.data.length > 0) {
            console.log('\n📁 Found definitions:');
            result.data.forEach((def, i) => {
                console.log(`   ${i + 1}. ${def.uri} (layer: ${def.layer}, confidence: ${def.confidence})`);
            });
        } else {
            console.log('⚠️  No definitions found - this might indicate Layer 1 search issues');
        }

        await codeAnalyzer.dispose();
        console.log('\n✅ Test completed');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

testDirectAnalyzer().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
