import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { WorkspaceFilesystemIdentity } from './workspace-binding.js';
import { workspaceReferenceError } from './workspace-ref.js';

const BINDING_MAX_BYTES = 16 * 1024;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_TIMEOUT_MS = 10_000;
const READ_NOFOLLOW_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
const DIRECTORY_FLAGS = constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0);

export type BindingStorage = {
    realRoot: string;
    nexusDirectory: WorkspaceFilesystemIdentity;
    bindingPath: string;
};

type IdentityResolver = (value: string) => Promise<WorkspaceFilesystemIdentity>;

export async function ensureBindingStorage(
    realRoot: string,
    resolveIdentity: IdentityResolver
): Promise<BindingStorage> {
    const ontology = await ensureDirectory(realRoot, path.join(realRoot, '.ontology'), resolveIdentity);
    const nexus = await ensureDirectory(realRoot, path.join(ontology.realRoot, 'nexus'), resolveIdentity);
    return { realRoot, nexusDirectory: nexus, bindingPath: path.join(nexus.realRoot, 'workspace-binding.json') };
}

export async function createBindingFile(storage: BindingStorage, payload: string): Promise<void> {
    const release = await acquireCreationLock(storage);
    try {
        if (await readBindingFile(storage, { allowWhileLocked: true })) return;
        await verifyStorage(storage);
        const temporary = path.join(
            storage.nexusDirectory.realRoot,
            `.workspace-binding.${process.pid}.${randomUUID()}.tmp`
        );
        if (Buffer.byteLength(payload, 'utf8') > BINDING_MAX_BYTES) throw bindingError();
        let handle: fs.FileHandle | undefined;
        try {
            handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE);
            await handle.writeFile(payload, 'utf8');
            await handle.sync();
            await handle.close();
            handle = undefined;
            await verifyStorage(storage);
            await fs.rename(temporary, storage.bindingPath);
            await fs.chmod(storage.bindingPath, FILE_MODE);
            await syncDirectory(storage.nexusDirectory.realRoot);
            await verifyStorage(storage);
        } finally {
            await handle?.close().catch(() => undefined);
            await fs.rm(temporary, { force: true }).catch(() => undefined);
        }
    } finally {
        await release();
    }
}

export async function readBindingFile(
    storage: BindingStorage,
    options: { allowWhileLocked?: boolean } = {}
): Promise<string | null> {
    await verifyStorage(storage);
    if (options.allowWhileLocked !== true && (await creationLockExists(storage))) return null;
    let lexical: Awaited<ReturnType<typeof fs.lstat>>;
    try {
        lexical = await fs.lstat(storage.bindingPath);
    } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw bindingError();
    }
    if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1) throw bindingError();
    if ((lexical.mode & 0o077) !== 0 || lexical.size <= 0 || lexical.size > BINDING_MAX_BYTES) {
        throw bindingError();
    }

    let handle: fs.FileHandle;
    try {
        handle = await fs.open(storage.bindingPath, READ_NOFOLLOW_FLAGS);
    } catch {
        throw bindingError();
    }
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size <= 0 || before.size > BINDING_MAX_BYTES) throw bindingError();
        const text = await handle.readFile('utf8');
        const after = await handle.stat();
        const finalLexical = await fs.lstat(storage.bindingPath).catch(() => {
            throw bindingError();
        });
        if (
            before.dev !== after.dev ||
            before.ino !== after.ino ||
            before.size !== after.size ||
            before.dev !== finalLexical.dev ||
            before.ino !== finalLexical.ino
        ) {
            throw bindingError();
        }
        await verifyStorage(storage);
        return text;
    } finally {
        await handle.close().catch(() => undefined);
    }
}

async function ensureDirectory(
    realRoot: string,
    directory: string,
    resolveIdentity: IdentityResolver
): Promise<WorkspaceFilesystemIdentity> {
    try {
        await fs.mkdir(directory, { mode: DIRECTORY_MODE });
    } catch (error: any) {
        if (error?.code !== 'EEXIST') throw bindingError();
    }
    const lexical = await fs.lstat(directory, { bigint: true }).catch(() => {
        throw bindingError();
    });
    if (!lexical.isDirectory() || lexical.isSymbolicLink()) throw bindingError();
    const identity = await resolveIdentity(directory);
    if (!isInsideOrEqual(realRoot, identity.realRoot)) throw bindingError();
    await fs.chmod(directory, DIRECTORY_MODE).catch(() => undefined);
    return identity;
}

async function acquireCreationLock(storage: BindingStorage): Promise<() => Promise<void>> {
    const lock = path.join(storage.nexusDirectory.realRoot, '.workspace-binding.lock');
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    while (true) {
        await verifyStorage(storage);
        try {
            await fs.mkdir(lock, { mode: DIRECTORY_MODE });
            const owned = await fs.lstat(lock, { bigint: true });
            if (!owned.isDirectory() || owned.isSymbolicLink()) throw bindingError();
            return async () => {
                const current = await fs.lstat(lock, { bigint: true }).catch(() => null);
                if (!current || current.dev !== owned.dev || current.ino !== owned.ino) throw bindingError();
                await fs.rm(lock, { recursive: true, force: false });
                await syncDirectory(storage.nexusDirectory.realRoot);
            };
        } catch (error: any) {
            if (error?.code !== 'EEXIST') throw bindingError();
            const lockStat = await fs.lstat(lock).catch(() => null);
            if (!lockStat || !lockStat.isDirectory() || lockStat.isSymbolicLink()) throw bindingError();
            if (Date.now() >= deadline) throw bindingError();
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    }
}

async function creationLockExists(storage: BindingStorage): Promise<boolean> {
    const lock = path.join(storage.nexusDirectory.realRoot, '.workspace-binding.lock');
    const stat = await fs.lstat(lock).catch((error: any) => {
        if (error?.code === 'ENOENT') return null;
        throw bindingError();
    });
    if (!stat) return false;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw bindingError();
    return true;
}

async function verifyStorage(storage: BindingStorage): Promise<void> {
    const real = await fs.realpath(storage.nexusDirectory.realRoot).catch(() => {
        throw bindingError();
    });
    const stat = await fs.stat(real, { bigint: true }).catch(() => {
        throw bindingError();
    });
    if (
        !stat.isDirectory() ||
        real !== storage.nexusDirectory.realRoot ||
        stat.dev.toString() !== storage.nexusDirectory.device ||
        stat.ino.toString() !== storage.nexusDirectory.inode ||
        !isInsideOrEqual(storage.realRoot, real)
    ) {
        throw bindingError();
    }
}

async function syncDirectory(directory: string): Promise<void> {
    let handle: fs.FileHandle;
    try {
        handle = await fs.open(directory, DIRECTORY_FLAGS);
    } catch {
        throw bindingError();
    }
    try {
        await handle.sync();
    } finally {
        await handle.close().catch(() => undefined);
    }
}

function isInsideOrEqual(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function bindingError() {
    return workspaceReferenceError('workspace_binding_mismatch');
}
