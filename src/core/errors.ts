/**
 * CoreError: protocol-agnostic error for tool execution and validation.
 * Adapters should avoid throwing protocol-specific errors; servers map CoreError
 * to protocol errors (MCP JSON-RPC, HTTP status, LSP codes, CLI exits).
 */
export type CoreErrorCode = 'UnknownTool' | 'InvalidParams' | 'Internal';

export class CoreError extends Error {
    code: CoreErrorCode;
    data?: any;
    constructor(code: CoreErrorCode, message: string, data?: any) {
        super(message);
        this.code = code;
        this.data = data;
        this.name = 'CoreError';
    }
}

export function isCoreError(err: unknown): err is CoreError {
    return (
        !!err && typeof err === 'object' && (err as any).name === 'CoreError' && typeof (err as any).code === 'string'
    );
}
