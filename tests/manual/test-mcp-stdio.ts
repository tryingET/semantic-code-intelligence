#!/usr/bin/env bun
/**
 * Test MCP stdio connection using Bun
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Spawn the MCP server (use bun from PATH and repo-relative server path)
const serverPath = resolve(process.cwd(), 'src/servers/mcp.ts');
const mcpServer = spawn('bun', ['run', serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
});

// Create readline interface for server stdout
const rl = createInterface({
    input: mcpServer.stdout,
    crlfDelay: Infinity,
});

// Handle server stdout
rl.on('line', (line) => {
    console.log('Server response:', line);
    try {
        const response = JSON.parse(line);
        console.log('Parsed response:', response);
    } catch (e) {
        // Not JSON, that's ok
    }
});

// Handle server stderr
mcpServer.stderr.on('data', (data) => {
    console.error('Server log:', data.toString());
});

// Send initialization request
const initRequest = {
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
            name: 'test-client',
            version: '1.0.0',
        },
    },
    id: 1,
};

console.log('Sending initialization request...');
mcpServer.stdin.write(JSON.stringify(initRequest) + '\n');

// Send list tools request after a delay
setTimeout(() => {
    const listToolsRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2,
    };

    console.log('Sending list tools request...');
    mcpServer.stdin.write(JSON.stringify(listToolsRequest) + '\n');

    // Exit after 2 seconds
    setTimeout(() => {
        console.log('Test complete, shutting down...');
        mcpServer.kill();
        process.exit(0);
    }, 2000);
}, 1000);

// Handle errors
mcpServer.on('error', (error) => {
    console.error('Server error:', error);
});

mcpServer.on('exit', (code) => {
    console.log('Server exited with code:', code);
});
