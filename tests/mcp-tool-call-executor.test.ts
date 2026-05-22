import { describe, expect, test } from 'bun:test';
import { CoreError } from '../src/core/errors';
import type { ToolAdapter } from '../src/core/tools/executor';
import { McpServerToolCallExecutor, isMcpToolResultSuccess } from '../src/mcp/tool-call-executor';

describe('McpServerToolCallExecutor', () => {
    test('validates unknown tools before invoking the adapter', async () => {
        let called = false;
        const adapter: ToolAdapter = {
            async handleToolCall() {
                called = true;
                return { content: [] };
            },
        };
        const executor = new McpServerToolCallExecutor();

        try {
            await executor.execute(adapter, 'no_such_tool', {});
            throw new Error('expected unknown tool failure');
        } catch (error) {
            expect(error).toBeInstanceOf(CoreError);
            expect((error as CoreError).code).toBe('UnknownTool');
        }
        expect(called).toBe(false);
    });

    test('delegates valid calls after shared validation', async () => {
        const adapter: ToolAdapter = {
            async handleToolCall(name, args) {
                return { content: [{ type: 'text', text: JSON.stringify({ name, args }) }], isError: false };
            },
        };
        const executor = new McpServerToolCallExecutor();

        const result = await executor.execute(adapter, 'get_snapshot', { preferExisting: true });

        expect(isMcpToolResultSuccess(result)).toBe(true);
        expect(JSON.parse(result.content[0].text)).toEqual({ name: 'get_snapshot', args: { preferExisting: true } });
    });

    test('recognizes adapter-shaped error results for metrics', () => {
        expect(isMcpToolResultSuccess({ content: [], isError: false })).toBe(true);
        expect(isMcpToolResultSuccess({ content: [], isError: true })).toBe(false);
        expect(isMcpToolResultSuccess({ content: [] })).toBe(true);
    });
});
