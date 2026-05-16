#!/usr/bin/env bun

import { createDefaultCoreConfig } from './src/adapters/utils.js';
import { createCodeAnalyzer } from './src/core/index.js';
import type { CodeAnalyzer } from './src/core/unified-analyzer.js';

async function compareMcpVsLayer1() {
    console.log('🔬 Comparing MCP path vs direct Layer 1 search for AsyncEnhancedGrep');

    const config = createDefaultCoreConfig();
    const workspaceRoot = process.cwd();

    // Create the unified analyzer (like MCP server does)
    const coreAnalyzer: CodeAnalyzer = await createCodeAnalyzer({
        ...config,
        workspaceRoot,
    });

    await coreAnalyzer.initialize();

    try {
        // Test 1: MCP-style empty URI request
        console.log('\n🎯 Test 1: MCP-style request (empty URI)');
        const mcpRequest = {
            uri: '', // Empty URI like MCP adapter uses
            position: { line: 0, character: 0 },
            identifier: 'AsyncEnhancedGrep',
            maxResults: 100,
            includeDeclaration: true,
        };

        const mcpResult = await coreAnalyzer.findDefinition(mcpRequest);
        console.log(`MCP result: ${mcpResult.data.length} definitions found`);
        console.log(`Performance: ${JSON.stringify(mcpResult.performance)}`);

        // Check for source file
        const mcpSourceFiles = mcpResult.data.filter((d) =>
            d.uri.includes('src/layers/enhanced-search-tools-async.ts')
        );
        console.log(`MCP source file matches: ${mcpSourceFiles.length}`);
        for (const match of mcpSourceFiles.slice(0, 3)) {
            console.log(`  - Line ${match.range.start.line + 1}: ${match.kind} (confidence: ${match.confidence})`);
        }

        // Test 2: Direct async search (bypassing layers)
        console.log('\n🚀 Test 2: Direct async search (bypassing layers)');
        const asyncRequest = {
            uri: `file://${workspaceRoot}`,
            position: { line: 0, character: 0 },
            identifier: 'AsyncEnhancedGrep',
            maxResults: 100,
            includeDeclaration: true,
        };

        const asyncResult = await coreAnalyzer.findDefinitionAsync(asyncRequest);
        console.log(`Async result: ${asyncResult.data.length} definitions found`);
        console.log(`Performance: ${JSON.stringify(asyncResult.performance)}`);

        // Check for source file
        const asyncSourceFiles = asyncResult.data.filter((d) =>
            d.uri.includes('src/layers/enhanced-search-tools-async.ts')
        );
        console.log(`Async source file matches: ${asyncSourceFiles.length}`);
        for (const match of asyncSourceFiles.slice(0, 3)) {
            console.log(`  - Line ${match.range.start.line + 1}: ${match.kind} (confidence: ${match.confidence})`);
        }

        // Test 3: Compare the path resolution
        console.log('\n🔍 Test 3: Path resolution comparison');
        const extractDirectoryFromUri = (uri: string): string => {
            if (!uri || uri === '') {
                return process.cwd(); // Should return current working directory
            }
            return uri;
        };

        const mcpPath = extractDirectoryFromUri(mcpRequest.uri);
        const asyncPath = extractDirectoryFromUri(asyncRequest.uri);

        console.log(`MCP search path: "${mcpPath}"`);
        console.log(`Async search path: "${asyncPath}"`);
        console.log(`Paths match: ${mcpPath === asyncPath}`);
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await coreAnalyzer.dispose();
    }
}

compareMcpVsLayer1().catch(console.error);
