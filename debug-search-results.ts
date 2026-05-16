#!/usr/bin/env bun

import { ClaudeToolsLayer } from "./src/layers/claude-tools";
import { SearchQuery } from "./src/types/core";
import { ClaudeToolsLayerConfig } from "./src/types/claude-tools";

console.log("🔍 Debug: What is being found in searches");

const config: ClaudeToolsLayerConfig = {
    caching: { enabled: false, ttl: 300, maxEntries: 1000 },
    optimization: { bloomFilter: false, frequencyCache: true, parallelSearch: true }, // Disable bloom filter for debugging
    grep: { 
        defaultTimeout: 1000, 
        maxResults: 10, 
        contextLines: 1,
        strategies: ['exact'],
        enableRegex: true
    },
    glob: { 
        defaultTimeout: 500,
        maxFiles: 50,
        ignorePatterns: ['node_modules/**', '.git/**'],
        followSymlinks: false 
    },
    ls: { 
        defaultTimeout: 300,
        maxEntries: 50,
        includeDotfiles: false,
        includeMetadata: true
    }
};

const layer = new ClaudeToolsLayer(config);

async function debugSearchResults() {
    const query: SearchQuery = {
        identifier: "NonExistentSymbolXyZ123",
        searchPath: "./src/types",
        fileTypes: ["ts"],
        caseSensitive: true,
        includeTests: false
    };

    console.log(`\nSearching for: "${query.identifier}"`);
    console.log(`Search path: ${query.searchPath}`);
    
    const result = await layer.process(query);
    
    console.log(`\nResults Summary:`);
    console.log(`- Exact matches: ${result.exact.length}`);
    console.log(`- Fuzzy matches: ${result.fuzzy.length}`);
    console.log(`- Conceptual matches: ${result.conceptual.length}`);
    console.log(`- Search time: ${result.searchTime}ms`);
    console.log(`- Tools used: ${result.toolsUsed.join(', ')}`);
    
    console.log(`\nDetailed Exact Matches:`);
    result.exact.forEach((match, i) => {
        console.log(`  ${i + 1}. File: ${match.file}`);
        console.log(`     Line ${match.line}:${match.column}: "${match.text}"`);
        console.log(`     Confidence: ${match.confidence}`);
    });
    
    console.log(`\nDetailed Fuzzy Matches:`);
    result.fuzzy.forEach((match, i) => {
        console.log(`  ${i + 1}. File: ${match.file}`);
        console.log(`     Line ${match.line}:${match.column}: "${match.text}"`);
        console.log(`     Confidence: ${match.confidence}`);
    });
    
    console.log(`\nDetailed Conceptual Matches:`);
    result.conceptual.forEach((match, i) => {
        console.log(`  ${i + 1}. File: ${match.file}`);
        console.log(`     Line ${match.line}:${match.column}: "${match.text}"`);
        console.log(`     Confidence: ${match.confidence}`);
    });

    await layer.dispose();
}

debugSearchResults().catch(console.error);