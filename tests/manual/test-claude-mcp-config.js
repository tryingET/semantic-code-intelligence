#!/usr/bin/env bun

// Test MCP configuration exactly as Claude Desktop would use it
import { spawn } from 'child_process';
import { readFileSync } from 'fs';

console.log('🧪 Testing MCP Configuration as Claude Desktop would use it\n');

// Read Claude Desktop config
const configPath = '${process.env.HOME}/.config/claude/claude-desktop-config.json';
console.log('📋 Reading configuration from:', configPath);

let config;
try {
    const configData = readFileSync(configPath, 'utf8');
    config = JSON.parse(configData);
    console.log('✅ Configuration loaded successfully\n');
} catch (error) {
    console.error('❌ Failed to read configuration:', error.message);
    process.exit(1);
}

// Extract ontology-lsp server config
const ontologyConfig = config.mcpServers['ontology-lsp'];
if (!ontologyConfig) {
    console.error('❌ ontology-lsp server not found in configuration');
    process.exit(1);
}

console.log('🔧 Server Configuration:');
console.log('  Command:', ontologyConfig.command);
console.log('  Args:', ontologyConfig.args);
console.log('  Type:', ontologyConfig.type);
console.log('  Environment variables:');
for (const [key, value] of Object.entries(ontologyConfig.env || {})) {
    console.log(`    ${key}: ${value}`);
}
console.log('');

// Test if the binary exists and is executable
const binPath = ontologyConfig.args[1]; // The mcp.js file path
console.log('📂 Checking binary path:', binPath);
try {
    const stat = await Bun.file(binPath).exists();
    if (stat) {
        console.log('✅ Binary file exists');
    } else {
        console.log('❌ Binary file does not exist');
        process.exit(1);
    }
} catch (error) {
    console.log('❌ Cannot access binary file:', error.message);
    process.exit(1);
}

console.log('');

// Test MCP server with exact same configuration
console.log('🚀 Starting MCP server with Claude Desktop configuration...');

const server = spawn(ontologyConfig.command, ontologyConfig.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
        ...process.env,
        ...ontologyConfig.env,
    },
});

let responseCount = 0;

server.stdout.on('data', (data) => {
    const lines = data
        .toString()
        .split('\n')
        .filter((line) => line.trim());
    lines.forEach((line) => {
        if (line.startsWith('{"')) {
            try {
                const response = JSON.parse(line);
                responseCount++;
                console.log(`📤 Response ${responseCount}:`, JSON.stringify(response, null, 2));
            } catch (e) {
                console.log('📤 Raw response:', line);
            }
        }
    });
});

server.stderr.on('data', (data) => {
    console.log('📝 Server stderr:', data.toString().trim());
});

server.on('error', (error) => {
    console.error('❌ Server error:', error);
});

// Send initialization and tools list
setTimeout(() => {
    console.log('📨 Sending initialize...');
    server.stdin.write(
        JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'claude-desktop', version: '1.0.0' },
            },
            id: 1,
        }) + '\n'
    );
}, 100);

setTimeout(() => {
    console.log('📨 Sending tools/list...');
    server.stdin.write(
        JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/list',
            params: {},
            id: 2,
        }) + '\n'
    );
}, 600);

setTimeout(() => {
    console.log('📨 Testing tool call...');
    server.stdin.write(
        JSON.stringify({
            jsonrpc: '2.0',
            method: 'tools/call',
            params: {
                name: 'find_definition',
                arguments: { symbol: 'test' },
            },
            id: 3,
        }) + '\n'
    );
}, 1100);

// Summary and cleanup
setTimeout(() => {
    console.log('\n🎯 Test Summary:');
    console.log(`Total responses received: ${responseCount}`);

    if (responseCount >= 3) {
        console.log('✅ MCP server is working correctly with Claude Desktop configuration');
        console.log('✅ All required methods (initialize, tools/list, tools/call) responded');
        console.log('\n💡 If Claude Desktop shows "Not connected", try:');
        console.log('   1. Restart Claude Desktop completely');
        console.log('   2. Check Claude Desktop logs for specific error messages');
        console.log('   3. Verify Claude Desktop has the latest configuration');
    } else {
        console.log('❌ MCP server did not respond properly');
        console.log('   This could indicate a configuration or runtime issue');
    }

    server.kill();
    process.exit(responseCount >= 3 ? 0 : 1);
}, 2500);
