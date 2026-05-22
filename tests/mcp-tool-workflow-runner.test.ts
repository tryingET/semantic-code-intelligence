import { describe, expect, test } from 'bun:test';
import type { ToolAdapter } from '../src/core/tools/executor';
import { McpToolWorkflowRunner } from '../src/mcp/tool-workflow-runner';

describe('McpToolWorkflowRunner', () => {
    test('executes through a validated tool executor and formats MCP workflow results', async () => {
        const calls: Array<{ adapter: ToolAdapter; name: string; args: Record<string, any> }> = [];
        const runner = new McpToolWorkflowRunner({} as any, {
            toolRouter: { handleToolCall: async () => ({ payload: { unused: true } }) },
            toolExecutor: {
                getSpec: () => undefined,
                execute: async (adapter, name, args) => {
                    calls.push({ adapter, name, args });
                    return { payload: { ok: true, name, args }, isError: false };
                },
            },
        });

        const result = await runner.execute('get_snapshot', { preferExisting: true });

        expect(calls).toHaveLength(1);
        expect(calls[0].name).toBe('get_snapshot');
        expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, name: 'get_snapshot', args: { preferExisting: true } });
        expect(result.isError).toBe(false);
    });

    test('derives MCP recovery options from registry execution policy', () => {
        const runner = new McpToolWorkflowRunner({} as any);

        expect(runner.errorHandlingOptionsForTool('read_file', {})).toBeUndefined();
        expect(
            runner.errorHandlingOptionsForTool('patch_checks_in_snapshot', {
                commands: ['bun run typecheck', 'bun test tests/mcp-tool-workflow-runner.test.ts'],
                timeoutSec: 120,
            })
        ).toEqual({ timeoutMs: 270_000, maxRetries: 0 });
    });
});
