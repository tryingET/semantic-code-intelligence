import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'bun:test';
import { handleAdapterError } from '../src/adapters/error-mapper';
import {
    CoreError,
    WORKSPACE_BOUNDARY_MESSAGE,
    WORKSPACE_BOUNDARY_REASON,
    WORKSPACE_BOUNDARY_REMEDIATION,
} from '../src/core/errors';
import { toMcpToolCallError } from '../src/mcp/tool-call-error';

describe('MCP tool call error mapping', () => {
    test('preserves CoreError protocol mappings', () => {
        const unknown = toMcpToolCallError('no_such_tool', new CoreError('UnknownTool', 'Unknown tool: no_such_tool'));
        expect(unknown.code).toBe(ErrorCode.MethodNotFound);
        expect(unknown.message).toContain('Unknown tool');

        const invalid = toMcpToolCallError(
            'find_definition',
            new CoreError('InvalidParams', 'Missing required parameters: symbol')
        );
        expect(invalid.code).toBe(ErrorCode.InvalidParams);
        expect(invalid.message).toContain('Missing required parameters');
    });

    test('allowlists workspace-boundary messages and recovery data on both MCP error paths', () => {
        const source = new CoreError('InvalidParams', 'outside /host/secret.ts: raw realpath diagnostics', {
            reason: WORKSPACE_BOUNDARY_REASON,
            remediation: 'untrusted producer remediation',
            path: '/host/secret.ts',
            cause: 'raw realpath diagnostics',
        });
        const mapped = toMcpToolCallError('find_definition', source);
        const envelope = handleAdapterError(source, 'mcp') as any;

        expect(mapped.message).toContain(WORKSPACE_BOUNDARY_MESSAGE);
        expect((mapped as McpError & { data?: unknown }).data).toEqual({
            reason: WORKSPACE_BOUNDARY_REASON,
            remediation: WORKSPACE_BOUNDARY_REMEDIATION,
        });
        expect(envelope).toMatchObject({
            isError: true,
            error: {
                message: WORKSPACE_BOUNDARY_MESSAGE,
                data: {
                    reason: WORKSPACE_BOUNDARY_REASON,
                    remediation: WORKSPACE_BOUNDARY_REMEDIATION,
                },
            },
            content: [{ type: 'text', text: WORKSPACE_BOUNDARY_MESSAGE }],
        });

        const serialized = JSON.stringify({ mapped, envelope });
        expect(serialized).not.toContain('/host/secret.ts');
        expect(serialized).not.toContain('raw realpath diagnostics');
        expect(serialized).not.toContain('untrusted producer remediation');
    });

    test('preserves existing McpError instances', () => {
        const original = new McpError(ErrorCode.InvalidParams, 'bad params');

        expect(toMcpToolCallError('tool', original)).toBe(original);
    });

    test('wraps ordinary failures with the existing tool failure message', () => {
        const mapped = toMcpToolCallError('read_file', new Error('disk unavailable'));

        expect(mapped.code).toBe(ErrorCode.InternalError);
        expect(mapped.message).toContain('Tool read_file failed: disk unavailable');
    });
});
