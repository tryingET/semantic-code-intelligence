import { constants } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CoreError } from './errors.js';

const READ_NOFOLLOW_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const DIRECTORY_NOFOLLOW_FLAGS = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);

export type OpenWorkspaceFileForReadResult = {
    handle: FileHandle;
    relativePath: string;
    realPath: string;
    realWorkspaceRoot: string;
};

export type OpenWorkspaceDirectoryForReadResult = {
    handle: FileHandle;
    fdPath: string;
    relativePath: string;
    realPath: string;
    realWorkspaceRoot: string;
};

export type OpenWorkspaceFileForReadOptions = {
    workspaceRoot?: string;
    inputLabel?: string;
};

export type OpenWorkspaceDirectoryForReadOptions = {
    workspaceRoot?: string;
    inputLabel?: string;
    allowRoot?: boolean;
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

export type WorkspaceFileWalkEntry = {
    relativePath: string;
    realPath: string;
    size: number;
};

export type WalkWorkspaceFilesForReadOptions = {
    rootPath?: string;
    workspaceRoot?: string;
    maxFiles?: number;
    maxDepth?: number;
    extensionPattern?: RegExp;
    ignoreNames?: Set<string>;
};

export async function resolveWorkspacePath(
    requestedPath: string,
    options: ResolveWorkspacePathOptions = {}
): Promise<ResolveWorkspacePathResult> {
    const inputLabel = options.inputLabel || 'path';
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const candidate = path.resolve(workspaceRoot, requestedPath);
    const allowRoot = options.allowRoot === true;

    // Relative inputs must be lexically contained before any realpath lookups. Absolute
    // inputs are allowed to use a realpath spelling of a symlinked workspace root; their
    // containment is enforced by the realpath check below.
    const candidateLexicalRelative = path.relative(workspaceRoot, candidate);
    const lexicalRelativePath = !isOutsideWorkspaceRelative(candidateLexicalRelative, allowRoot)
        ? candidateLexicalRelative
        : null;
    if (!lexicalRelativePath && !path.isAbsolute(requestedPath)) {
        assertLexicallyWithinWorkspace(workspaceRoot, candidate, inputLabel, requestedPath, allowRoot);
    }

    const realWorkspaceRoot = await fs.realpath(workspaceRoot).catch((error) => {
        throw new CoreError('InvalidParams', `Failed to resolve workspace root: ${errorMessage(error)}`, {
            path: requestedPath,
        });
    });

    const realCandidate = await fs.realpath(candidate).catch((error) => {
        if (lexicalRelativePath === null) {
            throw new CoreError('InvalidParams', `${inputLabel} must stay within the workspace`, {
                path: requestedPath,
            });
        }
        throw new CoreError('InvalidParams', `${inputLabel} does not exist or cannot be resolved`, {
            path: requestedPath,
            cause: errorMessage(error),
        });
    });
    assertRealPathWithinWorkspace(realWorkspaceRoot, realCandidate, inputLabel, requestedPath, allowRoot);
    const relativePath = lexicalRelativePath ?? path.relative(realWorkspaceRoot, realCandidate);

    return {
        absolutePath: candidate,
        relativePath: normalizeRelativePath(relativePath || '.'),
        realPath: realCandidate,
        realWorkspaceRoot,
    };
}

export async function* walkWorkspaceFilesForRead(
    options: WalkWorkspaceFilesForReadOptions = {}
): AsyncGenerator<WorkspaceFileWalkEntry> {
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const rootPath = options.rootPath || '.';
    const maxFiles = Math.max(1, Math.min(20_000, Math.floor(options.maxFiles ?? 1000)));
    const maxDepth = Math.max(0, Math.min(50, Math.floor(options.maxDepth ?? 10)));
    const extensionPattern = options.extensionPattern;
    const ignoreNames =
        options.ignoreNames || new Set(['.git', 'node_modules', '.ontology', 'dist', 'coverage', 'build', 'out']);
    const root = await resolveWorkspacePath(rootPath, {
        workspaceRoot,
        inputLabel: 'workspace traversal root',
        allowRoot: true,
    });
    try {
        const openedFile = await openWorkspaceFileForRead(rootPath, {
            workspaceRoot,
            inputLabel: 'workspace traversal root file',
        });
        try {
            const name = path.basename(openedFile.relativePath);
            const stat = await openedFile.handle.stat();
            if ((!extensionPattern || extensionPattern.test(name)) && stat.isFile()) {
                yield { relativePath: openedFile.relativePath, realPath: openedFile.realPath, size: stat.size };
            }
        } finally {
            await openedFile.handle.close().catch(() => undefined);
        }
        return;
    } catch {}

    const queue: Array<{ realDir: string; depth: number }> = [{ realDir: root.realPath, depth: 0 }];
    const visited = new Set<string>();
    let yielded = 0;

    while (queue.length && yielded < maxFiles) {
        const { realDir, depth } = queue.shift()!;
        if (depth > maxDepth) continue;
        let openedDir: OpenWorkspaceDirectoryForReadResult | null = null;
        let openedDirPath = '';
        let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> = [];
        try {
            openedDir = await openWorkspaceDirectoryForRead(realDir, {
                workspaceRoot: root.realWorkspaceRoot,
                inputLabel: 'workspace traversal directory',
                allowRoot: true,
            });
            if (visited.has(openedDir.realPath)) continue;
            visited.add(openedDir.realPath);
            openedDirPath = openedDir.realPath;
            entries = (
                (await fs.readdir(openedDir.fdPath, { withFileTypes: true } as any)) as unknown as Array<{
                    name: string;
                    isDirectory(): boolean;
                    isFile(): boolean;
                }>
            ).sort((a, b) => a.name.localeCompare(b.name));
        } catch {
            continue;
        } finally {
            await openedDir?.handle.close().catch(() => undefined);
        }

        for (const entry of entries) {
            if (yielded >= maxFiles) break;
            if (ignoreNames.has(entry.name)) continue;
            const candidate = path.join(openedDirPath, entry.name);
            const realCandidate = await fs.realpath(candidate).catch(() => null);
            if (!realCandidate) continue;
            try {
                assertRealPathWithinWorkspace(
                    root.realWorkspaceRoot,
                    realCandidate,
                    'workspace traversal entry',
                    rootPath
                );
            } catch {
                continue;
            }

            if (entry.isDirectory()) {
                queue.push({ realDir: realCandidate, depth: depth + 1 });
                continue;
            }
            if (!entry.isFile()) continue;
            if (extensionPattern && !extensionPattern.test(entry.name)) continue;
            const stat = await fs.stat(realCandidate).catch(() => null);
            if (!stat?.isFile()) continue;
            const relativePath = normalizeRelativePath(path.relative(root.realWorkspaceRoot, realCandidate));
            if (!relativePath || isOutsideWorkspaceRelative(relativePath)) continue;
            yielded++;
            yield { relativePath, realPath: realCandidate, size: stat.size };
        }
    }
}

export async function openWorkspaceDirectoryForRead(
    requestedPath: string,
    options: OpenWorkspaceDirectoryForReadOptions = {}
): Promise<OpenWorkspaceDirectoryForReadResult> {
    const inputLabel = options.inputLabel || 'path';
    const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
    const resolved = await resolveWorkspacePath(requestedPath, {
        workspaceRoot,
        inputLabel,
        allowRoot: options.allowRoot === true,
    });

    const handle = await fs.open(resolved.realPath, DIRECTORY_NOFOLLOW_FLAGS).catch((error) => {
        const message = isSymlinkOpenError(error)
            ? `${inputLabel} must not resolve to a symlink during open`
            : `Failed to open ${inputLabel}: ${errorMessage(error)}`;
        throw new CoreError('InvalidParams', message, { path: requestedPath });
    });

    try {
        const fdPath = await openFileDescriptorPath(handle, inputLabel, requestedPath);
        const openedPath = await fs.realpath(fdPath);
        assertRealPathWithinWorkspace(resolved.realWorkspaceRoot, openedPath, inputLabel, requestedPath, true);

        const stat = await handle.stat();
        if (!stat.isDirectory()) {
            throw new CoreError('InvalidParams', `${inputLabel} does not exist or is not a directory`, {
                path: requestedPath,
            });
        }

        return {
            handle,
            fdPath,
            relativePath: normalizeRelativePath(resolved.relativePath),
            realPath: openedPath,
            realWorkspaceRoot: resolved.realWorkspaceRoot,
        };
    } catch (error) {
        await handle.close().catch(() => undefined);
        throw error;
    }
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

async function openFileDescriptorPath(handle: FileHandle, inputLabel: string, requestedPath: string): Promise<string> {
    const candidates = [`/proc/self/fd/${handle.fd}`, `/dev/fd/${handle.fd}`];
    const errors: string[] = [];
    for (const candidate of candidates) {
        try {
            await fs.realpath(candidate);
            return candidate;
        } catch (error) {
            errors.push(errorMessage(error));
        }
    }
    throw new CoreError('InvalidParams', `Failed to verify opened ${inputLabel} containment: ${errors.join('; ')}`, {
        path: requestedPath,
    });
}

async function realpathOpenFileDescriptor(
    handle: FileHandle,
    inputLabel: string,
    requestedPath: string
): Promise<string> {
    return fs.realpath(await openFileDescriptorPath(handle, inputLabel, requestedPath));
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
