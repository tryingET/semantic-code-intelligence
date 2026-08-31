import * as path from 'node:path';
import { CoreError } from './errors.js';

export const WORKSPACE_REF_SCHEMA = 'semantic-code-intelligence.workspace_ref.v1' as const;
export const WORKSPACE_PATH_REF_SCHEMA = 'semantic-code-intelligence.workspace_path_ref.v1' as const;
export const WORKSPACE_STATE_REF_SCHEMA = 'semantic-code-intelligence.workspace_state_ref.v1' as const;

const WORKSPACE_ID_PATTERN = /^wsp_[0-9a-f]{32}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export type WorkspaceId = `wsp_${string}`;

export type WorkspaceRefV1 = Readonly<{
    schema: typeof WORKSPACE_REF_SCHEMA;
    workspaceId: WorkspaceId;
}>;

export type WorkspacePathRefV1 = Readonly<{
    schema: typeof WORKSPACE_PATH_REF_SCHEMA;
    workspaceId: WorkspaceId;
    path: string;
}>;

export type WorkspaceStateRefV1 = Readonly<{
    schema: typeof WORKSPACE_STATE_REF_SCHEMA;
    workspaceId: WorkspaceId;
    digest: `sha256:${string}`;
}>;

export type WorkspaceReferenceReason =
    | 'workspace_ref_required'
    | 'workspace_ref_mismatch'
    | 'workspace_binding_mismatch'
    | 'workspace_path_invalid'
    | 'workspace_path_unresolved'
    | 'workspace_state_changed'
    | 'workspace_state_unavailable';

const REFERENCE_MESSAGES: Record<WorkspaceReferenceReason, string> = {
    workspace_ref_required: 'A workspace reference is required for this operation',
    workspace_ref_mismatch: 'The workspace reference does not match the configured workspace',
    workspace_binding_mismatch: 'The configured workspace binding is unavailable or has changed',
    workspace_path_invalid: 'The workspace path reference is invalid',
    workspace_path_unresolved: 'The workspace path does not resolve in the configured workspace',
    workspace_state_changed: 'The workspace changed while the operation was running',
    workspace_state_unavailable: 'A complete workspace state receipt could not be produced',
};

const REFERENCE_REMEDIATION: Record<WorkspaceReferenceReason, string> = {
    workspace_ref_required: 'Obtain the current workspace reference and retry without changing roots.',
    workspace_ref_mismatch: 'Start or resume the operation in the target repository workspace.',
    workspace_binding_mismatch: 'Start a fresh process in the intended repository workspace.',
    workspace_path_invalid: 'Use a normalized repository-relative path in the bound workspace.',
    workspace_path_unresolved: 'Verify the current workspace and the repository-relative path.',
    workspace_state_changed: 'Retry from a stable workspace state before planning or applying changes.',
    workspace_state_unavailable: 'Use a bounded repository workspace whose complete state can be verified.',
};

export function workspaceReferenceError(reason: WorkspaceReferenceReason): CoreError {
    return new CoreError('InvalidParams', REFERENCE_MESSAGES[reason], {
        reason,
        remediation: REFERENCE_REMEDIATION[reason],
    });
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
    return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value);
}

export function isWorkspaceRefV1(value: unknown): value is WorkspaceRefV1 {
    const record = plainRecord(value);
    return (
        !!record &&
        hasExactKeys(record, ['schema', 'workspaceId']) &&
        record.schema === WORKSPACE_REF_SCHEMA &&
        isWorkspaceId(record.workspaceId)
    );
}

export function isWorkspacePathRefV1(
    value: unknown,
    options: { allowRoot?: boolean } = {}
): value is WorkspacePathRefV1 {
    const record = plainRecord(value);
    if (
        !record ||
        !hasExactKeys(record, ['schema', 'workspaceId', 'path']) ||
        record.schema !== WORKSPACE_PATH_REF_SCHEMA ||
        !isWorkspaceId(record.workspaceId) ||
        typeof record.path !== 'string'
    ) {
        return false;
    }
    try {
        return normalizeWorkspaceRelativePath(record.path, options) === record.path;
    } catch {
        return false;
    }
}

export function isWorkspaceStateRefV1(value: unknown): value is WorkspaceStateRefV1 {
    const record = plainRecord(value);
    return (
        !!record &&
        hasExactKeys(record, ['schema', 'workspaceId', 'digest']) &&
        record.schema === WORKSPACE_STATE_REF_SCHEMA &&
        isWorkspaceId(record.workspaceId) &&
        typeof record.digest === 'string' &&
        SHA256_PATTERN.test(record.digest)
    );
}

export function assertWorkspaceRef(value: unknown, expected: WorkspaceRefV1): WorkspaceRefV1 {
    if (value === undefined || value === null) throw workspaceReferenceError('workspace_ref_required');
    if (!isWorkspaceRefV1(value) || value.workspaceId !== expected.workspaceId) {
        throw workspaceReferenceError('workspace_ref_mismatch');
    }
    return value;
}

export function assertWorkspaceStateRef(value: unknown, expected: WorkspaceStateRefV1): WorkspaceStateRefV1 {
    if (
        !isWorkspaceStateRefV1(value) ||
        value.workspaceId !== expected.workspaceId ||
        value.digest !== expected.digest
    ) {
        throw workspaceReferenceError('workspace_state_changed');
    }
    return value;
}

export function createWorkspacePathRef(
    workspace: WorkspaceRefV1,
    value: string,
    options: { allowRoot?: boolean } = {}
): WorkspacePathRefV1 {
    return Object.freeze({
        schema: WORKSPACE_PATH_REF_SCHEMA,
        workspaceId: workspace.workspaceId,
        path: normalizeWorkspaceRelativePath(value, options),
    });
}

export function assertWorkspacePathRef(
    value: unknown,
    expected: WorkspaceRefV1,
    options: { allowRoot?: boolean } = {}
): WorkspacePathRefV1 {
    if (value === undefined || value === null) throw workspaceReferenceError('workspace_ref_required');
    const record = plainRecord(value);
    if (
        !record ||
        record.schema !== WORKSPACE_PATH_REF_SCHEMA ||
        !isWorkspaceId(record.workspaceId) ||
        record.workspaceId !== expected.workspaceId
    ) {
        throw workspaceReferenceError('workspace_ref_mismatch');
    }
    if (!hasExactKeys(record, ['schema', 'workspaceId', 'path']) || typeof record.path !== 'string') {
        throw workspaceReferenceError('workspace_path_invalid');
    }
    const normalized = normalizeWorkspaceRelativePath(record.path, options);
    if (normalized !== record.path) throw workspaceReferenceError('workspace_path_invalid');
    return record as WorkspacePathRefV1;
}

export function createWorkspaceStateRef(workspace: WorkspaceRefV1, digest: string): WorkspaceStateRefV1 {
    const normalized = digest.startsWith('sha256:') ? digest : `sha256:${digest}`;
    if (!SHA256_PATTERN.test(normalized)) throw workspaceReferenceError('workspace_state_unavailable');
    return Object.freeze({
        schema: WORKSPACE_STATE_REF_SCHEMA,
        workspaceId: workspace.workspaceId,
        digest: normalized as `sha256:${string}`,
    });
}

export function normalizeWorkspaceRelativePath(value: string, options: { allowRoot?: boolean } = {}): string {
    if (typeof value !== 'string' || !value || value.includes('\0')) {
        throw workspaceReferenceError('workspace_path_invalid');
    }
    const slash = value.replace(/\\/gu, '/');
    if (
        path.posix.isAbsolute(slash) ||
        path.win32.isAbsolute(value) ||
        /^[A-Za-z]:/u.test(value) ||
        /^file:/iu.test(value)
    ) {
        throw workspaceReferenceError('workspace_path_invalid');
    }
    const normalized = path.posix.normalize(slash).replace(/^\.\//u, '');
    if (
        normalized === '..' ||
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        normalized.endsWith('/..') ||
        normalized === '' ||
        (normalized === '.' && options.allowRoot !== true)
    ) {
        throw workspaceReferenceError('workspace_path_invalid');
    }
    return normalized;
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : undefined;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
