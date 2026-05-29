import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WORKSPACE_FILE_URI = 'file://workspace';

/**
 * Convert public file/path inputs into an absolute filesystem path scoped to a
 * caller-provided workspace root. This is the shared boundary normalizer for
 * CLI/MCP/HTTP/LSP workflow inputs; containment is still enforced separately by
 * workspace-path helpers after normalization.
 */
export function workspaceInputToPath(
    value: string | undefined | null,
    workspaceRoot: string,
    fallback = WORKSPACE_FILE_URI
): string {
    const root = path.resolve(workspaceRoot || process.cwd());
    const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback;

    if (raw === WORKSPACE_FILE_URI || raw.startsWith(`${WORKSPACE_FILE_URI}/`)) {
        const suffix = raw.slice(WORKSPACE_FILE_URI.length).replace(/^\/+/, '');
        let relative = suffix;
        try {
            relative = decodeURIComponent(suffix);
        } catch {}
        return path.resolve(relative ? path.join(root, relative) : root);
    }

    if (raw.startsWith('file://')) {
        return fileURLToPath(raw);
    }

    return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
}

export function normalizeWorkspaceInputUri(
    value: string | undefined | null,
    workspaceRoot: string,
    fallback = WORKSPACE_FILE_URI
): string {
    return pathToFileURL(workspaceInputToPath(value, workspaceRoot, fallback)).href;
}
