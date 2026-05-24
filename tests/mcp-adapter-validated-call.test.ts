import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter';

function toolResultText(result: any) {
    return String(result?.content?.[0]?.text || '');
}

describe('MCPAdapter validated server calls', () => {
    test('constructor rejects every config field except maxResults', () => {
        expect(() => new MCPAdapter(undefined as any, { maxResults: 10 })).not.toThrow();
        expect(() => new MCPAdapter(undefined as any, { timeout: 1 } as any)).toThrow('Unsupported MCPAdapter config field');
        expect(() => new MCPAdapter(undefined as any, { enableSSE: false, ssePort: 9999 } as any)).toThrow('enableSSE, ssePort');
        expect(() => new MCPAdapter(undefined as any, { serverName: 'legacy-name' } as any)).toThrow('serverName');
    });

    test('direct handleToolCall keeps unknown tools as MCP tool-result errors', async () => {
        const adapter = new MCPAdapter(undefined as any);

        const result = await adapter.handleToolCall('no_such_tool', {});

        expect(result.isError).toBe(true);
        expect(toolResultText(result)).toContain('Unknown tool');
    });

    test('handleValidatedToolCall surfaces unknown tools as JSON-RPC method errors', async () => {
        const adapter = new MCPAdapter(undefined as any);

        try {
            await adapter.handleValidatedToolCall('no_such_tool', {});
            throw new Error('Expected MCP error');
        } catch (error) {
            expect(error).toBeInstanceOf(McpError);
            expect((error as McpError).code).toBe(ErrorCode.MethodNotFound);
            expect(String((error as Error).message)).toContain('Unknown tool');
        }
    });

    test('handleValidatedToolCall surfaces missing required args as JSON-RPC invalid params', async () => {
        const adapter = new MCPAdapter(undefined as any);

        try {
            await adapter.handleValidatedToolCall('find_definition', {});
            throw new Error('Expected MCP error');
        } catch (error) {
            expect(error).toBeInstanceOf(McpError);
            expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
            expect(String((error as Error).message)).toContain('Missing required parameters');
        }
    });
});
