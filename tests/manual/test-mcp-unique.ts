#!/usr/bin/env bun

/**
 * Test MCP find_definition with a unique symbol that only exists in the ontology database
 * This should trigger Layer 3 execution since Layer 1 won't find any exact matches
 */

async function testMCPLayer3Unique() {
    console.log('🧪 Testing MCP find_definition with unique symbol...');

    try {
        // First, connect to get a session
        console.log('📡 Connecting to MCP server...');

        const connectResponse = await fetch('http://localhost:7001/connect');
        if (!connectResponse.ok) {
            throw new Error(`Connection failed: ${connectResponse.status}`);
        }

        const connectionData = await connectResponse.json();
        console.log('📞 Connected to MCP server, session:', connectionData.sessionId);

        // Test the unique symbol that should only exist in the ontology database
        console.log('📡 Making find_definition request for "UniqueTestSymbol"...');
        const response = await fetch(`http://localhost:7001/tools?sessionId=${connectionData.sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                tool: 'find_definition',
                arguments: {
                    symbol: 'UniqueTestSymbol',
                },
            }),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('\n📋 MCP find_definition result for "UniqueTestSymbol":');
        console.log(JSON.stringify(result, null, 2));

        // Check if Layer 3 conceptual results are included
        if (result.content && Array.isArray(result.content)) {
            const textContent = result.content[0]?.text;
            if (textContent) {
                const parsedContent = JSON.parse(textContent);

                console.log('\n📊 Performance breakdown:');
                console.log(`  Layer 1: ${parsedContent.performance.layer1}ms`);
                console.log(`  Layer 2: ${parsedContent.performance.layer2}ms`);
                console.log(`  Layer 3: ${parsedContent.performance.layer3}ms`);
                console.log(`  Layer 4: ${parsedContent.performance.layer4}ms`);
                console.log(`  Layer 5: ${parsedContent.performance.layer5}ms`);
                console.log(`  Total: ${parsedContent.performance.total}ms`);

                // Check for conceptual results
                const conceptualResults = (parsedContent.definitions || []).filter(
                    (def: any) => def.source === 'conceptual'
                );

                if (conceptualResults.length > 0) {
                    console.log(`\n✅ SUCCESS: Found ${conceptualResults.length} conceptual results from Layer 3!`);
                    console.log('🎯 Layer 3 ontology implementation is working correctly!');

                    conceptualResults.forEach((def: any, index: number) => {
                        console.log(`\n📍 Conceptual Result ${index + 1}:`);
                        console.log(`   URI: ${def.uri}`);
                        console.log(`   Line: ${def.line}:${def.character}`);
                        console.log(`   Kind: ${def.kind}`);
                        console.log(`   Confidence: ${def.confidence}`);
                        console.log(`   Source: ${def.source}`);

                        // Check for valid URI (not file://unknown)
                        if (!def.uri.includes('unknown')) {
                            console.log(`   ✅ Valid file URI (no "file://unknown")`);
                        }
                    });
                } else if (parsedContent.performance.layer3 > 0) {
                    console.log(`\n⚠️  Layer 3 executed (${parsedContent.performance.layer3}ms) but found no matches`);
                    console.log('   This could mean the symbol exists in concepts but has no valid symbol anchors');
                } else {
                    console.log('\n⚠️  Layer 3 was not executed (0ms timing)');
                    console.log('   This suggests Layer 1 found results or there was an error');
                }
            }
        }
    } catch (error) {
        console.error('❌ MCP test failed:', error);
    }

    console.log('\n✨ Unique symbol Layer 3 test completed!');
}

// Run the test
testMCPLayer3Unique().catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
});
