/**
 * MCP Server - Thin wrapper around unified core
 *
 * This server only handles MCP protocol concerns:
 * - MCP server setup and transport (stdio)
 * - Tool registration
 * - Request/response formatting
 *
 * All analysis work is delegated to the MCP adapter and core analyzer.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { serve } from 'bun';
import { MCPAdapter } from '../adapters/mcp-adapter.js';
import { createDefaultCoreConfig } from '../adapters/utils.js';
import { createCodeAnalyzer } from '../core/index';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { SCI_VERSION } from '../core/version.js';
import { resolveConfiguredWorkspaceRoot } from '../core/workspace-root.js';
import { metricsRegistry, recordToolEnd, recordToolStart } from '../instrumentation/metrics.js';
import { toMcpToolCallError } from '../mcp/tool-call-error.js';
import { isMcpToolResultSuccess } from '../mcp/tool-result.js';
import { registerCommonPrompts, registerCommonResources } from './mcp-shared.js';

export class MCPServer {
    private server: Server;
    private coreAnalyzer!: CodeAnalyzer;
    private mcpAdapter!: MCPAdapter;
    private readonly workspaceRoot: string;

    constructor() {
        this.workspaceRoot = resolveConfiguredWorkspaceRoot();
        this.server = new Server(
            {
                name: 'semantic-code-intelligence',
                version: SCI_VERSION,
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {},
                },
            }
        );

        registerCommonPrompts(this.server);
        registerCommonResources(this.server, {
            workspaceRoot: this.workspaceRoot,
            getAnalyzer: () => this.coreAnalyzer,
        });
        this.setupHandlers();
    }

    private setupHandlers(): void {
        // List available tools
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
            if (!this.mcpAdapter) {
                throw new McpError(ErrorCode.InternalError, 'Server not initialized');
            }

            return {
                tools: this.mcpAdapter.getTools(),
            };
        });

        // Handle tool calls
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (!this.mcpAdapter) {
                throw new McpError(ErrorCode.InternalError, 'Server not initialized');
            }

            const { name, arguments: args } = request.params;

            try {
                const t0 = Date.now();
                recordToolStart('mcp_stdio');
                const result = await this.mcpAdapter.handleValidatedToolCall(name, args || {});
                try {
                    recordToolEnd(
                        'mcp_stdio',
                        String(name || 'unknown'),
                        Date.now() - t0,
                        isMcpToolResultSuccess(result)
                    );
                } catch {}
                return result;
            } catch (error) {
                try {
                    recordToolEnd('mcp_stdio', String(name || 'unknown'), 0, false);
                } catch {}
                console.error(`Tool call failed: ${name}`, error);
                throw toMcpToolCallError(name, error);
            }
        });
    }

    async initialize(): Promise<void> {
        // Initialize core analyzer
        const config = createDefaultCoreConfig();
        config.monitoring.enabled = false; // disable periodic metrics for stdio MCP
        this.coreAnalyzer = await createCodeAnalyzer({
            ...config,
            workspaceRoot: this.workspaceRoot,
        });

        await this.coreAnalyzer.initialize();

        // Create MCP adapter
        this.mcpAdapter = new MCPAdapter(this.coreAnalyzer);

        console.error('Ontology MCP Server initialized');

        // Start metrics endpoint on loopback only when explicitly requested.
        // Stdio protocol servers should not open a TCP listener by default.
        if (process.env.MCP_STDIO_PROM_PORT) {
            try {
                const port = Number(process.env.MCP_STDIO_PROM_PORT);
                serve({
                    hostname: '127.0.0.1',
                    port,
                    fetch: async (req) => {
                        const url = new URL(req.url);
                        if (url.pathname === '/metrics' && req.method === 'GET') {
                            const text = metricsRegistry.renderPrometheusText();
                            return new Response(text, {
                                status: 200,
                                headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-cache' },
                            });
                        }
                        return new Response('Not found', { status: 404 });
                    },
                });
                console.error(`[MCP stdio] Metrics on http://127.0.0.1:${port}/metrics`);
            } catch (err) {
                console.error('[MCP stdio] Metrics server failed to start:', (err as Error)?.message || String(err));
            }
        }
    }

    async run(): Promise<void> {
        // Initialize first
        await this.initialize();

        // Set up transport
        const transport = new StdioServerTransport();

        // Connect and listen
        await this.server.connect(transport);
        console.error('Ontology MCP Server running on stdio');
    }

    async shutdown(): Promise<void> {
        if (this.coreAnalyzer) {
            await this.coreAnalyzer.dispose();
        }
        console.error('Ontology MCP Server shut down');
    }
}

export async function runMCPServer(): Promise<void> {
    const server = new MCPServer();

    process.on('SIGINT', async () => {
        await server.shutdown();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        await server.shutdown();
        process.exit(0);
    });

    await server.run();
}

if (import.meta.main) {
    runMCPServer().catch((error) => {
        console.error('Failed to start MCP server:', error);
        process.exit(1);
    });
}
