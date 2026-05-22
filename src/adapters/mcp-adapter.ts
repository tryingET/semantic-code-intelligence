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
import { resolveToolExecutionPolicy } from '../core/tools/execution-policy.js';
import { ToolExecutor } from '../core/tools/executor.js';
import { ToolRegistry } from '../core/tools/registry.js';
import { type RecoveryOptions, withMcpErrorHandling } from '../mcp/error-handler.js';
import { adapterLogger } from '../mcp/file-logger.js';
import type { SnapshotWorkflowResult } from '../core/workflows/snapshot-patch-workflow.js';
import { ToolWorkflowRouter } from '../core/workflows/tool-workflow-router.js';
import type { WorkflowCoreAnalyzer } from '../core/workflows/types.js';
import { handleAdapterError } from './utils.js';

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
    private coreAnalyzer: WorkflowCoreAnalyzer;
    private config: MCPAdapterConfig;
    private toolRouter: ToolWorkflowRouter;
    private toolExecutor: ToolExecutor;

    constructor(coreAnalyzer: WorkflowCoreAnalyzer, config: MCPAdapterConfig = {}) {
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
        this.toolExecutor = new ToolExecutor();
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
    async handleToolCall(
        nameOrRequest: string | { name: string; arguments?: Record<string, any> },
        arguments_: Record<string, any> = {}
    ): Promise<any> {
        const { name, args } = this.normalizeToolCall(nameOrRequest, arguments_);
        try {
            const errorHandlingOptions = this.errorHandlingOptionsForTool(name, args);

            return await withMcpErrorHandling('MCPAdapter', `tool_${name}`, async () => {
                adapterLogger.debug(`Handling tool call: ${name}`, {
                    args: this.sanitizeForLogging(args),
                });

                // Ensure analyzer is ready before routing any core requests
                try {
                    await (this.coreAnalyzer as any)?.initialize?.();
                } catch {}

                const startTime = Date.now();
                let result: any;
                try {
                    result = this.formatMcpToolWorkflowResult(await this.executeCoreToolWorkflow(name, args));
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

    private async executeCoreToolWorkflow(name: string, args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        return this.toolExecutor.execute(this.toolRouter, name, args);
    }

    private formatMcpToolWorkflowResult(result: SnapshotWorkflowResult) {
        if ('text' in result) {
            return { content: [{ type: 'text', text: result.text }], isError: result.isError === true };
        }
        return { content: [{ type: 'text', text: JSON.stringify(result.payload, null, 2) }], isError: result.isError === true };
    }

    private normalizeToolCall(
        nameOrRequest: string | { name: string; arguments?: Record<string, any> },
        arguments_: Record<string, any>
    ): { name: string; args: Record<string, any> } {
        if (typeof nameOrRequest === 'string') {
            return { name: nameOrRequest, args: arguments_ || {} };
        }
        if (nameOrRequest && typeof nameOrRequest === 'object' && 'name' in nameOrRequest) {
            return { name: String(nameOrRequest.name), args: nameOrRequest.arguments || {} };
        }
        return { name: String(nameOrRequest), args: arguments_ || {} };
    }

    private errorHandlingOptionsForTool(name: string, arguments_: Record<string, any>): Partial<RecoveryOptions> | undefined {
        const policy = resolveToolExecutionPolicy(this.toolExecutor.getSpec(name), arguments_);
        if (!policy.longRunning) return undefined;

        return {
            timeoutMs: policy.timeoutMs,
            ...(policy.disableRetries ? { maxRetries: 0 } : {}),
        } satisfies Partial<RecoveryOptions>;
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
