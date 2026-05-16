import { ClaudeToolsLayer } from './src/layers/claude-tools.js';

async function test() {
    const layer = new ClaudeToolsLayer();

    const result = await layer.process({
        identifier: 'AsyncEnhanced',
        searchPath: process.cwd(),
        fileTypes: ['ts', 'js'],
        caseSensitive: false,
        includeTests: false,
    });

    console.log('Result:', JSON.stringify(result, null, 2));
}

test().catch(console.error);
