import type { SnapshotWorkflowResult } from '../core/workflows/snapshot-patch-workflow.js';

export type McpToolCallInput = string | { name: string; arguments?: Record<string, any> };

export function normalizeMcpToolCall(
    nameOrRequest: McpToolCallInput,
    arguments_: Record<string, any> = {}
): { name: string; args: Record<string, any> } {
    if (typeof nameOrRequest === 'string') {
        return { name: nameOrRequest, args: arguments_ || {} };
    }
    if (nameOrRequest && typeof nameOrRequest === 'object' && 'name' in nameOrRequest) {
        return { name: String(nameOrRequest.name), args: nameOrRequest.arguments || {} };
    }
    return { name: String(nameOrRequest), args: arguments_ || {} };
}

export function formatMcpWorkflowResult(result: SnapshotWorkflowResult) {
    if ('text' in result) {
        return { content: [{ type: 'text', text: result.text }], isError: result.isError === true };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(result.payload, null, 2) }],
        isError: result.isError === true,
    };
}

export function ensureMcpToolResponse(result: any) {
    if (result && typeof result === 'object' && 'content' in result) {
        return result;
    }
    return {
        content: [
            {
                type: 'text',
                text: typeof result === 'string' ? result : safeMcpStringify(result),
            },
        ],
        isError: false,
    };
}

export function sanitizeMcpLogArgs(args: any): any {
    if (!args || typeof args !== 'object') return args;

    const sanitized = { ...args };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];

    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '[REDACTED]';
        }
    }

    return sanitized;
}

export function safeMcpStringify(value: any): string {
    try {
        const serialized = JSON.stringify(value);
        return typeof serialized === 'string' ? serialized : '';
    } catch {
        try {
            return String(value ?? '');
        } catch {
            return '';
        }
    }
}

export function isMcpToolResultSuccess(result: unknown): boolean {
    return !(
        result &&
        typeof result === 'object' &&
        'isError' in result &&
        (result as { isError?: unknown }).isError === true
    );
}
