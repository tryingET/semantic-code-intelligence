import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { CoreError, type CoreErrorCode, isCoreError } from '../core/errors.js';

export function toMcpError(err: unknown): McpError {
    if (isCoreError(err)) {
        switch (err.code) {
            case 'UnknownTool':
                return new McpError(ErrorCode.MethodNotFound, err.message, { data: err.data });
            case 'InvalidParams':
                return new McpError(ErrorCode.InvalidParams, err.message, { data: err.data });
            default:
                return new McpError(ErrorCode.InternalError, err.message, { data: err.data });
        }
    }
    if (err instanceof McpError) return err;
    const msg = err instanceof Error ? err.message : String(err);
    return new McpError(ErrorCode.InternalError, msg);
}

export type AdapterProtocol = 'http' | 'mcp' | 'cli' | 'lsp';

export type McpAdapterErrorEnvelope = {
    isError: true;
    error: { code: string | number; message: string; data?: any };
    content?: Array<{ type: 'text'; text: string }>;
};

export type HttpAdapterErrorEnvelope = {
    status: number;
    error: string;
    details?: any;
};

export type LspAdapterErrorEnvelope = {
    code: number;
    message: string;
    data?: any;
};

function coreToJsonRpcCode(code: CoreErrorCode): number {
    switch (code) {
        case 'InvalidParams':
            return -32602;
        case 'UnknownTool':
            return -32601;
        default:
            return -32603;
    }
}

function coreToHttpStatus(code: CoreErrorCode): number {
    switch (code) {
        case 'InvalidParams':
            return 400;
        case 'UnknownTool':
            return 404;
        default:
            return 500;
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function getErrorMessage(error: unknown): string {
    if (isCoreError(error)) return error.message;
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error === null || error === undefined) return String(error);
    return safeStringify(error);
}

export async function withAdapterTimeout<T>(
    operation: Promise<T>,
    timeoutMs: unknown,
    operationName = 'adapter operation'
): Promise<T> {
    const parsed = Number(timeoutMs);
    if (!Number.isFinite(parsed) || parsed <= 0) return operation;
    const boundedMs = Math.max(1, Math.floor(parsed));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
            reject(
                new CoreError('Internal', `${operationName} timed out after ${boundedMs}ms`, {
                    operation: operationName,
                    timeoutMs: boundedMs,
                })
            );
        }, boundedMs);
    });
    try {
        return await Promise.race([operation, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export function handleAdapterError(
    error: unknown,
    adapter: AdapterProtocol
): string | McpAdapterErrorEnvelope | HttpAdapterErrorEnvelope | LspAdapterErrorEnvelope {
    const message = getErrorMessage(error);
    const core = isCoreError(error) ? error : undefined;
    const includeDebugData = process.env.DEBUG === '1' || process.env.NODE_ENV === 'test';

    if (adapter === 'cli') {
        return message;
    }

    if (adapter === 'lsp') {
        const code = core ? coreToJsonRpcCode(core.code) : -32603;
        const data = includeDebugData ? core?.data : undefined;
        return { code, message, data };
    }

    if (adapter === 'http') {
        const status = core ? coreToHttpStatus(core.code) : 500;
        const details = includeDebugData
            ? { code: core?.code, message, data: core?.data }
            : { code: core?.code, message };
        return { status, error: message, details };
    }

    // MCP
    const errCode: string | number = core ? core.code : -32603;

    const envelope: McpAdapterErrorEnvelope = {
        isError: true,
        error: { code: errCode, message },
        content: [{ type: 'text', text: message }],
    };

    if (core?.data !== undefined && includeDebugData) {
        envelope.error.data = core.data;
    }

    return envelope;
}
