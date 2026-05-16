// Test find_definition after the minification fix
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
            console.log('Response', ++responseCount + ':', JSON.stringify(response, null, 2));
        } catch (e) {
            // Ignore non-JSON output
        }
    });
});

mcp.stderr.on('data', (data) => {
    console.error('STDERR:', data.toString());
});

// Test 1: List tools
const listRequest =
    JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1,
    }) + '\n';

// Test 2: Find AsyncEnhancedGrep definition
const findDefRequest =
    JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
            name: 'find_definition',
            arguments: {
                symbol: 'AsyncEnhancedGrep',
            },
        },
        id: 2,
    }) + '\n';

console.log('Sending list tools request...');
mcp.stdin.write(listRequest);

setTimeout(() => {
    console.log('\nSending find_definition request for AsyncEnhancedGrep...');
    mcp.stdin.write(findDefRequest);
}, 500);

setTimeout(() => {
    console.log('\nTest complete, killing process');
    mcp.kill();
    process.exit(0);
}, 3000);
