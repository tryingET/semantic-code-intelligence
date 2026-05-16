/**
 * Enhanced MCP Server with comprehensive error handling and connection recovery
 *
 * This server provides robust error handling, connection state management,
 * proper signal handling, and file-based logging for debugging.
 */

// CRITICAL: Set silent mode BEFORE any imports to prevent stdio pollution
process.env.SILENT_MODE = 'true';
process.env.STDIO_MODE = 'true';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { MCPAdapter } from '../adapters/mcp-adapter.js';
import { createDefaultCoreConfig } from '../adapters/utils.js';
import { createCodeAnalyzer } from '../core/index';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import { ConnectionManager, defaultConnectionManager } from '../core/utils/connection-manager.js';
import {
    createInternalError,
    createValidationError,
    type ErrorContext,
    globalErrorHandler,
    withMcpErrorHandling,
} from '../core/utils/error-handler.js';
// Import enhanced error handling and logging
import { fileLogger, mcpLogger } from '../core/utils/file-logger.js';

export class EnhancedMCPServer {
    private server: Server;
    private coreAnalyzer?: CodeAnalyzer;
    private mcpAdapter?: MCPAdapter;
    private connectionManager: ConnectionManager;
    private initPromise?: Promise<void>;
    private initialized = false;
    private shuttingDown = false;

    constructor() {
        this.server = new Server(
            {
                name: 'ontology-lsp',
                version: '1.0.0',
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {},
                },
            }
        );

        this.connectionManager = new ConnectionManager({
            enableHeartbeat: false, // Disabled for stdio
            connectionTimeout: 15000, // 15 seconds
            maxReconnectAttempts: 3,
        });

        this.setupSignalHandlers();
        this.setupConnectionHandlers();
        this.setupRequestHandlers();

        mcpLogger.info('Enhanced MCP Server initialized');
    }

    /**
     * Setup comprehensive signal handlers for robust stdio communication
     */
    private setupSignalHandlers(): void {
        // Handle graceful shutdown
        const gracefulShutdown = async (signal: string) => {
            if (this.shuttingDown) return;
            this.shuttingDown = true;

            mcpLogger.info(`Received ${signal}, initiating graceful shutdown`);

            try {
                await this.shutdown();
                mcpLogger.info('Graceful shutdown completed');
                process.exit(0);
            } catch (error) {
                mcpLogger.error('Error during shutdown', error);
                process.exit(1);
            }
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

        // Handle SIGPIPE specifically for stdio communication
        process.on('SIGPIPE', (error) => {
            mcpLogger.warn('SIGPIPE received - client disconnected', error);
            this.connectionManager.handleConnectionLoss(new Error('SIGPIPE - client disconnected'));
        });

        // Handle other critical errors
        process.on('uncaughtException', (error) => {
            mcpLogger.error('Uncaught exception', error);

            // Don't exit immediately if it's a minor error
            if (!this.isCriticalError(error)) {
                mcpLogger.warn('Non-critical error, continuing operation');
                return;
            }

            this.emergencyShutdown(error);
        });

        process.on('unhandledRejection', (reason, promise) => {
            mcpLogger.error('Unhandled promise rejection', new Error(String(reason)), { promise });

            // Handle unhandled rejections gracefully
            if (reason instanceof Error && !this.isCriticalError(reason)) {
                mcpLogger.warn('Non-critical rejection, continuing operation');
                return;
            }

            this.emergencyShutdown(new Error(`Unhandled rejection: ${String(reason)}`));
        });

        // Handle stdio stream errors
        if (process.stdin) {
            process.stdin.on('error', (error) => {
                mcpLogger.error('stdin error', error);
                this.connectionManager.handleConnectionLoss(error);
            });
        }

        if (process.stdout) {
            process.stdout.on('error', (error) => {
                mcpLogger.error('stdout error', error);
                this.connectionManager.handleConnectionLoss(error);
            });
        }

        mcpLogger.debug('Signal handlers configured');
    }

    /**
     * Setup connection event handlers
     */
    private setupConnectionHandlers(): void {
        this.connectionManager.onStateChange((event) => {
            mcpLogger.info(`Connection state changed: ${event.previousState} -> ${event.state}`, {
                timestamp: event.timestamp,
                error: event.error?.message,
                metadata: event.metadata,
            });

            // Handle connection failures
            if (event.state === 'failed' || event.state === 'disconnected') {
                if (event.error && !this.shuttingDown) {
                    mcpLogger.warn('Connection failure detected, monitoring for recovery');
                }
            }
        });
    }

    /**
     * Setup request handlers with comprehensive error handling
     */
    private setupRequestHandlers(): void {
        // List available tools with error handling
        this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
            const context: ErrorContext = {
                component: 'EnhancedMCPServer',
                operation: 'list_tools',
                requestId: (request as any)?.id,
                timestamp: Date.now(),
            };

            return await withMcpErrorHandling(
                'EnhancedMCPServer',
                'list_tools',
                async () => {
                    this.connectionManager.recordMessage('incoming', request);

                    // Ensure initialization before returning tools
                    await this.ensureInitialized();

                    if (!this.mcpAdapter) {
                        throw createInternalError('Server not properly initialized', context);
                    }

                    const tools = this.mcpAdapter.getTools();

                    this.connectionManager.recordMessage('outgoing', { tools });
                    mcpLogger.debug('Tools listed successfully', { toolCount: tools.length });

                    return { tools };
                },
                (request as any)?.id
            );
        });

        // Handle tool calls with comprehensive error handling
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const context: ErrorContext = {
                component: 'EnhancedMCPServer',
                operation: 'call_tool',
                requestId: (request as any)?.id,
                timestamp: Date.now(),
            };

            return await withMcpErrorHandling(
                'EnhancedMCPServer',
                'call_tool',
                async () => {
                    this.connectionManager.recordMessage('incoming', request);

                    // Validate request
                    globalErrorHandler.validateRequest(request.params, ['name'], context);

                    // Ensure initialization
                    await this.ensureInitialized();

                    if (!this.mcpAdapter) {
                        throw createInternalError('Server not properly initialized', context);
                    }

                    const { name, arguments: args } = request.params;

                    mcpLogger.debug(`Executing tool: ${name}`, {
                        args: this.sanitizeArgs(args),
                        requestId: context.requestId,
                    });

                    // Execute tool with timeout and error handling
                    const startTime = Date.now();
                    const result = await this.mcpAdapter.handleToolCall(name, args || {});
                    const duration = Date.now() - startTime;

                    mcpLogger.logPerformance(`tool_${name}`, duration, true, {
                        requestId: context.requestId,
                        argsSize: JSON.stringify(args || {}).length,
                        resultSize: JSON.stringify(result).length,
                    });

                    this.connectionManager.recordMessage('outgoing', result);

                    return result;
                },
                (request as any)?.id
            );
        });

        mcpLogger.debug('Request handlers configured');
    }

    /**
     * Ensure server is initialized with error handling
     */
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (!this.initPromise) {
            this.initPromise = this.initializeCore();
        }

        await this.initPromise;
    }

    /**
     * Initialize core components with error handling and recovery
     */
    private async initializeCore(): Promise<void> {
        const context: ErrorContext = {
            component: 'EnhancedMCPServer',
            operation: 'initialize',
            timestamp: Date.now(),
        };

        await globalErrorHandler.withErrorHandling(
            context,
            async () => {
                mcpLogger.info('Initializing core analyzer...');

                // Lazily import heavy modules
                const [coreIndex, adapterUtils, mcpAdapterMod] = await Promise.all([
                    import('../core/index'),
                    import('../adapters/utils'),
                    import('../adapters/mcp-adapter'),
                ]);

                const { createCodeAnalyzer } = coreIndex as any;
                const { createDefaultCoreConfig } = adapterUtils as any;
                const { MCPAdapter } = mcpAdapterMod as any;

                // Create optimized config
                const config = createDefaultCoreConfig();
                const workspaceRoot = process.env.ONTOLOGY_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();

                // Optimize for fast initialization
                config.optimization = {
                    ...config.optimization,
                    cacheWarming: false,
                    preloadParsers: false,
                };

                mcpLogger.debug('Creating core analyzer', { workspaceRoot, config: this.sanitizeConfig(config) });

                // Initialize core analyzer with timeout
                this.coreAnalyzer = await createCodeAnalyzer({
                    ...config,
                    workspaceRoot,
                });

                await this.coreAnalyzer.initialize();

                // Create MCP adapter
                this.mcpAdapter = new MCPAdapter(this.coreAnalyzer);

                this.initialized = true;
                mcpLogger.info('Core analyzer initialized successfully');
            },
            {
                maxRetries: 2,
                baseDelay: 2000,
            }
        );
    }

    /**
     * Start the server with connection management
     */
    async run(): Promise<void> {
        const context: ErrorContext = {
            component: 'EnhancedMCPServer',
            operation: 'run',
            timestamp: Date.now(),
        };

        await globalErrorHandler.withErrorHandling(
            context,
            async () => {
                mcpLogger.info('Starting Enhanced MCP Server...');

                // Initialize connection manager
                await this.connectionManager.connect({
                    transport: 'stdio',
                    startTime: Date.now(),
                });

                // Set up transport
                const transport = new StdioServerTransport();

                // Connect server
                await this.server.connect(transport);

                mcpLogger.info('Enhanced MCP Server running on stdio', {
                    version: '1.0.0',
                    pid: process.pid,
                    workspaceRoot: process.env.ONTOLOGY_WORKSPACE || process.cwd(),
                });
            },
            {
                maxRetries: 1,
                baseDelay: 1000,
            }
        );
    }

    /**
     * Graceful shutdown
     */
    async shutdown(): Promise<void> {
        const context: ErrorContext = {
            component: 'EnhancedMCPServer',
            operation: 'shutdown',
            timestamp: Date.now(),
        };

        await globalErrorHandler.withErrorHandling(context, async () => {
            mcpLogger.info('Shutting down Enhanced MCP Server...');

            // Stop accepting new requests
            this.shuttingDown = true;

            // Disconnect connection manager
            await this.connectionManager.disconnect();

            // Dispose of core analyzer
            if (this.coreAnalyzer) {
                await this.coreAnalyzer.dispose();
                this.coreAnalyzer = undefined;
            }

            this.mcpAdapter = undefined;
            this.initialized = false;

            mcpLogger.info('Enhanced MCP Server shutdown completed');
        });
    }

    /**
     * Emergency shutdown for critical errors
     */
    private async emergencyShutdown(error: Error): Promise<void> {
        mcpLogger.error('Emergency shutdown initiated', error);

        try {
            await this.shutdown();
        } catch (shutdownError) {
            mcpLogger.error('Error during emergency shutdown', shutdownError);
        }

        process.exit(1);
    }

    /**
     * Determine if an error is critical and requires shutdown
     */
    private isCriticalError(error: Error): boolean {
        const criticalPatterns = [
            'out of memory',
            'stack overflow',
            'segmentation fault',
            'heap limit',
            'cannot allocate memory',
        ];

        const message = error.message.toLowerCase();
        return criticalPatterns.some((pattern) => message.includes(pattern));
    }

    /**
     * Sanitize arguments for logging (remove sensitive data)
     */
    private sanitizeArgs(args: any): any {
        if (!args || typeof args !== 'object') return args;

        const sanitized = { ...args };
        const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];

        for (const field of sensitiveFields) {
            if (sanitized[field]) {
                sanitized[field] = '[REDACTED]';
            }
        }

        return sanitized;
    }

    /**
     * Sanitize config for logging
     */
    private sanitizeConfig(config: any): any {
        // Return a simplified version for logging
        return {
            layersEnabled: Object.keys(config.layers || {}),
            workspaceRoot: config.workspaceRoot ? '[SET]' : '[NOT_SET]',
            optimization: config.optimization,
        };
    }

    /**
     * Get server health information
     */
    getHealthInfo(): any {
        return {
            initialized: this.initialized,
            shuttingDown: this.shuttingDown,
            connection: this.connectionManager.getHealthCheck(),
            coreAnalyzer: this.coreAnalyzer?.getDiagnostics?.() || null,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            pid: process.pid,
        };
    }
}

// Create and run server
const server = new EnhancedMCPServer();

// Start server with error handling
server.run().catch((error) => {
    mcpLogger.error('Failed to start Enhanced MCP server', error);
    process.exit(1);
});

// Export for testing
export { server as enhancedMcpServer };
