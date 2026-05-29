import { resolveRuntimeWorkspaceRoot } from './runtime-config.js';

/**
 * Resolve the workspace root used by protocol/server entrypoints.
 *
 * SEMANTIC_CODE_WORKSPACE is the canonical public environment variable;
 * WORKSPACE_ROOT remains a compatibility fallback for older launchers.
 * When no explicit/env root is set, the checked-in SCI runtime config is
 * honored before falling back to the caller-provided/default cwd.
 */
export function resolveConfiguredWorkspaceRoot(explicit?: string, fallback?: string): string {
    return resolveRuntimeWorkspaceRoot(explicit, fallback);
}
