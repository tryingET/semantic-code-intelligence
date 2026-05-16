#!/usr/bin/env bun

/**
 * Quick verification script for Layer 2 AST Processing Error fix
 */

import { Layer2Adapter } from './src/core/analyzer-factory.js';

async function testLayer2Fix() {
    console.log('Testing Layer 2 adapter fix...');

    try {
        // Create Layer 2 adapter with minimal config
        const layer2 = new Layer2Adapter({
            enabled: true,
            timeout: 50000,
            languages: ['typescript'],
            maxFileSize: 1024 * 1024, // 1MB
            parseTimeout: 5000,
        });

        console.log('✓ Layer 2 adapter created successfully');
        console.log(`✓ Layer name: ${layer2.name}`);
        console.log(`✓ Target latency: ${layer2.targetLatency}ms`);

        // Check if the process method exists
        if (typeof layer2.process === 'function') {
            console.log('✓ process() method exists on Layer2Adapter');
        } else {
            console.log('✗ process() method is missing on Layer2Adapter');
            return false;
        }

        // Test with minimal matches data to see if method can be called
        const testMatches = {
            exact: [],
            fuzzy: [],
            conceptual: [],
            files: new Set(),
            searchTime: 0,
        };

        console.log('Testing process() method call...');

        // This should not throw "layer.process is not a function" error
        const result = await layer2.process(testMatches);

        console.log('✓ process() method called successfully');
        console.log(
            `✓ Result structure: nodes=${result.nodes?.length || 0}, relationships=${result.relationships?.length || 0}, patterns=${result.patterns?.length || 0}`
        );

        return true;
    } catch (error) {
        console.log('✗ Error testing Layer 2 adapter:', error.message);
        return false;
    }
}

// Run the test
testLayer2Fix()
    .then((success) => {
        if (success) {
            console.log('\n🎉 Layer 2 AST Processing Error fix verified successfully!');
            process.exit(0);
        } else {
            console.log('\n❌ Layer 2 AST Processing Error fix failed');
            process.exit(1);
        }
    })
    .catch((error) => {
        console.error('Test execution failed:', error);
        process.exit(1);
    });
