import { spawnSync } from 'node:child_process';
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { CoreError } from '../errors.js';
import { isSafeRepositoryRelativePath } from './structural-evidence-contract.js';

const MAX_GIT_OUTPUT = 512 * 1024 * 1024;

export interface GitBytesResult {
    status: number | null;
    stdout: Buffer;
    stderr: string;
}

export type RunGitBytes = (cwd: string, args: string[], input?: Buffer) => GitBytesResult;

export function structuralEvidenceGitEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_COMMON_DIR',
        'GIT_OBJECT_DIRECTORY',
        'GIT_ALTERNATE_OBJECT_DIRECTORIES',
        'GIT_NAMESPACE',
    ]) {
        delete env[key];
    }
    env.GIT_LFS_SKIP_SMUDGE = '1';
    env.GIT_OPTIONAL_LOCKS = '0';
    env.GIT_NO_REPLACE_OBJECTS = '1';
    return env;
}

export const runGitBytes: RunGitBytes = (cwd, args, input) => {
    const result = spawnSync('git', ['-C', cwd, ...args], {
        input,
        encoding: 'buffer',
        maxBuffer: MAX_GIT_OUTPUT,
        timeout: 60_000,
        env: structuralEvidenceGitEnvironment(),
    });
    return {
        status: result.status,
        stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
        stderr: `${Buffer.isBuffer(result.stderr) ? result.stderr.toString('utf8') : ''}${result.error?.message ?? ''}`,
    };
};

interface TreeEntry {
    mode: string;
    type: string;
    objectId: string;
    relativePath: string;
}

function gitBytesOutput(result: GitBytesResult, operation: string): Buffer {
    if (result.status === 0) return result.stdout;
    throw new CoreError('Internal', `${operation} failed`, {
        status: result.status,
        stderr: result.stderr.trim().slice(0, 2000),
    });
}

function decodeUtf8(bytes: Buffer, label: string): string {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new CoreError('Internal', `${label} is not valid UTF-8`);
    }
}

function parseTreeEntries(buffer: Buffer): TreeEntry[] {
    const entries: TreeEntry[] = [];
    let offset = 0;
    while (offset < buffer.length) {
        const end = buffer.indexOf(0, offset);
        if (end < 0) throw new CoreError('Internal', 'git tree output was not NUL terminated');
        const record = buffer.subarray(offset, end);
        const tab = record.indexOf(0x09);
        if (tab < 0) throw new CoreError('Internal', 'git tree output was malformed');
        const header = record.subarray(0, tab).toString('ascii');
        const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40,64})$/.exec(header);
        if (!match) throw new CoreError('Internal', 'git tree entry header was malformed');
        const relativePath = decodeUtf8(record.subarray(tab + 1), 'git tree path');
        if (!isSafeRepositoryRelativePath(relativePath)) {
            throw new CoreError('Internal', 'git tree contains an unsafe repository path');
        }
        entries.push({ mode: match[1], type: match[2], objectId: match[3], relativePath });
        offset = end + 1;
    }
    return entries;
}

function parseBatchBlobs(buffer: Buffer, entries: TreeEntry[]): Map<number, Buffer> {
    const blobs = new Map<number, Buffer>();
    let offset = 0;
    for (let index = 0; index < entries.length; index++) {
        const lineEnd = buffer.indexOf(0x0a, offset);
        if (lineEnd < 0) throw new CoreError('Internal', 'git cat-file batch header was truncated');
        const header = buffer.subarray(offset, lineEnd).toString('ascii');
        const match = /^([a-f0-9]{40,64}) blob (\d+)$/.exec(header);
        const expected = entries[index];
        if (!match || match[1] !== expected.objectId) {
            throw new CoreError('Internal', 'git cat-file batch object mismatch');
        }
        const size = Number(match[2]);
        if (!Number.isSafeInteger(size) || size < 0 || size > MAX_GIT_OUTPUT) {
            throw new CoreError('Internal', 'git blob size was invalid or exceeded the capture bound');
        }
        const start = lineEnd + 1;
        const end = start + size;
        if (end >= buffer.length || buffer[end] !== 0x0a) {
            throw new CoreError('Internal', 'git cat-file batch blob was truncated');
        }
        blobs.set(index, buffer.subarray(start, end));
        offset = end + 1;
    }
    if (offset !== buffer.length)
        throw new CoreError('Internal', 'git cat-file batch returned unexpected trailing data');
    return blobs;
}

/** Materialize exact committed blob bytes without checkout, archive, smudge, ident, or EOL conversion. */
export async function materializeRawCommit(
    sourceRoot: string,
    commit: string,
    temporaryRoot: string,
    directoryName: string,
    runBytes: RunGitBytes
): Promise<string> {
    const captureRoot = path.join(temporaryRoot, directoryName);
    await mkdir(captureRoot, { recursive: false, mode: 0o700 });
    const treeBuffer = gitBytesOutput(
        runBytes(sourceRoot, ['ls-tree', '-rz', '--full-tree', commit]),
        'git raw tree inventory'
    );
    const entries = parseTreeEntries(treeBuffer);
    const blobEntries = entries.filter((entry) => entry.type === 'blob');
    const batchInput = Buffer.from(`${blobEntries.map((entry) => entry.objectId).join('\n')}\n`, 'ascii');
    const blobBuffer = blobEntries.length
        ? gitBytesOutput(runBytes(sourceRoot, ['cat-file', '--batch'], batchInput), 'git raw blob read')
        : Buffer.alloc(0);
    const blobs = parseBatchBlobs(blobBuffer, blobEntries);

    for (let index = 0; index < blobEntries.length; index++) {
        const entry = blobEntries[index];
        const bytes = blobs.get(index);
        if (!bytes) throw new CoreError('Internal', 'git raw blob was not materialized');
        const destination = path.join(captureRoot, ...entry.relativePath.split('/'));
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        if (entry.mode === '120000') {
            if (bytes.includes(0)) throw new CoreError('Internal', 'git symlink target contains NUL');
            await symlink(bytes, destination);
            continue;
        }
        if (entry.mode !== '100644' && entry.mode !== '100755') {
            throw new CoreError('Internal', 'git blob has an unsupported file mode');
        }
        await writeFile(destination, bytes, { mode: entry.mode === '100755' ? 0o755 : 0o644 });
        await chmod(destination, entry.mode === '100755' ? 0o755 : 0o644);
    }

    for (const entry of entries.filter((candidate) => candidate.type === 'commit')) {
        if (entry.mode !== '160000') throw new CoreError('Internal', 'git commit entry has an unsupported mode');
        await mkdir(path.join(captureRoot, ...entry.relativePath.split('/')), { recursive: true, mode: 0o700 });
    }
    return captureRoot;
}
