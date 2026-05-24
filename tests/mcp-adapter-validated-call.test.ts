import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { CoreError } from '../src/core/errors';

function toolResultText(result: any) {
    return String(result?.content?.[0]?.text || '');
}

function expectInvalidConfig(config: any, message: string) {
    try {
        new MCPAdapter(undefined as any, config);
        throw new Error('Expected invalid MCPAdapter config');
    } catch (error) {
        expect(error).toBeInstanceOf(CoreError);
        expect((error as CoreError).code).toBe('InvalidParams');
        expect(String((error as Error).message)).toContain(message);
    }
}

describe('MCPAdapter validated server calls', () => {
    test('constructor rejects every config field except maxResults', () => {
        expect(() => new MCPAdapter(undefined as any, { maxResults: 10 })).not.toThrow();
        expectInvalidConfig({ timeout: 1 }, 'Unsupported MCPAdapter config field');
        expectInvalidConfig({ enableSSE: false, ssePort: 9999 }, 'enableSSE, ssePort');
        expectInvalidConfig({ serverName: 'legacy-name' }, 'serverName');

        const configWithHiddenField = { maxResults: 10 } as Record<string, unknown>;
        Object.defineProperty(configWithHiddenField, 'hiddenLegacyField', { value: true, enumerable: false });
        expectInvalidConfig(configWithHiddenField, 'hiddenLegacyField');

        expectInvalidConfig({ [Symbol.for('legacy-mcp-config')]: true }, 'Symbol(legacy-mcp-config)');
    });

    test('constructor rejects non-object config and invalid maxResults values', () => {
        expect(() => new MCPAdapter(undefined as any, undefined)).not.toThrow();
        expectInvalidConfig(null, 'MCPAdapter config must be a plain object');
        expectInvalidConfig(42, 'MCPAdapter config must be a plain object');
        expectInvalidConfig(true, 'MCPAdapter config must be a plain object');
        expectInvalidConfig([], 'MCPAdapter config must be a plain object');
        expectInvalidConfig(new Date(), 'MCPAdapter config must be a plain object');
        expectInvalidConfig({ maxResults: 0 }, 'maxResults must be an integer from 1 to 1000');
        expectInvalidConfig({ maxResults: -5 }, 'maxResults must be an integer from 1 to 1000');
        expectInvalidConfig({ maxResults: 2.5 }, 'maxResults must be an integer from 1 to 1000');
        expectInvalidConfig({ maxResults: Number.POSITIVE_INFINITY }, 'maxResults must be an integer from 1 to 1000');
        expectInvalidConfig({ maxResults: Number.MAX_SAFE_INTEGER + 1 }, 'maxResults must be an integer from 1 to 1000');
        expectInvalidConfig({ maxResults: 1001 }, 'maxResults must be an integer from 1 to 1000');
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
            expect(String((error as Error).message)).not.toContain('Operation failed after');
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
            expect(String((error as Error).message)).not.toContain('Operation failed after');
        }
    });
});
