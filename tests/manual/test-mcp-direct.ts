// Direct test of MCP server
import { spawn } from 'node:child_process';

const mcp = spawn('bun', ['dist/mcp-fast/mcp-fast.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
});

let output = '';
let errorOutput = '';

mcp.stdout.on('data', (data) => {
    output += data.toString();
    console.log('STDOUT:', data.toString());
});

mcp.stderr.on('data', (data) => {
    errorOutput += data.toString();
    console.error('STDERR:', data.toString());
});

mcp.on('close', (code) => {
    console.log('Process exited with code:', code);
    process.exit(code);
});

// Send list tools request
const request =
    JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 1,
    }) + '\n';

console.log('Sending request:', request);
mcp.stdin.write(request);

// Give it some time then kill if hanging
setTimeout(() => {
    console.log('Timeout reached, killing process');
    mcp.kill();
}, 3000);
