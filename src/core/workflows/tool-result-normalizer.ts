import type { CoreErrorCode } from '../errors.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export type WorkflowErrorPayload = {
    code: CoreErrorCode;
    message: string;
    data?: any;
};

function isObject(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeCoreErrorCode(code: unknown, message: string): CoreErrorCode {
    if (code === 'InvalidParams' || code === 'UnknownTool' || code === 'Internal') return code;
    return classifyWorkflowErrorMessage(message);
}

export function classifyWorkflowErrorMessage(message: string): CoreErrorCode {
    const lower = message.toLowerCase();
    if (lower.includes('unknown tool')) return 'UnknownTool';
    if (
        lower.includes('invalid') ||
        lower.includes('missing') ||
        lower.includes('unknown snapshot') ||
        lower.includes('not available') ||
        lower.includes('required') ||
        lower.includes('must be') ||
        lower.includes('not found')
    ) {
        return 'InvalidParams';
    }
    return 'Internal';
}

export function workflowErrorResult(
    code: CoreErrorCode,
    message: string,
    data?: Record<string, any>
): SnapshotWorkflowResult {
    return { payload: { error: { code, message, data } }, isError: true };
}

export function workflowPayload(result: SnapshotWorkflowResult, fallback: any = {}): any {
    try {
        if (result && 'payload' in result) return result.payload;
        if (result && 'text' in result) {
            try {
                return JSON.parse(result.text);
            } catch {
                return fallback;
            }
        }
    } catch {}
    return fallback;
}

export function workflowErrorPayload(
    result: SnapshotWorkflowResult,
    fallbackMessage = 'Tool execution failed'
): WorkflowErrorPayload {
    const payload = workflowPayload(result, undefined);
    if (isObject(payload?.error)) {
        const message = String(payload.error.message || fallbackMessage);
        return {
            code: normalizeCoreErrorCode(payload.error.code, message),
            message,
            data: payload.error.data,
        };
    }
    if (isObject(payload)) {
        const message = String(payload.message || fallbackMessage);
        return {
            code: normalizeCoreErrorCode(payload.code, message),
            message,
            data: payload,
        };
    }
    const message = result && 'text' in result && result.text ? result.text.slice(0, 2000) : fallbackMessage;
    return { code: classifyWorkflowErrorMessage(message), message };
}

export function normalizeWorkflowResult(result: SnapshotWorkflowResult): any {
    try {
        if (result?.isError) return { ok: false, error: workflowErrorPayload(result, 'Tool execution failed') };
        if (result && 'payload' in result) return result.payload;
        if (result && 'text' in result) {
            try {
                return JSON.parse(result.text);
            } catch {
                return { ok: true, content: result.text };
            }
        }
        return { ok: true, value: result };
    } catch {
        return { ok: false, error: { code: 'Internal', message: 'Failed to normalize tool result' } };
    }
}
