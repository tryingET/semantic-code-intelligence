import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter';

function toolResultText(result: any) {
    return String(result?.content?.[0]?.text || '');
}

describe('MCPAdapter validated server calls', () => {
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
