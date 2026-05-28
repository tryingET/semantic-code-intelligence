import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CoreError } from './errors.js';

const READ_NOFOLLOW_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export type OpenWorkspaceFileForReadResult = {
    handle: FileHandle;
    relativePath: string;
    realPath: string;
    realWorkspaceRoot: string;
};

export type OpenWorkspaceFileForReadOptions = {
    workspaceRoot?: string;
    inputLabel?: string;
};

export type ResolveWorkspacePathResult = {
    absolutePath: string;
    relativePath: string;
    realPath: string;
    realWorkspaceRoot: string;
};

export type ResolveWorkspacePathOptions = {
    workspaceRoot?: string;
    inputLabel?: string;
    allowRoot?: boolean;
};

export async function resolveWorkspacePath(
    requestedPath: string,
    options: ResolveWorkspacePathOptions = {}
): Promise<ResolveWorkspacePathResult> {
    const inputLabel = options.inputLabel || 'path';
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const candidate = path.resolve(workspaceRoot, requestedPath);
    const relativePath = assertLexicallyWithinWorkspace(
        workspaceRoot,
        candidate,
        inputLabel,
        requestedPath,
        options.allowRoot === true
    );

    const realWorkspaceRoot = await fs.realpath(workspaceRoot).catch((error) => {
        throw new CoreError('InvalidParams', `Failed to resolve workspace root: ${errorMessage(error)}`, {
            path: requestedPath,
        });
    });

    const realCandidate = await fs.realpath(candidate).catch((error) => {
        throw new CoreError('InvalidParams', `${inputLabel} does not exist or cannot be resolved`, {
            path: requestedPath,
            cause: errorMessage(error),
        });
    });
    assertRealPathWithinWorkspace(
        realWorkspaceRoot,
        realCandidate,
        inputLabel,
        requestedPath,
        options.allowRoot === true
    );

    return {
        absolutePath: candidate,
        relativePath: normalizeRelativePath(relativePath || '.'),
        realPath: realCandidate,
        realWorkspaceRoot,
    };
}

export async function openWorkspaceFileForRead(
    requestedPath: string,
    options: OpenWorkspaceFileForReadOptions = {}
): Promise<OpenWorkspaceFileForReadResult> {
    const inputLabel = options.inputLabel || 'path';
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const resolved = await resolveWorkspacePath(requestedPath, { workspaceRoot, inputLabel });
    const relativePath = resolved.relativePath;
    const realWorkspaceRoot = resolved.realWorkspaceRoot;
    const realCandidate = resolved.realPath;

    const handle = await fs.open(realCandidate, READ_NOFOLLOW_FLAGS).catch((error) => {
        const message = isSymlinkOpenError(error)
            ? `${inputLabel} must not resolve to a symlink during open`
            : `Failed to open ${inputLabel}: ${errorMessage(error)}`;
        throw new CoreError('InvalidParams', message, { path: requestedPath });
    });

    try {
        const openedPath = await realpathOpenFileDescriptor(handle, inputLabel, requestedPath);
        assertRealPathWithinWorkspace(realWorkspaceRoot, openedPath, inputLabel, requestedPath);

        const stat = await handle.stat();
        if (!stat.isFile()) {
            throw new CoreError('InvalidParams', `${inputLabel} does not exist or is not a file`, {
                path: requestedPath,
            });
        }

        return { handle, relativePath: normalizeRelativePath(relativePath), realPath: openedPath, realWorkspaceRoot };
    } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
    }
}

function assertLexicallyWithinWorkspace(
    workspaceRoot: string,
    candidate: string,
    inputLabel: string,
    requestedPath: string,
    allowRoot = false
): string {
    const relativePath = path.relative(workspaceRoot, candidate);
    if (isOutsideWorkspaceRelative(relativePath, allowRoot)) {
        throw new CoreError('InvalidParams', `${inputLabel} must stay within the workspace`, { path: requestedPath });
    }
    return relativePath;
}

function assertRealPathWithinWorkspace(
    realWorkspaceRoot: string,
    realCandidate: string,
    inputLabel: string,
    requestedPath: string,
    allowRoot = false
): void {
    const relativePath = path.relative(realWorkspaceRoot, realCandidate);
    if (isOutsideWorkspaceRelative(relativePath, allowRoot)) {
        throw new CoreError('InvalidParams', `${inputLabel} must stay within the workspace`, { path: requestedPath });
    }
}

export function isOutsideWorkspaceRelative(relativePath: string, allowRoot = false): boolean {
    return (
        (!relativePath && !allowRoot) ||
        relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath)
    );
}

async function realpathOpenFileDescriptor(
    handle: FileHandle,
    inputLabel: string,
    requestedPath: string
): Promise<string> {
    const candidates = [`/proc/self/fd/${handle.fd}`, `/dev/fd/${handle.fd}`];
    const errors: string[] = [];
    for (const candidate of candidates) {
        try {
            return await fs.realpath(candidate);
        } catch (error) {
            errors.push(errorMessage(error));
        }
    }
    throw new CoreError('InvalidParams', `Failed to verify opened ${inputLabel} containment: ${errors.join('; ')}`, {
        path: requestedPath,
    });
}

function normalizeRelativePath(value: string): string {
    return value.split(path.sep).join('/');
}

function isSymlinkOpenError(error: unknown): boolean {
    return !!error && typeof error === 'object' && (error as any).code === 'ELOOP';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
