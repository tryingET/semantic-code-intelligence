import * as path from 'node:path';

/**
 * Resolve the workspace root used by protocol/server entrypoints.
 *
 * SEMANTIC_CODE_WORKSPACE is the canonical public environment variable;
 * WORKSPACE_ROOT remains a compatibility fallback for older launchers.
 */
export function resolveConfiguredWorkspaceRoot(explicit?: string): string {
    const candidate = explicit || process.env.SEMANTIC_CODE_WORKSPACE || process.env.WORKSPACE_ROOT || process.cwd();
    return path.resolve(candidate);
}
