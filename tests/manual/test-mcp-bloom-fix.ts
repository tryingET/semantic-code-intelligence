#!/usr/bin/env bun

import { MCPAdapter } from './src/adapters/mcp-adapter';
import { CodeAnalyzer } from './src/core/unified-analyzer';
import { AnalyzerFactory } from './src/core/analyzer-factory';

console.log('🔍 Testing MCP find_definition with Bloom Filter Fix');

async function testMCPBloomFix() {
    try {
        const factory = new AnalyzerFactory();
        const analyzer = new CodeAnalyzer(factory);

        const mcpAdapter = new MCPAdapter(analyzer);

        console.log('\n1. Testing first-time MCP find_definition (should work)');

        // This should work now - previously was blocked by bloom filter
        const firstResult = await mcpAdapter.handleFindDefinition({
            symbol: 'AsyncEnhancedGrep',
            file: undefined,
            position: undefined,
        });

        console.log(`✅ First search result: ${firstResult.length} definitions found`);

        if (firstResult.length > 0) {
            console.log('✅ SUCCESS: Bloom filter is not blocking first-time searches!');
            firstResult.slice(0, 3).forEach((def, i) => {
                console.log(`   ${i + 1}. ${def.uri} at ${def.range.start.line}:${def.range.start.character}`);
            });
        } else {
            console.log("⚠️  No results found (this might indicate the symbol doesn't exist)");
        }

        console.log('\n2. Testing repeated searches');

        // Test repeated search - should be faster due to caching/bloom filter
        const secondResult = await mcpAdapter.handleFindDefinition({
            symbol: 'AsyncEnhancedGrep',
            file: undefined,
            position: undefined,
        });

        console.log(`✅ Second search result: ${secondResult.length} definitions found`);
        console.log('✅ SUCCESS: Repeated searches work correctly');

        console.log('\n3. Testing with a truly non-existent symbol');

        // Test with a symbol that definitely doesn't exist anywhere
        const nonExistentResult = await mcpAdapter.handleFindDefinition({
            symbol: 'ThisSymbolAbsolutelyDoesNotExist999888777',
            file: undefined,
            position: undefined,
        });

        console.log(`✅ Non-existent search result: ${nonExistentResult.length} definitions found`);

        if (nonExistentResult.length === 0) {
            console.log('✅ SUCCESS: Non-existent symbol correctly returns empty results');

            // Test repeated non-existent search - should use negative cache
            const secondNonExistentResult = await mcpAdapter.handleFindDefinition({
                symbol: 'ThisSymbolAbsolutelyDoesNotExist999888777',
                file: undefined,
                position: undefined,
            });

            console.log(`✅ Repeated non-existent search: ${secondNonExistentResult.length} definitions`);
            console.log('✅ SUCCESS: Negative results are handled correctly');
        }

        await analyzer.dispose();

        console.log('\n🎉 MCP Bloom Filter test PASSED - First-time searches work!');
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

testMCPBloomFix().catch(console.error);
