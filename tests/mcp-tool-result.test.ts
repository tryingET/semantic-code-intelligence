import { describe, expect, test } from 'bun:test';
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
});
