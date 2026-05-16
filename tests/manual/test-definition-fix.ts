#!/usr/bin/env bun
/**
 * Test script to verify the definition fix for AsyncEnhancedGrep
 * This tests that the early return logic was removed correctly
 */

import { readFileSync } from 'node:fs';

function testCodeFix() {
    console.log('🧪 Testing AsyncEnhancedGrep definition fix...\n');

    try {
        // Read the fixed file
        const filePath = './src/core/unified-analyzer.ts';
        const fileContent = readFileSync(filePath, 'utf-8');
        const lines = fileContent.split('\n');

        console.log('🔍 Examining the fix in unified-analyzer.ts...\n');

        // Look for the old early return logic
        let oldEarlyReturnFound = false;
        let newCommentFound = false;

        const problematicLines = lines.filter((line, index) => {
            const lineNum = index + 1;

            // Check for the old early return that was removed
            if (line.includes('If we found exact matches, cache with optimized TTL and skip further layers')) {
                console.log(`❌ Found old early return comment at line ${lineNum}: ${line.trim()}`);
                oldEarlyReturnFound = true;
                return true;
            }

            if (line.includes("if (fastResults.some(d => d.source === 'exact')) {")) {
                console.log(`❌ Found old early return condition at line ${lineNum}: ${line.trim()}`);
                oldEarlyReturnFound = true;
                return true;
            }

            if (line.includes('return this.buildResult(definitions, layerTimes, requestId, startTime);')) {
                // This could be legitimate in other places, so we need context
                const prevLines = lines.slice(Math.max(0, index - 5), index);
                if (prevLines.some((l) => l.includes('exact'))) {
                    console.log(`❌ Found early return after exact match check at line ${lineNum}: ${line.trim()}`);
                    oldEarlyReturnFound = true;
                    return true;
                }
            }

            return false;
        });

        // Look for the new explanatory comment
        const commentLines = lines.filter((line, index) => {
            const lineNum = index + 1;

            if (line.includes('For definition requests, always proceed to Layer 2')) {
                console.log(`✅ Found new explanatory comment at line ${lineNum}: ${line.trim()}`);
                newCommentFound = true;
                return true;
            }

            if (line.includes("Layer 1 (ripgrep) can't distinguish between actual definitions")) {
                console.log(`✅ Found explanation about ripgrep limitation at line ${lineNum}: ${line.trim()}`);
                return true;
            }

            if (line.includes('Layer 2 (AST analysis) is needed to properly identify')) {
                console.log(`✅ Found explanation about AST analysis need at line ${lineNum}: ${line.trim()}`);
                return true;
            }

            return false;
        });

        console.log('\n📊 Analysis Results:');

        if (oldEarlyReturnFound) {
            console.log('❌ PROBLEM: Old early return logic still present');
            console.log('   The fix may not be complete or correct');
        } else {
            console.log('✅ GOOD: Old early return logic has been removed');
        }

        if (newCommentFound) {
            console.log('✅ GOOD: New explanatory comment found');
            console.log('   The code now has proper documentation for the change');
        } else {
            console.log('⚠️  NOTE: New explanatory comment not found');
        }

        // Look around line 479-484 where the change should be
        console.log('\n🔍 Code around the fix location (lines 475-490):');
        for (let i = 475; i <= 490; i++) {
            if (i >= 0 && i < lines.length) {
                const line = lines[i];
                const marker = i >= 479 && i <= 485 ? '→' : ' ';
                console.log(`${marker} ${i + 1}: ${line}`);
            }
        }

        // Check if Layer 2 execution code is present
        console.log('\n🔍 Checking Layer 2 execution section...');
        const layer2StartIndex = lines.findIndex((line) =>
            line.includes('Layer 2: AST analysis for precise structural understanding')
        );

        if (layer2StartIndex >= 0) {
            console.log(`✅ Found Layer 2 section at line ${layer2StartIndex + 1}`);

            // Check if it's properly reachable
            const layer2Section = lines.slice(layer2StartIndex, layer2StartIndex + 20);
            const hasEarlyReturn = layer2Section.some(
                (line) =>
                    line.includes('return this.buildResult') &&
                    lines[layer2StartIndex - 5] &&
                    lines[layer2StartIndex - 5].includes('exact')
            );

            if (!hasEarlyReturn) {
                console.log('✅ Layer 2 section appears to be reachable');
            } else {
                console.log('❌ Layer 2 section may still be blocked by early return');
            }
        } else {
            console.log('❌ Layer 2 section not found');
        }

        // Overall assessment
        console.log('\n🎯 Overall Assessment:');
        if (!oldEarlyReturnFound && newCommentFound) {
            console.log('🎉 SUCCESS: The fix appears to be implemented correctly!');
            console.log('   - Early return logic removed');
            console.log('   - Explanatory comments added');
            console.log('   - Layer 2 should now run for definition requests');
        } else if (!oldEarlyReturnFound) {
            console.log('✅ PARTIAL SUCCESS: Early return removed, but documentation could be better');
        } else {
            console.log('❌ FAILURE: Old early return logic still present - fix incomplete');
        }
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testCodeFix();
