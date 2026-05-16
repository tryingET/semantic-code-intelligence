// Test full MCP protocol flow
import { spawn } from 'node:child_process';

const mcp = spawn('bun', ['dist/mcp-fast/mcp-fast.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
});

let responseCount = 0;

mcp.stdout.on('data', (data) => {
    const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
    lines.forEach((line) => {
        try {
            const response = JSON.parse(line);
            console.log(`Response ${++responseCount}:`, JSON.stringify(response, null, 2));
        } catch (e) {
            // Ignore non-JSON
        }
    });
});

mcp.stderr.on('data', (data) => {
    console.error('STDERR:', data.toString());
});

// Full MCP handshake flow
const requests = [
    // 1. Initialize
    {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: {
                name: 'Claude',
                version: '1.0.0',
            },
        },
        id: 1,
    },
    // 2. List tools
    {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2,
    },
    // 3. Call find_definition
    {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
            name: 'find_definition',
            arguments: {
                symbol: 'AsyncEnhancedGrep',
            },
        },
        id: 3,
    },
];

// Send requests in sequence
async function sendRequests() {
    for (let i = 0; i < requests.length; i++) {
        console.log(`\n=== Sending request ${i + 1} ===`);
        mcp.stdin.write(JSON.stringify(requests[i]) + '\n');
        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    setTimeout(() => {
        console.log('\n=== Test complete ===');
        mcp.kill();
        process.exit(0);
    }, 1000);
}

sendRequests();
