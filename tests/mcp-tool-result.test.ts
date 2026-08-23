import { describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { adapterLogger, mcpLogger } from '../src/mcp/file-logger';
import {
    ensureMcpToolResponse,
    formatMcpWorkflowResult,
    isMcpToolResultSuccess,
    normalizeMcpToolCall,
    safeMcpStringify,
    sanitizeMcpLogArgs,
} from '../src/mcp/tool-result';

describe('MCP tool result helpers', () => {
    test('normalizes string and object tool-call inputs', () => {
        expect(normalizeMcpToolCall('read_file', { path: 'README.md' })).toEqual({
            name: 'read_file',
            args: { path: 'README.md' },
        });
        expect(normalizeMcpToolCall({ name: 'get_snapshot', arguments: { preferExisting: true } })).toEqual({
            name: 'get_snapshot',
            args: { preferExisting: true },
        });
    });

    test('formats workflow text and payload results as MCP content', () => {
        expect(formatMcpWorkflowResult({ text: 'hello', isError: false })).toEqual({
            content: [{ type: 'text', text: 'hello' }],
            isError: false,
        });

        const payload = formatMcpWorkflowResult({ payload: { ok: true }, isError: true });
        expect(payload.isError).toBe(true);
        expect(payload.content[0].text).toContain('"ok": true');
    });

    test('ensures arbitrary values have an MCP content envelope', () => {
        expect(ensureMcpToolResponse('plain')).toEqual({ content: [{ type: 'text', text: 'plain' }], isError: false });
        expect(ensureMcpToolResponse({ content: [], isError: true })).toEqual({ content: [], isError: true });
        expect(ensureMcpToolResponse(undefined)).toEqual({ content: [{ type: 'text', text: '' }], isError: false });
    });

    test('redacts sensitive logging arguments and detects result success', () => {
        expect(sanitizeMcpLogArgs({ token: 'secret', path: 'README.md' })).toEqual({
            token: '[REDACTED]',
            path: 'README.md',
        });
        expect(safeMcpStringify({ ok: true })).toBe('{"ok":true}');
        expect(isMcpToolResultSuccess({ content: [], isError: false })).toBe(true);
        expect(isMcpToolResultSuccess({ content: [], isError: true })).toBe(false);
    });

    test('file performance logs classify resolved MCP application failures independently of transport completion', async () => {
        const adapter = new MCPAdapter({} as any, { surface: 'registry' });
        (adapter as any).toolRunner = {
            errorHandlingOptionsForTool: () => undefined,
            validate: () => undefined,
            execute: async (name: string) => ({ content: [], isError: name === 'synthetic_failure' }),
        };

        const adapterOutcomes: boolean[] = [];
        const wrapperOutcomes: boolean[] = [];
        const originalAdapterLogPerformance = adapterLogger.logPerformance;
        const originalMcpLogPerformance = mcpLogger.logPerformance;
        (adapterLogger as any).logPerformance = (_operation: string, _duration: number, success: boolean) => {
            adapterOutcomes.push(success);
        };
        (mcpLogger as any).logPerformance = (_operation: string, _duration: number, success: boolean) => {
            wrapperOutcomes.push(success);
        };

        try {
            const failure = await adapter.handleToolCall('synthetic_failure', {});
            const success = await adapter.handleToolCall('synthetic_success', {});
            expect(failure.isError).toBe(true);
            expect(success.isError).toBe(false);
        } finally {
            (adapterLogger as any).logPerformance = originalAdapterLogPerformance;
            (mcpLogger as any).logPerformance = originalMcpLogPerformance;
        }

        expect(adapterOutcomes).toEqual([false, true]);
        expect(wrapperOutcomes).toEqual([false, true]);
    });
});
