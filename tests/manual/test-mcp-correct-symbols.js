#!/usr/bin/env bun

/**
 * Test MCP find_definition with correct symbol names from source
 */

import { spawn } from 'child_process';
import path from 'path';
import path from 'path';
import { createInterface } from 'readline';

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

async function testCorrectSymbols() {
    console.log('=== MCP find_definition Test with Correct Symbol Names ===\n');

    const client = new MCPClient(path.resolve(process.cwd(), 'mcp-wrapper.sh'));

    // These are the actual class names from the source code
    const symbols = [
        'CodeAnalyzer', // Main class in src/core/unified-analyzer.ts
        'LayerManager', // Class in src/core/layer-manager.ts
        'TreeSitterLayer', // Class in src/layers/tree-sitter.ts
        'ClaudeToolsLayer', // Class in src/layers/claude-tools.ts
        'AsyncEnhancedGrep', // Class in src/layers/enhanced-search-tools-async.ts
        'OntologyEngine', // Class in src/ontology/ontology-engine.ts
        'PatternLearner', // Class in src/patterns/pattern-learner.ts
        'KnowledgeSpreader', // Class in src/propagation/knowledge-spreader.ts
        'findDefinition', // Function names
        'findReferences',
        'renameSymbol',
    ];

    try {
        await client.start();

        console.log('Testing actual source code symbols:\n');

        let foundInSrc = 0;
        let foundTotal = 0;

        for (const symbol of symbols) {
            console.log(`\n📍 Searching for: ${symbol}`);
            console.log('─'.repeat(40));

            const result = await client.findDefinition(symbol);

            if (result && result.definitions && result.definitions.length > 0) {
                foundTotal++;
                console.log(`✅ Found ${result.definitions.length} definition(s)`);

                // Check if any are in src/ directory (not test/)
                let srcFound = false;

                // Show first 3 definitions, highlighting src files
                const toShow = result.definitions.slice(0, 5);
                for (const def of toShow) {
                    const fullPath = def.uri.replace('file://', '');
                    const repoRoot = path.resolve(process.cwd()) + path.sep;
                    const relativePath = fullPath.replace(repoRoot, '').replace('/mnt/wslg/distro', '');

                    const isSource = relativePath.startsWith('src/');
                    if (isSource) srcFound = true;

                    const icon = isSource ? '⭐' : '📄';
                    console.log(`   ${icon} ${relativePath}:${def.line}`);
                    console.log(`      Kind: ${def.kind}, Confidence: ${def.confidence}`);
                }

                if (srcFound) {
                    foundInSrc++;
                    console.log(`   ✨ Found in source code!`);
                }

                if (result.definitions.length > 5) {
                    console.log(`   ... and ${result.definitions.length - 5} more`);
                }
            } else {
                console.log(`❌ No definitions found`);
            }

            if (result && result.performance) {
                const total = result.performance.total;
                const emoji = total < 100 ? '🚀' : total < 500 ? '⚡' : '⏱️';
                console.log(
                    `   ${emoji} Total: ${total}ms (L1: ${result.performance.layer1}ms, L2: ${result.performance.layer2}ms)`
                );
            }
        }

        console.log('\n' + '='.repeat(50));
        console.log('Summary:');
        console.log(`  Total symbols found: ${foundTotal}/${symbols.length}`);
        console.log(`  Found in src/ directory: ${foundInSrc}/${foundTotal}`);
        console.log(`  Success rate: ${Math.round((foundTotal / symbols.length) * 100)}%`);

        if (foundInSrc === 0) {
            console.log('\n⚠️  WARNING: No symbols found in src/ directory!');
            console.log('   The indexer might not be scanning source files properly.');
        }

        console.log('\nTest completed!');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    } finally {
        client.stop();
    }
}

testCorrectSymbols().catch(console.error);
