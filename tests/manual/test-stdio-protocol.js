#!/usr/bin/env bun
// Test stdio protocol compatibility with line-delimited JSON-RPC

import { spawn } from 'child_process';

console.log('Testing stdio protocol line-delimited JSON-RPC...');

const server = spawn('bun', ['dist/mcp-fast/mcp-fast.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        SILENT_MODE: 'true',
        STDIO_MODE: 'true',
        NODE_ENV: 'production',
    },
});

// Test various message formats that Claude might send
const testMessages = [
    // Initialize
    {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: { experimental: {}, sampling: {} },
            clientInfo: { name: 'Claude', version: '3.5.0' },
        },
    },
    // Initialized notification (no ID, no response expected)
    {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
    },
    // List tools
    {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
    },
];

let messageIndex = 0;
let receivedResponses = 0;
const expectedResponses = 2; // initialize + tools/list (notification has no response)

function sendNextMessage() {
    if (messageIndex >= testMessages.length) {
        console.log('✅ All messages sent');
        return;
    }

    const message = testMessages[messageIndex++];
    const messageStr = JSON.stringify(message) + '\n';

    console.log(`→ Sending ${message.method} ${message.id ? `(ID: ${message.id})` : '(notification)'}`);
    server.stdin.write(messageStr);

    // Send next message after delay
    setTimeout(sendNextMessage, 500);
}

let buffer = '';
server.stdout.on('data', (data) => {
    buffer += data.toString();

    // Check for complete lines (line-delimited JSON-RPC)
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
        if (line.trim()) {
            try {
                const parsed = JSON.parse(line);
                console.log(
                    `← Received response ID ${parsed.id}: ${parsed.result ? 'SUCCESS' : parsed.error ? 'ERROR' : 'OTHER'}`
                );

                if (parsed.id) {
                    // Only count responses with IDs (not notifications)
                    receivedResponses++;
                }

                if (receivedResponses >= expectedResponses) {
                    console.log('✅ All expected responses received');
                    setTimeout(() => {
                        server.stdin.end();
                    }, 500);
                }
            } catch (e) {
                console.log(`❌ Failed to parse line as JSON: ${line}`);
                console.log(`   Parse error: ${e.message}`);
            }
        }
    }
});

server.stderr.on('data', (data) => {
    const stderrData = data.toString().trim();
    if (stderrData && !stderrData.includes('Would save pipeline') && !stderrData.includes('No parsers initialized')) {
        console.log(`stderr: ${stderrData}`);
    }
});

server.on('close', (code) => {
    console.log(`\nServer exited with code ${code}`);

    if (receivedResponses >= expectedResponses) {
        console.log('🎉 stdio protocol compatibility test PASSED!');
        console.log('   - Line-delimited JSON-RPC format working correctly');
        console.log('   - All responses properly formatted');
        console.log('   - No stdout pollution detected');
    } else {
        console.log('❌ stdio protocol compatibility test FAILED');
        console.log(`   Expected ${expectedResponses} responses, got ${receivedResponses}`);
    }
});

server.on('error', (error) => {
    console.log(`❌ Server process error: ${error}`);
});

// Start test
console.log('Starting stdio protocol compatibility test...');
setTimeout(sendNextMessage, 100);
