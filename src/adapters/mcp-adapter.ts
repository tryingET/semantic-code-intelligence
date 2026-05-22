/**
 * MCP Adapter - Convert MCP tool calls to core analyzer with enhanced error handling
 *
 * This adapter handles MCP-specific concerns:
 * - MCP tool call/response format
 * - Enhanced error handling and validation
 * - Timeout management
 * - Request/response logging
 *
 * Tool/application orchestration is delegated to the core workflow router.
 */

import { CoreError } from '../core/errors.js';
import { ToolRegistry } from '../core/tools/registry.js';
import { type RecoveryOptions, withMcpErrorHandling } from '../core/utils/error-handler.js';
import { adapterLogger } from '../core/utils/file-logger.js';
import { ToolWorkflowRouter, formatToolWorkflowResult } from '../core/workflows/tool-workflow-router.js';
import { handleAdapterError } from './utils.js';

// Minimal core analyzer surface required by MCP adapter and the shared tool router.
type CoreAnalyzer = {
    rename: (req: any) => Promise<{ data: any; performance: any; requestId?: string }>;
    getCompletions?: (req: any) => Promise<{ data: any }>;
    findDefinitionAsync?: (req: any) => Promise<{ data: any[]; performance: any; requestId?: string }>;
    findReferencesAsync?: (req: any) => Promise<{ data: any[]; performance: any; requestId?: string }>;
    buildSymbolMap?: (req: any) => Promise<any>;
    exploreCodebase?: (req: any) => Promise<any>;
    getDiagnostics?: () => any;
    config?: any;
};

export interface MCPAdapterConfig {
    maxResults?: number;
    timeout?: number;
    enableSSE?: boolean;
    ssePort?: number;
}

/**
 * MCP Protocol Adapter - converts MCP tool calls to protocol-shaped responses.
 */
export class MCPAdapter {
    private coreAnalyzer: CoreAnalyzer;
    private config: MCPAdapterConfig;
    private toolRouter: ToolWorkflowRouter;

    constructor(coreAnalyzer: CoreAnalyzer, config: MCPAdapterConfig = {}) {
        this.coreAnalyzer = coreAnalyzer;
        this.config = {
            maxResults: 100,
            timeout: 30000,
            enableSSE: true,
            ssePort: 7001,
            ...config,
        };
        this.toolRouter = new ToolWorkflowRouter(this.coreAnalyzer, {
            maxResults: () => this.config.maxResults || 100,
        });

        // Defensive wrapper to ensure MCP-compatible shape for direct calls in tests
        const original = this.handleToolCall.bind(this);
        (this as any)._originalHandleToolCall = original;
        this.handleToolCall = (async (...args: any[]) => {
            let name: string;
            let arguments_: Record<string, any> = {};
            if (typeof args[0] === 'string') {
                name = args[0];
                arguments_ = (args[1] || {}) as Record<string, any>;
            } else if (args[0] && typeof args[0] === 'object' && 'name' in args[0]) {
                name = String(args[0].name);
                arguments_ = (args[0].arguments || {}) as Record<string, any>;
            } else {
                name = String(args[0]);
                arguments_ = (args[1] || {}) as Record<string, any>;
            }
            const out = await original(name, arguments_);
            if (out && typeof out === 'object' && ('error' in out || (out as any).isError)) {
                return out;
            }
            if (!out || typeof out !== 'object' || !('content' in out)) {
                const txt = (() => {
                    try {
                        return JSON.stringify(out, null, 2);
                    } catch {
                        return String(out);
                    }
                })();
                return { content: [{ type: 'text', text: txt }], isError: false } as any;
            }
            return out;
        }) as any;
    }

    /**
     * Get available MCP tools
     */
    getTools() {
        // Map registry tools with title and lightweight annotations for better UX
        return ToolRegistry.list().map((t: any) => ({
            name: t.name,
            title: t.title || undefined,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.category
                ? { category: t.category, recommended: t.category === 'workflow' }
                : { recommended: false },
        }));
    }

    /**
     * Handle MCP tool call with enhanced error handling
     */
    async handleToolCall(name: string, arguments_: Record<string, any>): Promise<any> {
        try {
            const errorHandlingOptions = this.errorHandlingOptionsForTool(name, arguments_);

            return await withMcpErrorHandling('MCPAdapter', `tool_${name}`, async () => {
                adapterLogger.debug(`Handling tool call: ${name}`, {
                    args: this.sanitizeForLogging(arguments_),
                });

                // Validate tool name early and return structured error (do not throw)
                const validTools = ToolRegistry.list()
                    .map((t) => t.name)
                    .concat(['suggest_refactoring']);
                if (!validTools.includes(name)) {
                    const msg = `Unknown tool: ${name}. Valid tools: ${validTools.join(', ')}`;
                    return handleAdapterError(new CoreError('UnknownTool', msg, { tool: name, validTools }), 'mcp');
                }

                // Ensure analyzer is ready before routing any core requests
                try {
                    await (this.coreAnalyzer as any)?.initialize?.();
                } catch {}

                const startTime = Date.now();
                let result: any;
                try {
                    result = formatToolWorkflowResult(await this.toolRouter.execute(name, arguments_));
                } catch (error) {
                    return handleAdapterError(error, 'mcp');
                }

                const duration = Date.now() - startTime;
                const safeStr = this.safeStringify(result);
                adapterLogger.logPerformance(`tool_${name}`, duration, true, {
                    resultSize: safeStr.length,
                });
                if (process.env.DEBUG && !process.env.SILENT_MODE) {
                    try {
                        adapterLogger.debug('tool result keys', {
                            keys: typeof result === 'object' && result ? Object.keys(result as any) : typeof result,
                        });
                    } catch {}
                }

                // Ensure MCP-compatible shape
                if (result && typeof result === 'object' && 'content' in result) {
                    return result;
                }
                return {
                    content: [
                        {
                            type: 'text',
                            text: typeof result === 'string' ? result : safeStr,
                        },
                    ],
                    isError: false,
                } as any;
            }, undefined, errorHandlingOptions);
        } catch (error) {
            // Let servers map CoreError to protocol-specific errors
            if (error instanceof CoreError) {
                throw error;
            }
            // Fallback: return adapter-shaped message for non-core errors
            return handleAdapterError(error, 'mcp');
        }
    }

    private errorHandlingOptionsForTool(name: string, arguments_: Record<string, any>): Partial<RecoveryOptions> | undefined {
        const longRunning =
            name === 'patch_checks_in_snapshot' ||
            name === 'structural_patch_checks' ||
            name === 'apply_after_checks' ||
            name === 'safe_write' ||
            name === 'apply_snapshot' ||
            name === 'rename_safely' ||
            name === 'workflow_safe_rename' ||
            name === 'rename_symbol';
        if (!longRunning) return undefined;

        const timeoutSec = Number(arguments_?.timeoutSec || 0);
        const cmdCount = Array.isArray(arguments_?.commands) ? Math.max(1, arguments_.commands.length) : 1;
        const derivedMs = timeoutSec > 0 ? (timeoutSec * cmdCount + 30) * 1000 : 10 * 60 * 1000;
        const timeoutMs = Math.max(60_000, Math.min(30 * 60 * 1000, derivedMs));

        return { timeoutMs, maxRetries: 0 } satisfies Partial<RecoveryOptions>;
    }

    /**
     * Initialize the MCP adapter
     */
    async initialize(): Promise<void> {
        // MCP adapter doesn't need special initialization - just ensure core analyzer is ready
        // Core analyzer is passed in constructor and should already be initialized
    }

    /**
     * Dispose the MCP adapter
     */
    async dispose(): Promise<void> {
        // MCP adapter doesn't hold resources that need cleanup
    }

    /**
     * Execute MCP tool call (alias for handleToolCall for consistency)
     */
    async executeTool(request: { name: string; arguments: Record<string, any> }): Promise<any> {
        return await this.handleToolCall(request.name, request.arguments);
    }

    /**
     * Sanitize arguments for logging
     */
    private sanitizeForLogging(args: any): any {
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

    private safeStringify(value: any): string {
        try {
            const serialized = JSON.stringify(value);
            return typeof serialized === 'string' ? serialized : '';
        } catch {
            try {
                return String(value ?? '');
            } catch {
                return '';
            }
        }
    }

    /**
     * Get adapter diagnostics
     */
    getDiagnostics(): Record<string, any> {
        return {
            adapter: 'mcp',
            config: this.config,
            availableTools: this.getTools().map((t) => t.name),
            coreAnalyzer: this.coreAnalyzer.getDiagnostics ? this.coreAnalyzer.getDiagnostics() : {},
            timestamp: Date.now(),
        };
    }
}
