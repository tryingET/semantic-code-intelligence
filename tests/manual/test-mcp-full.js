#!/usr/bin/env bun

// Test full MCP stdio protocol
import { spawn } from 'child_process';

console.log('Testing full MCP stdio protocol...\n');

// Start MCP server
import path from 'path';

const server = spawn('bun', ['run', path.resolve(process.cwd(), 'dist/mcp/mcp.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
});

const responses = [];

// Capture server responses
server.stdout.on('data', (data) => {
    const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
    lines.forEach((line) => {
        if (line.startsWith('{"')) {
            try {
                const response = JSON.parse(line);
                responses.push(response);
                console.log('Response:', JSON.stringify(response, null, 2));
            } catch (e) {
                // Ignore non-JSON lines
            }
        }
    });
});

// Capture errors
server.stderr.on('data', (data) => {
    console.log('Server stderr:', data.toString());
});

// Send test requests
function sendRequest(request, delay = 100) {
    return new Promise((resolve) => {
        setTimeout(() => {
            console.log('Sending:', JSON.stringify(request));
            server.stdin.write(JSON.stringify(request) + '\n');
            resolve();
        }, delay);
    });
}

async function runTest() {
    try {
        // 1. Initialize
        await sendRequest({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'test', version: '1.0.0' },
            },
            id: 1,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        // 2. List tools
        await sendRequest({
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {},
            id: 2,
        });

        await new Promise((resolve) => setTimeout(resolve, 500));

        // 3. Test tool call (find_definition)
        await sendRequest({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
                name: 'find_definition',
                arguments: { symbol: 'createCodeAnalyzer' },
            },
            id: 3,
        });

        // Wait for all responses
        await new Promise((resolve) => setTimeout(resolve, 2000));

        console.log('\n=== Test Summary ===');
        console.log(`Total responses: ${responses.length}`);

        const initResponse = responses.find((r) => r.id === 1);
        const toolsResponse = responses.find((r) => r.id === 2);
        const callResponse = responses.find((r) => r.id === 3);

        console.log('✓ Initialize:', initResponse ? 'SUCCESS' : 'FAILED');
        console.log('✓ List tools:', toolsResponse ? 'SUCCESS' : 'FAILED');
        console.log('✓ Tool call:', callResponse ? 'SUCCESS' : 'FAILED');

        if (toolsResponse && toolsResponse.result && toolsResponse.result.tools) {
            console.log(`Available tools: ${toolsResponse.result.tools.length}`);
            toolsResponse.result.tools.forEach((tool) => {
                console.log(`  - ${tool.name}: ${tool.description}`);
            });
        }

        process.exit(0);
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

// Start test after brief delay
setTimeout(runTest, 100);

// Cleanup after timeout
setTimeout(() => {
    console.log('\nTest completed, shutting down...');
    server.kill();
    process.exit(0);
}, 5000);
