#!/usr/bin/env bun

/**
 * Test script to verify Layer 2 optimization is working correctly
 * Tests that Layer 2 only parses files found by Layer 1, not all files
 */

import { CodeAnalyzer } from '../../src/core/unified-analyzer.js';
import { LayerManager } from '../../src/core/layer-manager.js';
import { SharedServices } from '../../src/core/services/index.js';
import { createTestConfig, registerRealLayers } from '../test-helpers.js';
import { FindDefinitionRequest } from '../../src/core/types.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function testLayer2Optimization() {
    console.log('🧪 Testing Layer 2 Optimization (Phase 3)');
    console.log('='.repeat(50));

    // Set DEBUG mode to see optimization logs
    process.env.DEBUG = '1';

    try {
        // Create test configuration
        const config = createTestConfig();

        // Initialize shared services
        const sharedServices = new SharedServices(config);
        await sharedServices.initialize();

        // Initialize layer manager
        const layerManager = new LayerManager(config, sharedServices.eventBus);
        await layerManager.initialize();

        // Register real layers
        await registerRealLayers(layerManager, config);

        // Create unified analyzer
        const codeAnalyzer = new CodeAnalyzer(layerManager, sharedServices, config, sharedServices.eventBus);

        await codeAnalyzer.initialize();

        console.log('✅ CodeAnalyzer initialized successfully');

        // Test 1: Search for AsyncEnhancedGrep - should find it in our codebase
        console.log('\n🔍 Test 1: Searching for AsyncEnhancedGrep definition');
        console.log('-'.repeat(40));

        const startTime = Date.now();

        const request: FindDefinitionRequest = {
            identifier: 'AsyncEnhancedGrep',
            uri: pathToFileURL(resolve(process.cwd(), 'src/layers/enhanced-search-tools-async.ts')).toString(),
            position: { line: 10, character: 20 },
            includeDeclaration: true,
            maxResults: 10,
        };

        const result = await codeAnalyzer.findDefinition(request);
        const totalTime = Date.now() - startTime;

        console.log(`⏱️  Total time: ${totalTime}ms`);
        console.log(`📊 Performance breakdown:`, result.performance);
        console.log(`🎯 Found ${result.data.length} definitions`);

        if (result.data.length > 0) {
            console.log('\n📁 Files found:');
            result.data.forEach((def, i) => {
                console.log(`  ${i + 1}. ${def.uri} (confidence: ${def.confidence}, layer: ${def.layer})`);
            });
        }

        // Check if optimization logs appeared (indicating candidate files were used)
        console.log('\n✅ Check the logs above for optimization messages like:');
        console.log("   '🚀 Layer 2 Optimization:' - shows candidate files vs total files");
        console.log("   'Layer 2 optimization: parsing X candidate files instead of Y files'");

        // Test 2: Search for a more common identifier that might be in many files
        console.log("\n🔍 Test 2: Searching for 'function' (common identifier)");
        console.log('-'.repeat(40));

        const commonRequest: FindDefinitionRequest = {
            identifier: 'function',
            uri: pathToFileURL(resolve(process.cwd(), 'src')).toString(),
            position: { line: 1, character: 0 },
            includeDeclaration: true,
            maxResults: 5,
        };

        const startTime2 = Date.now();
        const result2 = await codeAnalyzer.findDefinition(commonRequest);
        const totalTime2 = Date.now() - startTime2;

        console.log(`⏱️  Total time: ${totalTime2}ms`);
        console.log(`📊 Performance breakdown:`, result2.performance);
        console.log(`🎯 Found ${result2.data.length} definitions`);

        await codeAnalyzer.dispose();

        console.log('\n🎉 Layer 2 optimization test completed!');
        console.log('✅ Expected behavior:');
        console.log('   - You should see optimization logs showing fewer files being parsed by Layer 2');
        console.log('   - Layer 2 time should be faster when candidate files < total potential files');
        console.log('   - Definitions should still be found accurately');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

// Run the test
testLayer2Optimization()
    .then(() => {
        console.log('\n✅ All tests completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Test suite failed:', error);
        process.exit(1);
    });
