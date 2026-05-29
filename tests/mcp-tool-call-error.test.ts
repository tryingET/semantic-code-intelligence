import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, test } from 'bun:test';
import { CoreError } from '../src/core/errors';
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
