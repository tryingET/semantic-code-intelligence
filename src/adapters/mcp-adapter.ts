/**
 * MCP Adapter - Convert MCP tool calls to core analyzer with enhanced error handling
 *
 * This adapter handles MCP-specific concerns:
 * - MCP tool call/response format
 * - Enhanced error handling and validation
 * - Request/response logging
 *
 * Tool/application orchestration is delegated to the core workflow router.
 */

import { CoreError } from '../core/errors.js';
import { withMcpErrorHandling } from '../mcp/error-handler.js';
import { listMcpTools } from '../mcp/tool-list.js';
import {
    ensureMcpToolResponse,
    normalizeMcpToolCall,
    safeMcpStringify,
    sanitizeMcpLogArgs,
    type McpToolCallInput,
} from '../mcp/tool-result.js';
import { McpToolWorkflowRunner } from '../mcp/tool-workflow-runner.js';
import { adapterLogger } from '../mcp/file-logger.js';
import type { WorkflowCoreAnalyzer } from '../core/workflows/types.js';
import { handleAdapterError } from './utils.js';

export interface MCPAdapterConfig {
    maxResults?: number;
}

const SUPPORTED_CONFIG_FIELDS = new Set<PropertyKey>(['maxResults']);
const MAX_CONFIGURED_RESULTS = 1000;

function normalizeMcpAdapterConfig(config: unknown): MCPAdapterConfig {
    if (!isPlainConfigObject(config)) {
        throw new CoreError('InvalidParams', 'MCPAdapter config must be a plain object', {
            remediation: 'Pass an object with only the maxResults field, or omit config entirely.',
        });
    }

    const unsupported = Reflect.ownKeys(config).filter((field) => !SUPPORTED_CONFIG_FIELDS.has(field));
    if (unsupported.length > 0) {
        throw new CoreError('InvalidParams', `Unsupported MCPAdapter config field(s): ${unsupported.map(formatConfigFieldName).join(', ')}`, {
            unsupported: unsupported.map(formatConfigFieldName),
            remediation:
                'Keep MCPAdapter config to maxResults only; use registry/tool arguments for execution policy and MCP server environment variables for transports.',
        });
    }

    if ('maxResults' in config && config.maxResults !== undefined) {
        const maxResults = config.maxResults;
        if (!Number.isSafeInteger(maxResults) || maxResults <= 0 || maxResults > MAX_CONFIGURED_RESULTS) {
            throw new CoreError('InvalidParams', `MCPAdapter config maxResults must be an integer from 1 to ${MAX_CONFIGURED_RESULTS}`, {
                field: 'maxResults',
                value: maxResults,
                max: MAX_CONFIGURED_RESULTS,
            });
        }
    }

    return config;
}

function isPlainConfigObject(value: unknown): value is MCPAdapterConfig & Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function formatConfigFieldName(field: PropertyKey): string {
    return typeof field === 'symbol' ? field.toString() : String(field);
}

/**
 * MCP Protocol Adapter - converts MCP tool calls to protocol-shaped responses.
 */
export class MCPAdapter {
    private coreAnalyzer: WorkflowCoreAnalyzer;
    private config: MCPAdapterConfig;
    private toolRunner: McpToolWorkflowRunner;

    constructor(coreAnalyzer: WorkflowCoreAnalyzer, config: MCPAdapterConfig = {}) {
        const normalizedConfig = normalizeMcpAdapterConfig(config);
        this.coreAnalyzer = coreAnalyzer;
        this.config = {
            maxResults: 100,
            ...normalizedConfig,
        };
        this.toolRunner = new McpToolWorkflowRunner(this.coreAnalyzer, {
            maxResults: () => this.config.maxResults || 100,
        });
    }

    /**
     * Get available MCP tools
     */
    getTools() {
        return listMcpTools();
    }

    /**
     * Handle MCP tool call with enhanced error handling.
     *
     * Direct adapter callers receive MCP tool-result error payloads for tool failures.
     */
    async handleToolCall(nameOrRequest: McpToolCallInput, arguments_: Record<string, any> = {}): Promise<any> {
        const { name, args } = normalizeMcpToolCall(nameOrRequest, arguments_);
        try {
            return await this.handleToolCallWithMcpErrors(name, args, { convertValidationErrorsToResult: true });
        } catch (error) {
            // Let servers map CoreError to protocol-specific errors
            if (error instanceof CoreError) {
                throw error;
            }
            // Fallback: return adapter-shaped message for non-core errors
            return handleAdapterError(error, 'mcp');
        }
    }

    /**
     * Handle MCP tool calls for real MCP servers.
     *
     * Validation failures remain protocol errors so transports can emit JSON-RPC error envelopes.
     */
    async handleValidatedToolCall(nameOrRequest: McpToolCallInput, arguments_: Record<string, any> = {}): Promise<any> {
        const { name, args } = normalizeMcpToolCall(nameOrRequest, arguments_);
        return await this.handleToolCallWithMcpErrors(name, args, { convertValidationErrorsToResult: false });
    }

    private async handleToolCallWithMcpErrors(
        name: string,
        args: Record<string, any>,
        options: { convertValidationErrorsToResult: boolean }
    ): Promise<any> {
        const errorHandlingOptions = this.toolRunner.errorHandlingOptionsForTool(name, args);

        return await withMcpErrorHandling('MCPAdapter', `tool_${name}`, async () => {
            adapterLogger.debug(`Handling tool call: ${name}`, {
                args: sanitizeMcpLogArgs(args),
            });

            try {
                this.toolRunner.validate(name, args);
            } catch (error) {
                if (options.convertValidationErrorsToResult) {
                    return handleAdapterError(error, 'mcp');
                }
                throw error;
            }

            const startTime = Date.now();
            let result: any;
            try {
                result = await this.toolRunner.execute(name, args);
            } catch (error) {
                return handleAdapterError(error, 'mcp');
            }

            const duration = Date.now() - startTime;
            const safeStr = safeMcpStringify(result);
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

            return ensureMcpToolResponse(result);
        }, undefined, errorHandlingOptions);
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
