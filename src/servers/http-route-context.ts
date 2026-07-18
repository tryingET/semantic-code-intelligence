import type { HTTPAdapter } from '../adapters/http-adapter.js';
import { isCoreError } from '../core/errors.js';
import type { CodeAnalyzer } from '../core/unified-analyzer';
import type { SnapshotWorkflowResult } from '../core/workflows/snapshot-patch-workflow.js';

export interface HTTPRouteContext {
    coreAnalyzer: CodeAnalyzer;
    httpAdapter: HTTPAdapter;
    config: { workspaceRoot?: string };
    executeToolWorkflow(
        name: string,
        args: Record<string, any>,
        opts?: { enforceHttpToolSurface?: boolean }
    ): Promise<SnapshotWorkflowResult>;
    normalizeToolWorkflowResultForHttp(result: SnapshotWorkflowResult): any;
    toolWorkflowPayload(result: SnapshotWorkflowResult, fallback?: any): any;
    toolWorkflowErrorPayload(
        result: SnapshotWorkflowResult,
        fallbackMessage: string
    ): {
        code: string;
        message: string;
        data?: unknown;
    };
    getRequestBody(request: Request): Promise<string | undefined>;
    legacyPipelinesEnabled(): boolean;
    extractQuery(url: string): Record<string, string>;
}

export function statusForCoreErrorCode(code: unknown, fallback = 500): number {
    if (code === 'InvalidParams') return 400;
    if (code === 'UnknownTool') return 404;
    if (code === 'Internal') return 500;
    return fallback;
}

export function statusForThrownError(err: unknown): number {
    return isCoreError(err) ? statusForCoreErrorCode(err.code) : 500;
}

export function envelopeForThrownError(err: unknown): { code: string; message: string; data?: unknown } {
    if (isCoreError(err)) {
        return { code: err.code, message: err.message, data: err.data };
    }
    const message = err instanceof Error ? err.message : String(err || 'Internal server error');
    return { code: 'Internal', message };
}
