#!/usr/bin/env bun
// Simple MCP test to verify the server works correctly

import { spawn } from 'child_process';

console.log('Testing MCP server basic functionality...');

const server = spawn('bun', ['dist/mcp-fast/mcp-fast.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        SILENT_MODE: 'true',
        STDIO_MODE: 'true',
        NODE_ENV: 'production',
    },
});

let messageId = 1;
const responses = [];

function sendMessage(method, params = {}) {
    const message = {
        jsonrpc: '2.0',
        id: messageId++,
        method,
        params,
    };

    const messageStr = JSON.stringify(message) + '\n';
    console.log(`→ ${method}`);
    server.stdin.write(messageStr);

    return messageId - 1;
}

let buffer = '';
server.stdout.on('data', (data) => {
    buffer += data.toString();

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
        if (line.trim()) {
            try {
                const parsed = JSON.parse(line);
                responses.push(parsed);
                console.log(
                    `← ${parsed.id ? 'Response' : 'Notification'}: ${parsed.result ? 'SUCCESS' : parsed.error ? 'ERROR' : 'NOTIFICATION'}`
                );
                if (parsed.error) {
                    console.log(`  Error: ${JSON.stringify(parsed.error)}`);
                }
            } catch (e) {
                console.log(`  Parse error: ${e.message}`);
            }
        }
    }
});

server.stderr.on('data', (data) => {
    const stderrData = data.toString();
    if (stderrData.trim() && !stderrData.includes('Would save pipeline')) {
        console.log(`stderr: ${stderrData.trim()}`);
    }
});

server.on('close', (code) => {
    console.log(`\nTest completed. Server exited with code ${code}`);
    console.log(`Total responses: ${responses.length}`);

    // Analyze results
    const successfulResponses = responses.filter((r) => r.result && !r.error);
    const errorResponses = responses.filter((r) => r.error);

    console.log(`✅ Successful: ${successfulResponses.length}`);
    console.log(`❌ Errors: ${errorResponses.length}`);

    if (successfulResponses.length >= 2) {
        console.log('🎉 MCP server is working correctly!');
    } else {
        console.log('⚠️  MCP server may have issues');
    }
    process.exit(0);
});

// Test sequence
setTimeout(() => {
    sendMessage('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { experimental: {} },
        clientInfo: { name: 'test-client', version: '1.0.0' },
    });
}, 100);

setTimeout(() => {
    sendMessage('tools/list');
}, 1000);

setTimeout(() => {
    server.stdin.end();
}, 3000);
