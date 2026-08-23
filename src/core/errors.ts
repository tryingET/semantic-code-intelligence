/**
 * CoreError: protocol-agnostic error for tool execution and validation.
 * Adapters should avoid throwing protocol-specific errors; servers map CoreError
 * to protocol errors (MCP JSON-RPC, HTTP status, LSP codes, CLI exits).
 */
export type CoreErrorCode = 'UnknownTool' | 'InvalidParams' | 'Internal';

export const WORKSPACE_BOUNDARY_REASON = 'outside_workspace' as const;
export const WORKSPACE_BOUNDARY_MESSAGE = 'Requested path must stay within the configured workspace' as const;
export const WORKSPACE_BOUNDARY_REMEDIATION =
    'Use a path within the configured workspace, expressed as a workspace-relative path or a contained absolute path.' as const;

export type PublicCoreErrorData = {
    reason: typeof WORKSPACE_BOUNDARY_REASON;
    remediation: typeof WORKSPACE_BOUNDARY_REMEDIATION;
};

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

export function workspaceBoundaryError(inputLabel: string): CoreError {
    return new CoreError('InvalidParams', `${inputLabel} must stay within the workspace`, {
        reason: WORKSPACE_BOUNDARY_REASON,
        remediation: WORKSPACE_BOUNDARY_REMEDIATION,
    } satisfies PublicCoreErrorData);
}

/**
 * Return bounded public recovery fields for recognized CoreError variants.
 * Adapters pair this with WORKSPACE_BOUNDARY_MESSAGE; producer-supplied messages,
 * remediation, and unrelated CoreError data are never part of that projection.
 */
export function publicCoreErrorData(error: unknown): PublicCoreErrorData | undefined {
    if (!isCoreError(error) || error.data?.reason !== WORKSPACE_BOUNDARY_REASON) return undefined;
    return {
        reason: WORKSPACE_BOUNDARY_REASON,
        remediation: WORKSPACE_BOUNDARY_REMEDIATION,
    };
}
