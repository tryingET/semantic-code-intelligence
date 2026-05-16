#!/usr/bin/env bun
// Interactive MCP test to check stdio protocol compatibility

import { spawn } from 'child_process';

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

function sendMessage(method, params = {}) {
    const message = {
        jsonrpc: '2.0',
        id: messageId++,
        method,
        params,
    };

    const messageStr = JSON.stringify(message) + '\n';
    console.log(`→ Sending: ${messageStr.trim()}`);
    server.stdin.write(messageStr);
}

let buffer = '';
server.stdout.on('data', (data) => {
    buffer += data.toString();

    // Process complete lines
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
        if (line.trim()) {
            console.log(`← Received: ${line}`);
            try {
                const parsed = JSON.parse(line);
                console.log(`  Parsed: ${JSON.stringify(parsed, null, 2)}`);
            } catch (e) {
                console.log(`  Parse error: ${e.message}`);
            }
        }
    }
});

server.stderr.on('data', (data) => {
    console.log(`stderr: ${data.toString()}`);
});

server.on('close', (code) => {
    console.log(`Server exited with code ${code}`);
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
}, 500);

setTimeout(() => {
    server.stdin.end();
}, 2000);
