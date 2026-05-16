#!/usr/bin/env bun

/**
 * Test MCP find_definition for actual source code symbols
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';

class MCPClient {
    constructor(command, args = []) {
        this.command = command;
        this.args = args;
        this.process = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
    }

    async start() {
        console.log('Starting MCP server...');

        const env = {
            ...process.env,
            NODE_ENV: 'production',
            SILENT_MODE: 'true',
            STDIO_MODE: 'true',
            BUN_DISABLE_ANALYTICS: '1',
            BUN_DISABLE_TRANSPILER_CACHE: '1',
            ONTOLOGY_DB_PATH: path.resolve(process.cwd(), '.ontology/ontology.db'),
            ONTOLOGY_WORKSPACE: process.cwd(),
        };

        this.process = spawn(this.command, this.args, {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.process.stderr.on('data', (data) => {
            // Suppress stderr
        });

        this.rl = createInterface({
            input: this.process.stdout,
            crlfDelay: Infinity,
        });

        this.rl.on('line', (line) => {
            try {
                const message = JSON.parse(line);
                this.handleMessage(message);
            } catch (e) {
                // Ignore non-JSON
            }
        });

        // Initialize
        await this.sendRequest('initialize', {
            protocolVersion: '0.1.0',
            capabilities: { tools: { listChanged: true } },
            clientInfo: { name: 'test-client', version: '1.0.0' },
        });

        this.sendNotification('notifications/initialized', {});

        // Wait for initialization
        await new Promise((resolve) => setTimeout(resolve, 500));
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
            this.process.stdin.write(JSON.stringify(message) + '\n');
        });
    }

    sendNotification(method, params = {}) {
        const message = {
            jsonrpc: '2.0',
            method,
            params,
        };
        this.process.stdin.write(JSON.stringify(message) + '\n');
    }

    handleMessage(message) {
        if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                reject(new Error(message.error.message));
            } else {
                resolve(message.result);
            }
        }
    }

    async findDefinition(symbol) {
        const result = await this.sendRequest('tools/call', {
            name: 'find_definition',
            arguments: { symbol },
        });

        if (result.content && result.content[0]) {
            const parsed = JSON.parse(result.content[0].text);
            return parsed;
        }
        return null;
    }

    stop() {
        if (this.process) {
            this.process.kill();
        }
    }
}

async function testSourceSymbols() {
    console.log('=== MCP find_definition Test for Source Code ===\n');

    const client = new MCPClient(path.resolve(process.cwd(), 'mcp-wrapper.sh'));

    const symbols = [
        'UnifiedAnalyzer', // Main class in src/core/unified-analyzer.ts
        'LayerManager', // Class in src/core/layer-manager.ts
        'TreeSitterLayer', // Class in src/layers/tree-sitter.ts
        'ClaudeToolsLayer', // Class in src/layers/claude-tools.ts
        'OntologyEngine', // Class in src/ontology/ontology-engine.ts
        'PatternLearner', // Class in src/patterns/pattern-learner.ts
        'KnowledgeSpreader', // Class in src/propagation/knowledge-spreader.ts
        'LSPAdapter', // Class in src/adapters/lsp-adapter.ts
        'MCPAdapter', // Class in src/adapters/mcp-adapter.ts
        'HTTPAdapter', // Class in src/adapters/http-adapter.ts
    ];

    try {
        await client.start();

        console.log('Testing source code symbols:\n');

        for (const symbol of symbols) {
            console.log(`\n📍 Searching for: ${symbol}`);
            console.log('─'.repeat(40));

            const result = await client.findDefinition(symbol);

            if (result && result.definitions && result.definitions.length > 0) {
                console.log(`✅ Found ${result.definitions.length} definition(s)`);

                // Show first 3 definitions
                const toShow = result.definitions.slice(0, 3);
                for (const def of toShow) {
                    const file = def.uri.replace('file://', '').replace(path.resolve(process.cwd()) + path.sep, '');
                    console.log(`   📄 ${file}:${def.line}`);
                    console.log(`      Kind: ${def.kind}, Confidence: ${def.confidence}`);
                }

                if (result.definitions.length > 3) {
                    console.log(`   ... and ${result.definitions.length - 3} more`);
                }
            } else {
                console.log(`❌ No definitions found`);
            }

            if (result && result.performance) {
                console.log(`   ⏱️  Performance: Total ${result.performance.total}ms`);
                console.log(`      Layer 1: ${result.performance.layer1}ms`);
                console.log(`      Layer 2: ${result.performance.layer2}ms`);
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    } finally {
        client.stop();
    }
}

testSourceSymbols().catch(console.error);
