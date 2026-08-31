import { createHash, type Hash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    type WorkspaceBinding,
    assertPathInWorkspaceRepository,
    verifyWorkspaceBinding,
} from './workspace-binding.js';
import { isCoreError } from './errors.js';
import { openWorkspaceFileForRead } from './workspace-path.js';
import {
    type WorkspaceStateRefV1,
    createWorkspaceStateRef,
    normalizeWorkspaceRelativePath,
    workspaceReferenceError,
} from './workspace-ref.js';

const MAX_DISCOVERED_FILES = 20_000;
const MAX_DISCOVERED_BYTES = 512 * 1024 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;
const FILE_CHUNK_BYTES = 256 * 1024;
const EXCLUDED_RUNTIME_SEGMENTS = new Set(['.git', '.ontology', 'node_modules', 'dist', 'coverage', 'build', 'out']);

export async function captureWorkspaceState(
    binding: WorkspaceBinding,
    options: { additionalPaths?: string[] } = {}
): Promise<WorkspaceStateRefV1> {
    try {
        const additionalPaths = (options.additionalPaths || []).map((value) => normalizeWorkspaceRelativePath(value));
        const first = await collectWorkspaceStateDigest(binding, additionalPaths);
        const second = await collectWorkspaceStateDigest(binding, additionalPaths);
        if (first !== second) throw workspaceReferenceError('workspace_state_changed');
        return createWorkspaceStateRef(binding.workspace, first);
    } catch (error) {
        if (hasWorkspaceReason(error)) throw error;
        throw workspaceReferenceError('workspace_state_unavailable');
    }
}

export function sameWorkspaceState(left: WorkspaceStateRefV1, right: WorkspaceStateRefV1): boolean {
    return left.workspaceId === right.workspaceId && left.digest === right.digest;
}

async function collectWorkspaceStateDigest(binding: WorkspaceBinding, additionalPaths: string[]): Promise<string> {
    await verifyWorkspaceBinding(binding);
    const root = binding.root.realRoot;
    const repositoryRoot = git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
    const realRepositoryRoot = await fs.realpath(repositoryRoot).catch(() => {
        throw workspaceReferenceError('workspace_state_unavailable');
    });
    if (!binding.repositoryBoundary || realRepositoryRoot !== binding.repositoryBoundary.realRoot) {
        throw workspaceReferenceError('workspace_state_unavailable');
    }

    const hash = createHash('sha256');
    hash.update(`workspace:${binding.workspace.workspaceId}\0`);
    const runtimeExclusion = ':(exclude).ontology';
    addGit(hash, root, ['rev-parse', 'HEAD'], 'head');
    addGit(hash, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', runtimeExclusion], 'status');
    addGit(hash, root, ['diff', '--no-ext-diff', '--binary', '--', '.', runtimeExclusion], 'diff');
    addGit(hash, root, ['diff', '--no-ext-diff', '--cached', '--binary', '--', '.', runtimeExclusion], 'cached-diff');

    const ordinary = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', runtimeExclusion]);
    const ignored = git(root, [
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '-z',
        '--',
        '.',
        runtimeExclusion,
    ]);
    const discovered = uniqueRelativePaths(ordinary, ignored);
    for (const relative of additionalPaths) discovered.push(relative);
    discovered.sort((left, right) => left.localeCompare(right));
    const uniqueDiscovered = [...new Set(discovered)];
    if (uniqueDiscovered.length > MAX_DISCOVERED_FILES) throw workspaceReferenceError('workspace_state_unavailable');
    hash.update('non-indexed-list\0');
    hash.update(uniqueDiscovered.join('\0'));
    hash.update('\0');

    let totalBytes = 0;
    for (const relative of uniqueDiscovered) {
        const lexicalPath = path.resolve(root, relative);
        const lexicalBefore = await fs.lstat(lexicalPath).catch(() => {
            throw workspaceReferenceError('workspace_state_changed');
        });
        if (lexicalBefore.isSymbolicLink()) {
            await assertPathInWorkspaceRepository(binding, path.dirname(lexicalPath));
            const target = await fs.readlink(lexicalPath).catch(() => {
                throw workspaceReferenceError('workspace_state_changed');
            });
            const lexicalAfter = await fs.lstat(lexicalPath).catch(() => {
                throw workspaceReferenceError('workspace_state_changed');
            });
            if (
                lexicalBefore.dev !== lexicalAfter.dev ||
                lexicalBefore.ino !== lexicalAfter.ino ||
                lexicalBefore.mtimeMs !== lexicalAfter.mtimeMs ||
                !lexicalAfter.isSymbolicLink()
            ) {
                throw workspaceReferenceError('workspace_state_changed');
            }
            totalBytes += Buffer.byteLength(target, 'utf8');
            if (totalBytes > MAX_DISCOVERED_BYTES) throw workspaceReferenceError('workspace_state_unavailable');
            hash.update(`non-indexed-symlink:${relative}:${target}\0`);
            continue;
        }

        const opened = await openWorkspaceFileForRead(relative, {
            workspaceRoot: root,
            inputLabel: 'workspace state file',
            binding,
        }).catch(() => {
            throw workspaceReferenceError('workspace_state_changed');
        });
        try {
            const before = await opened.handle.stat();
            if (!before.isFile()) throw workspaceReferenceError('workspace_state_unavailable');
            totalBytes += before.size;
            if (totalBytes > MAX_DISCOVERED_BYTES) throw workspaceReferenceError('workspace_state_unavailable');
            hash.update(`non-indexed:${opened.relativePath}:${before.size}\0`);
            await hashFileHandle(opened.handle, hash, before.size);
            const after = await opened.handle.stat();
            if (
                before.dev !== after.dev ||
                before.ino !== after.ino ||
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs ||
                before.ctimeMs !== after.ctimeMs
            ) {
                throw workspaceReferenceError('workspace_state_changed');
            }
            hash.update('\0');
        } finally {
            await opened.handle.close().catch(() => undefined);
        }
    }
    await verifyWorkspaceBinding(binding);
    return hash.digest('hex');
}

function addGit(hash: Hash, root: string, args: string[], label: string): void {
    hash.update(label);
    hash.update('\0');
    hash.update(git(root, args));
    hash.update('\0');
}

function git(root: string, args: string[]): Buffer {
    const result = spawnSync('git', args, {
        cwd: root,
        encoding: 'buffer',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        timeout: GIT_TIMEOUT_MS,
    });
    if (result.status !== 0 || result.error) throw workspaceReferenceError('workspace_state_unavailable');
    return result.stdout;
}

function uniqueRelativePaths(...outputs: Buffer[]): string[] {
    const paths = new Set<string>();
    for (const output of outputs) {
        for (const value of output.toString('utf8').split('\0')) {
            if (!value) continue;
            const normalized = value.replace(/\\/gu, '/');
            if (normalized.split('/').some((segment) => EXCLUDED_RUNTIME_SEGMENTS.has(segment))) continue;
            paths.add(normalized);
        }
    }
    return [...paths].sort((left, right) => left.localeCompare(right));
}

function hasWorkspaceReason(error: unknown): boolean {
    return isCoreError(error) && typeof error.data?.reason === 'string' && error.data.reason.startsWith('workspace_');
}

async function hashFileHandle(handle: fs.FileHandle, hash: Hash, expectedSize: number): Promise<void> {
    const buffer = Buffer.allocUnsafe(Math.min(FILE_CHUNK_BYTES, Math.max(1, expectedSize)));
    let offset = 0;
    while (offset < expectedSize) {
        const length = Math.min(buffer.length, expectedSize - offset);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead <= 0) throw workspaceReferenceError('workspace_state_changed');
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
    }
}
