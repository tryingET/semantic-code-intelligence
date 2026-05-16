#!/usr/bin/env bun

/**
 * Test script for MCP stdio server with find_definition tool
 * Tests the complete flow from initialization to tool execution
 */

import { spawn } from 'child_process';
import path from 'path';
import path from 'path';
import { createInterface } from 'readline';

class MCPStdioClient {
    constructor(command, args = []) {
        this.command = command;
        this.args = args;
        this.process = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.serverInfo = null;
        this.capabilities = null;
    }

    async start() {
        console.log('Starting MCP server:', this.command);

        // Set up environment
        const env = {
            ...process.env,
            NODE_ENV: 'production',
            SILENT_MODE: 'true',
            STDIO_MODE: 'true',
            BUN_DISABLE_ANALYTICS: '1',
            BUN_DISABLE_TRANSPILER_CACHE: '1',
            SEMANTIC_CODE_DB_PATH: path.resolve(process.cwd(), '.ontology/ontology.db'),
            SEMANTIC_CODE_WORKSPACE: process.cwd(),
        };

        // Spawn the process
        this.process = spawn(this.command, this.args, {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Handle stderr
        this.process.stderr.on('data', (data) => {
            console.error('Server stderr:', data.toString());
        });

        // Set up readline interface for stdout
        this.rl = createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity,
        });

        // Handle incoming messages
        this.rl.on('line', (line) => {
            try {
                const message = JSON.parse(line);
                this.handleMessage(message);
            } catch (e) {
                // Ignore non-JSON lines
                if (line.trim()) {
                    console.log('Non-JSON output:', line);
                }
            }
        });

        // Handle process exit
        this.process.on('exit', (code) => {
            console.log('Server exited with code:', code);
        });

        // Initialize connection
        await this.initialize();
    }

    async initialize() {
        console.log('\n=== Initializing MCP connection ===');

        // Send initialize request
        const initResult = await this.sendRequest('initialize', {
            protocolVersion: '0.1.0',
            capabilities: {
                tools: {
                    listChanged: true,
                },
            },
            clientInfo: {
                name: 'mcp-test-client',
                version: '1.0.0',
            },
        });

        this.serverInfo = initResult.serverInfo;
        this.capabilities = initResult.capabilities;

        console.log('Server info:', this.serverInfo);
        console.log('Server capabilities:', JSON.stringify(this.capabilities, null, 2));

        // Send initialized notification
        this.sendNotification('notifications/initialized', {});

        return initResult;
    }

    sendRequest(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = `msg_${++this.messageId}`;
            const message = {
                jsonrpc: '2.0',
                method,
                params,
                id,
            };

            this.pendingRequests.set(id, { resolve, reject });

            const messageStr = JSON.stringify(message);
            console.log('→ Sending:', messageStr);
            this.process.stdin.write(messageStr + '\n');
        });
    }

    sendNotification(method, params = {}) {
        const message = {
            jsonrpc: '2.0',
            method,
            params,
        };

        const messageStr = JSON.stringify(message);
        console.log('→ Sending notification:', messageStr);
        this.process.stdin.write(messageStr + '\n');
    }

    handleMessage(message) {
        console.log('← Received:', JSON.stringify(message, null, 2));

        if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                reject(new Error(message.error.message || 'Request failed'));
            } else {
                resolve(message.result);
            }
        }
    }

    async listTools() {
        console.log('\n=== Listing available tools ===');
        const result = await this.sendRequest('tools/list', {});
        console.log('Available tools:', JSON.stringify(result, null, 2));
        return result;
    }

    async callTool(name, arguments_) {
        console.log(`\n=== Calling tool: ${name} ===`);
        console.log('Arguments:', JSON.stringify(arguments_, null, 2));

        const result = await this.sendRequest('tools/call', {
            name,
            arguments: arguments_,
        });

        console.log('Tool result:', JSON.stringify(result, null, 2));
        return result;
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}

// Main test function
async function testMCPFindDefinition() {
    console.log('===========================================');
    console.log('MCP stdio Server Test - find_definition');
    console.log('===========================================');

    const client = new MCPStdioClient(path.resolve(process.cwd(), 'mcp-wrapper.sh'));

    try {
        // Start and initialize the server
        await client.start();

        // Wait a bit for server to be fully ready
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // List available tools
        const tools = await client.listTools();

        // Find the find_definition tool
        const findDefTool = tools.tools?.find((t) => t.name === 'find_definition');
        if (!findDefTool) {
            throw new Error('find_definition tool not found!');
        }

        console.log('\nFound find_definition tool:', findDefTool);

        // Test 1: Find a common class
        console.log('\n=== Test 1: Finding UnifiedAnalyzer ===');
        const result1 = await client.callTool('find_definition', {
            symbol: 'UnifiedAnalyzer',
        });

        // Test 2: Find with fuzzy matching
        console.log('\n=== Test 2: Finding with fuzzy match (LayerMngr) ===');
        const result2 = await client.callTool('find_definition', {
            symbol: 'LayerMngr', // Intentionally misspelled to test fuzzy matching
        });

        // Test 3: Find a function
        console.log('\n=== Test 3: Finding findDefinition function ===');
        const result3 = await client.callTool('find_definition', {
            symbol: 'findDefinition',
        });

        // Test 4: Find with file context
        console.log('\n=== Test 4: Finding with file context ===');
        const result4 = await client.callTool('find_definition', {
            symbol: 'TreeSitterLayer',
            file: 'src/layers/tree-sitter.ts',
        });

        // Test 5: Non-existent symbol
        console.log('\n=== Test 5: Finding non-existent symbol ===');
        const result5 = await client.callTool('find_definition', {
            symbol: 'ThisDoesNotExist123456',
        });

        console.log('\n===========================================');
        console.log('All tests completed successfully!');
        console.log('===========================================');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    } finally {
        client.stop();
    }
}

// Run the test
testMCPFindDefinition().catch(console.error);
