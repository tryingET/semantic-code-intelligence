import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { toMcpError } from '../adapters/error-mapper.js';
import { isCoreError } from '../core/errors.js';

export function toMcpToolCallError(name: unknown, error: unknown): McpError {
    if (isCoreError(error) || error instanceof McpError) {
        return toMcpError(error);
    }

    return new McpError(
        ErrorCode.InternalError,
        `Tool ${String(name)} failed: ${error instanceof Error ? error.message : String(error)}`
    );
}
