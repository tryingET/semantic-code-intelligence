#!/usr/bin/env bun
// Test MCP server with Claude's exact connection pattern

import { spawn } from 'node:child_process';

console.log('Testing MCP server with Claude-like connection pattern...');

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
let initializeCompleted = false;
let buffer = '';

function sendMessage(method, params = {}) {
    const message = {
        jsonrpc: '2.0',
        id: messageId++,
        method,
        params,
    };

    const messageStr = JSON.stringify(message) + '\n';
    console.log(`→ Sending: ${messageStr.trim()}`);

    // Ensure we flush immediately (simulate Claude's behavior)
    server.stdin.write(messageStr);
    server.stdin.uncork();

    return messageId - 1;
}

function processResponse(line) {
    try {
        const parsed = JSON.parse(line);
        console.log(`← Response ID ${parsed.id}: ${parsed.result ? 'SUCCESS' : 'ERROR'}`);

        if (parsed.method === 'initialize' || parsed.id === 1) {
            initializeCompleted = true;
            console.log('✓ Initialize completed, sending initialized notification');

            // Send initialized notification (required by MCP protocol)
            const notification = {
                jsonrpc: '2.0',
                method: 'notifications/initialized',
            };
            const notificationStr = JSON.stringify(notification) + '\n';
            console.log(`→ Notification: ${notificationStr.trim()}`);
            server.stdin.write(notificationStr);
        }

        return parsed;
    } catch (e) {
        console.error(`Parse error: ${e.message} for line: ${line}`);
        return null;
    }
}

server.stdout.on('data', (data) => {
    buffer += data.toString();

    // Process complete lines (MCP requires line-delimited JSON)
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
        if (line.trim()) {
            processResponse(line);
        }
    }
});

server.stderr.on('data', (data) => {
    const stderrData = data.toString();
    if (stderrData.trim()) {
        console.error(`stderr: ${stderrData}`);
    }
});

server.on('error', (error) => {
    console.error(`Server process error: ${error}`);
});

server.on('close', (code, signal) => {
    console.log(`Server exited with code ${code} and signal ${signal}`);
});

// Test sequence that matches Claude's connection pattern
console.log('Starting MCP protocol handshake...');

// Step 1: Initialize (Claude sends this first)
setTimeout(() => {
    sendMessage('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
            experimental: {},
            sampling: {},
        },
        clientInfo: {
            name: 'Claude',
            version: '3.5.0',
        },
    });
}, 100);

// Step 2: After initialize, test tools/list
setTimeout(() => {
    if (initializeCompleted) {
        sendMessage('tools/list');
    } else {
        console.log('WARNING: Initialize not completed yet');
    }
}, 1000);

// Step 3: Test a tool call (this is where issues might occur)
setTimeout(() => {
    if (initializeCompleted) {
        sendMessage('tools/call', {
            name: 'find_definition',
            arguments: {
                symbol: 'FastMCPServer',
            },
        });
    }
}, 2000);

// Cleanup
setTimeout(() => {
    console.log('Test complete, closing server...');
    server.stdin.end();
}, 5000);
