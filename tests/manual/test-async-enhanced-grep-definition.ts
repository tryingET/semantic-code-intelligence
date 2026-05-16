#!/usr/bin/env bun
/**
 * Direct test of AsyncEnhancedGrep definition finding
 * This simulates what the MCP tool would do
 */

import { Grep } from './src/layers/claude-tools.js';

async function testAsyncEnhancedGrepDefinition() {
    console.log('🧪 Testing AsyncEnhancedGrep definition finding (Layer 1)...\n');

    try {
        // Search for AsyncEnhancedGrep using the same logic Layer 1 would use
        console.log('🔍 Searching for "AsyncEnhancedGrep" using ripgrep...');

        const results = await Grep({
            pattern: 'AsyncEnhancedGrep',
            path: './src',
            output_mode: 'content',
            '-n': true,
            '-B': 1,
            '-A': 1,
        });

        console.log('📊 Raw search results:');
        console.log(results);

        // Parse and analyze results
        const lines = results.split('\n').filter((line) => line.trim());
        const matches: Array<{ file: string; lineNum: number; content: string; isDefinition: boolean }> = [];

        for (const line of lines) {
            const match = line.match(/^([^:]+):(\d+):(.*)$/);
            if (match) {
                const [, file, lineNumStr, content] = match;
                const lineNum = parseInt(lineNumStr, 10);

                // Heuristic to identify actual definitions vs usages
                const isDefinition =
                    content.includes('export class AsyncEnhancedGrep') || content.includes('class AsyncEnhancedGrep');

                matches.push({
                    file,
                    lineNum,
                    content: content.trim(),
                    isDefinition,
                });
            }
        }

        console.log('\n🎯 Analyzed matches:');
        matches.forEach((match, index) => {
            const marker = match.isDefinition ? '✅ DEFINITION' : '❓ USAGE';
            console.log(`  ${index + 1}. [${marker}] ${match.file}:${match.lineNum}`);
            console.log(`     "${match.content}"`);
        });

        const definitions = matches.filter((m) => m.isDefinition);
        const usages = matches.filter((m) => !m.isDefinition);

        console.log('\n📈 Summary:');
        console.log(`  Definitions found: ${definitions.length}`);
        console.log(`  Usages found: ${usages.length}`);
        console.log(`  Total matches: ${matches.length}`);

        // Check specific cases
        const classDefinitionAt264 = matches.find(
            (m) => m.file.includes('enhanced-search-tools-async.ts') && m.lineNum === 264
        );

        const errorMessageAt78 = matches.find(
            (m) => m.file.includes('enhanced-search-tools-async.ts') && m.lineNum === 78
        );

        console.log('\n🔍 Specific case analysis:');
        if (classDefinitionAt264) {
            console.log(`✅ Found class definition at line 264: "${classDefinitionAt264.content}"`);
            console.log(`   Correctly identified as definition: ${classDefinitionAt264.isDefinition}`);
        } else {
            console.log('❌ Class definition at line 264 NOT found');
        }

        if (errorMessageAt78) {
            console.log(`⚠️  Found error message at line 78: "${errorMessageAt78.content}"`);
            console.log(`   Correctly identified as usage: ${!errorMessageAt78.isDefinition}`);
        } else {
            console.log('✅ Error message at line 78 not found in this search');
        }

        console.log('\n🎯 Layer 1 vs Layer 2 Analysis:');
        console.log('Before fix:');
        console.log('  - Layer 1 would find both definition and error message');
        console.log('  - System would return early, missing AST analysis');
        console.log('  - Error message might be returned as "definition"');

        console.log('\nAfter fix:');
        console.log('  - Layer 1 still finds both (as expected)');
        console.log('  - System continues to Layer 2 for AST analysis');
        console.log('  - Layer 2 can distinguish true definitions from usages');
        console.log('  - Correct definition is returned');

        if (definitions.length > 0) {
            console.log('\n🎉 SUCCESS: Layer 1 can find definitions, but Layer 2 is needed for accuracy');
        } else {
            console.log('\n❌ PROBLEM: No definitions found by Layer 1');
        }
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testAsyncEnhancedGrepDefinition().catch(console.error);
