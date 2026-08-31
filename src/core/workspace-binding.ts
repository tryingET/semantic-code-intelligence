import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createBindingFile, ensureBindingStorage, readBindingFile } from './workspace-binding-storage.js';
import { CoreError } from './errors.js';
import {
    WORKSPACE_REF_SCHEMA,
    type WorkspaceId,
    type WorkspaceRefV1,
    isWorkspaceId,
    workspaceReferenceError,
} from './workspace-ref.js';

const BINDING_SCHEMA = 'semantic-code-intelligence.workspace_binding.v1' as const;

export type WorkspaceFilesystemIdentity = Readonly<{
    realRoot: string;
    device: string;
    inode: string;
}>;

export type WorkspaceRepositoryBoundary = Readonly<
    WorkspaceFilesystemIdentity & {
        markerKind: 'directory' | 'gitfile' | 'bare';
        markerRealPath: string;
        markerDevice: string;
        markerInode: string;
    }
>;

export type WorkspaceBinding = Readonly<{
    schema: typeof BINDING_SCHEMA;
    workspace: WorkspaceRefV1;
    root: WorkspaceFilesystemIdentity;
    repositoryBoundary: WorkspaceRepositoryBoundary | null;
    createdAt: string;
}>;

type PersistedBinding = {
    schema: typeof BINDING_SCHEMA;
    workspaceId: WorkspaceId;
    realRoot: string;
    rootDevice: string;
    rootInode: string;
    repositoryBoundary: WorkspaceRepositoryBoundary | null;
    createdAt: string;
};

export async function loadOrCreateWorkspaceBinding(workspaceRoot: string): Promise<WorkspaceBinding> {
    try {
        const root = await resolveFilesystemIdentity(workspaceRoot);
        const repositoryBoundary = await findRepositoryBoundary(root.realRoot);
        const storage = await ensureBindingStorage(root.realRoot, resolveFilesystemIdentity);
        let text = await readBindingFile(storage);
        if (!text) {
            const binding: PersistedBinding = {
                schema: BINDING_SCHEMA,
                workspaceId: `wsp_${randomUUID().replace(/-/gu, '').toLowerCase()}` as WorkspaceId,
                realRoot: root.realRoot,
                rootDevice: root.device,
                rootInode: root.inode,
                repositoryBoundary,
                createdAt: new Date().toISOString(),
            };
            await createBindingFile(storage, `${JSON.stringify(binding, null, 2)}\n`);
            text = await readBindingFile(storage);
        }
        if (!text) throw bindingError();
        return validateBinding(parseBinding(text), root, repositoryBoundary);
    } catch (error) {
        throw safeBindingError(error);
    }
}

export async function verifyWorkspaceBinding(binding: WorkspaceBinding): Promise<void> {
    try {
        const current = await resolveFilesystemIdentity(binding.root.realRoot);
        if (!sameIdentity(current, binding.root)) throw bindingError();
        const repositoryBoundary = await findRepositoryBoundary(current.realRoot);
        if (!sameNullableBoundary(repositoryBoundary, binding.repositoryBoundary)) throw bindingError();
    } catch (error) {
        throw safeBindingError(error);
    }
}

export async function assertPathInWorkspaceRepository(
    binding: WorkspaceBinding,
    realTarget: string
): Promise<void> {
    await verifyWorkspaceBinding(binding);
    const target = await fs.realpath(realTarget).catch(() => {
        throw workspaceReferenceError('workspace_path_unresolved');
    });
    if (!isInsideOrEqual(binding.root.realRoot, target)) {
        throw workspaceReferenceError('workspace_ref_mismatch');
    }

    let targetStat: Awaited<ReturnType<typeof fs.stat>>;
    try {
        targetStat = await fs.stat(target);
    } catch {
        throw workspaceReferenceError('workspace_path_unresolved');
    }
    let current = targetStat.isDirectory() ? target : path.dirname(target);
    while (current !== binding.root.realRoot) {
        if (!isInsideOrEqual(binding.root.realRoot, current)) {
            throw workspaceReferenceError('workspace_ref_mismatch');
        }
        if (await inspectRepositoryBoundaryAt(current, true)) {
            throw workspaceReferenceError('workspace_ref_mismatch');
        }
        const parent = path.dirname(current);
        if (parent === current) throw workspaceReferenceError('workspace_ref_mismatch');
        current = parent;
    }
}

export function workspaceBindingPath(workspaceRoot: string): string {
    return path.join(path.resolve(workspaceRoot), '.ontology', 'nexus', 'workspace-binding.json');
}

async function resolveFilesystemIdentity(value: string): Promise<WorkspaceFilesystemIdentity> {
    try {
        const realRoot = await fs.realpath(path.resolve(value));
        const stat = await fs.stat(realRoot, { bigint: true });
        if (!stat.isDirectory()) throw bindingError();
        return Object.freeze({ realRoot, device: stat.dev.toString(), inode: stat.ino.toString() });
    } catch (error) {
        throw safeBindingError(error);
    }
}

async function findRepositoryBoundary(start: string): Promise<WorkspaceRepositoryBoundary | null> {
    let current = start;
    while (true) {
        const boundary = await inspectRepositoryBoundaryAt(current, false);
        if (boundary) return boundary;
        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

async function inspectRepositoryBoundaryAt(
    directory: string,
    suspiciousMarkerIsBoundary: boolean
): Promise<WorkspaceRepositoryBoundary | null> {
    const dotGit = path.join(directory, '.git');
    let marker: Awaited<ReturnType<typeof fs.lstat>> | null = null;
    try {
        marker = await fs.lstat(dotGit, { bigint: true });
    } catch (error: any) {
        if (error?.code !== 'ENOENT') throw bindingError();
    }
    if (marker) {
        if (marker.isSymbolicLink()) {
            if (suspiciousMarkerIsBoundary) return suspiciousBoundary(directory, dotGit, marker);
            throw bindingError();
        }
        if (marker.isDirectory()) {
            if (!(await validGitDirectory(dotGit))) {
                if (suspiciousMarkerIsBoundary) return suspiciousBoundary(directory, dotGit, marker);
                throw bindingError();
            }
            return repositoryBoundary(directory, 'directory', dotGit, marker);
        }
        if (marker.isFile()) {
            const target = await parseGitFile(dotGit);
            if (!target) {
                if (suspiciousMarkerIsBoundary) return suspiciousBoundary(directory, dotGit, marker);
                throw bindingError();
            }
            const targetIdentity = await resolveFilesystemIdentity(target);
            return Object.freeze({
                ...(await resolveFilesystemIdentity(directory)),
                markerKind: 'gitfile' as const,
                markerRealPath: targetIdentity.realRoot,
                markerDevice: targetIdentity.device,
                markerInode: targetIdentity.inode,
            });
        }
        if (suspiciousMarkerIsBoundary) return suspiciousBoundary(directory, dotGit, marker);
        throw bindingError();
    }

    if (await validGitDirectory(directory)) {
        const identity = await resolveFilesystemIdentity(directory);
        return Object.freeze({
            ...identity,
            markerKind: 'bare' as const,
            markerRealPath: identity.realRoot,
            markerDevice: identity.device,
            markerInode: identity.inode,
        });
    }
    return null;
}

async function validGitDirectory(directory: string): Promise<boolean> {
    try {
        const [head, objects, refs] = await Promise.all([
            fs.lstat(path.join(directory, 'HEAD')),
            fs.lstat(path.join(directory, 'objects')),
            fs.lstat(path.join(directory, 'refs')),
        ]);
        return head.isFile() && objects.isDirectory() && refs.isDirectory();
    } catch {
        return false;
    }
}

async function parseGitFile(file: string): Promise<string | null> {
    try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.size <= 0 || stat.size > 4096) return null;
        const match = /^gitdir:\s*(.+?)\s*$/u.exec(await fs.readFile(file, 'utf8'));
        return match ? path.resolve(path.dirname(file), match[1]) : null;
    } catch {
        return null;
    }
}

async function repositoryBoundary(
    directory: string,
    markerKind: 'directory',
    markerPath: string,
    marker: { dev: bigint; ino: bigint }
): Promise<WorkspaceRepositoryBoundary> {
    const identity = await resolveFilesystemIdentity(directory);
    const markerRealPath = await fs.realpath(markerPath).catch(() => {
        throw bindingError();
    });
    return Object.freeze({
        ...identity,
        markerKind,
        markerRealPath,
        markerDevice: marker.dev.toString(),
        markerInode: marker.ino.toString(),
    });
}

async function suspiciousBoundary(
    directory: string,
    markerPath: string,
    marker: { dev: bigint; ino: bigint }
): Promise<WorkspaceRepositoryBoundary> {
    return Object.freeze({
        ...(await resolveFilesystemIdentity(directory)),
        markerKind: 'directory' as const,
        markerRealPath: markerPath,
        markerDevice: marker.dev.toString(),
        markerInode: marker.ino.toString(),
    });
}

function parseBinding(text: string): PersistedBinding {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw bindingError();
    }
    const record = plainRecord(value);
    if (
        !record ||
        !hasExactKeys(record, [
            'schema',
            'workspaceId',
            'realRoot',
            'rootDevice',
            'rootInode',
            'repositoryBoundary',
            'createdAt',
        ]) ||
        record.schema !== BINDING_SCHEMA ||
        !isWorkspaceId(record.workspaceId) ||
        typeof record.realRoot !== 'string' ||
        !path.isAbsolute(record.realRoot) ||
        typeof record.rootDevice !== 'string' ||
        typeof record.rootInode !== 'string' ||
        typeof record.createdAt !== 'string'
    ) {
        throw bindingError();
    }
    return {
        schema: BINDING_SCHEMA,
        workspaceId: record.workspaceId,
        realRoot: record.realRoot,
        rootDevice: record.rootDevice,
        rootInode: record.rootInode,
        repositoryBoundary: parseRepositoryBoundary(record.repositoryBoundary),
        createdAt: record.createdAt,
    };
}

function parseRepositoryBoundary(value: unknown): WorkspaceRepositoryBoundary | null {
    if (value === null) return null;
    const record = plainRecord(value);
    if (
        !record ||
        !hasExactKeys(record, [
            'realRoot',
            'device',
            'inode',
            'markerKind',
            'markerRealPath',
            'markerDevice',
            'markerInode',
        ]) ||
        typeof record.realRoot !== 'string' ||
        !path.isAbsolute(record.realRoot) ||
        typeof record.device !== 'string' ||
        typeof record.inode !== 'string' ||
        !['directory', 'gitfile', 'bare'].includes(String(record.markerKind)) ||
        typeof record.markerRealPath !== 'string' ||
        !path.isAbsolute(record.markerRealPath) ||
        typeof record.markerDevice !== 'string' ||
        typeof record.markerInode !== 'string'
    ) {
        throw bindingError();
    }
    return record as WorkspaceRepositoryBoundary;
}

function validateBinding(
    persisted: PersistedBinding,
    root: WorkspaceFilesystemIdentity,
    repositoryBoundary: WorkspaceRepositoryBoundary | null
): WorkspaceBinding {
    const persistedRoot = {
        realRoot: persisted.realRoot,
        device: persisted.rootDevice,
        inode: persisted.rootInode,
    };
    if (!sameIdentity(persistedRoot, root) || !sameNullableBoundary(persisted.repositoryBoundary, repositoryBoundary)) {
        throw bindingError();
    }
    return Object.freeze({
        schema: BINDING_SCHEMA,
        workspace: Object.freeze({ schema: WORKSPACE_REF_SCHEMA, workspaceId: persisted.workspaceId }),
        root: Object.freeze(root),
        repositoryBoundary: repositoryBoundary ? Object.freeze(repositoryBoundary) : null,
        createdAt: persisted.createdAt,
    });
}

function sameIdentity(left: WorkspaceFilesystemIdentity, right: WorkspaceFilesystemIdentity): boolean {
    return left.realRoot === right.realRoot && left.device === right.device && left.inode === right.inode;
}

function sameNullableBoundary(
    left: WorkspaceRepositoryBoundary | null,
    right: WorkspaceRepositoryBoundary | null
): boolean {
    if (left === null || right === null) return left === right;
    return (
        sameIdentity(left, right) &&
        left.markerKind === right.markerKind &&
        left.markerRealPath === right.markerRealPath &&
        left.markerDevice === right.markerDevice &&
        left.markerInode === right.markerInode
    );
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function safeBindingError(error: unknown): CoreError {
    return error instanceof CoreError ? error : bindingError();
}

function bindingError(): CoreError {
    return workspaceReferenceError('workspace_binding_mismatch');
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
        ? (value as Record<string, unknown>)
        : undefined;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
    const actual = Object.keys(record).sort();
    const wanted = [...expected].sort();
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
