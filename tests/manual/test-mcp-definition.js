#!/usr/bin/env bun
/**
 * Test script to verify MCP find_definition tool works correctly after the fix
 */

async function testMCPDefinition() {
    console.log('🧪 Testing MCP find_definition tool with AsyncEnhancedGrep...\n');

    try {
        // Test the MCP find_definition tool
        const response = await fetch('http://localhost:7001/tools/call', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                name: 'find_definition',
                arguments: {
                    symbol: 'AsyncEnhancedGrep',
                    uri: 'file:///src/layers/enhanced-search-tools-async.ts',
                    line: 264,
                    character: 20,
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        console.log('📊 MCP Response:');
        console.log(JSON.stringify(result, null, 2));

        // Analyze the results
        if (result.content && Array.isArray(result.content)) {
            const definitions = result.content.filter(
                (item) => item.type === 'text' && item.text && item.text.includes('definition')
            );

            console.log('\n🎯 Analysis:');
            console.log(`Found ${definitions.length} definition-related results`);

            // Check if the correct line was found
            const hasLine264 = result.content.some((item) => item.text && item.text.includes('264'));

            const hasLine78 = result.content.some((item) => item.text && item.text.includes('78'));

            if (hasLine264) {
                console.log('✅ Found reference to line 264 (class definition)');
            } else {
                console.log('❌ No reference to line 264 found');
            }

            if (hasLine78) {
                console.log('⚠️  Found reference to line 78 (error message)');
            } else {
                console.log('✅ No reference to line 78 (good - error message filtered out)');
            }

            // Check for performance info
            const hasLayerInfo = result.content.some(
                (item) => item.text && (item.text.includes('layer') || item.text.includes('Layer'))
            );

            if (hasLayerInfo) {
                console.log('✅ Found layer performance information');
            }

            console.log('\n🎉 Test completed successfully!');
        } else {
            console.log('❌ Unexpected response format');
        }
    } catch (error) {
        console.error('❌ Test failed:', error);

        // Check if server is actually running
        try {
            const healthResponse = await fetch('http://localhost:7001/health');
            if (healthResponse.ok) {
                console.log('✅ MCP server is running');
            } else {
                console.log('❌ MCP server health check failed');
            }
        } catch (healthError) {
            console.log('❌ MCP server is not accessible');
            console.log('💡 Try running: just start');
        }
    }
}

// Run the test
testMCPDefinition().catch(console.error);
