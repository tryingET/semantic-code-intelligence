import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as os from 'node:os';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { isOutsideWorkspaceRelative } from './workspace-path.js';

export type CheckCommandReceipt = {
    command: string;
    ok: boolean;
    elapsedMs: number;
    exitCode: number | null;
    timedOut: boolean;
};

export type CheckRunResult = {
    ok: boolean;
    output: string;
    elapsedMs: number;
    commands: CheckCommandReceipt[];
};

type Snapshot = {
    id: string;
    createdAt: number;
    diffs: string[];
    baseFingerprint?: string;
    workspaceRoot?: string;
    touchedFiles?: Set<string>;
    lastApply?: {
        ok: boolean;
        elapsedMs: number;
        outputTail: string;
        args: { check: boolean; reverse: boolean };
        at: number;
    };
    applyCreatedDirs?: string[];
    applyPreExistingDirs?: string[];
};

const RESERVED_PATCH_ROOT_NAMES = new Set([
    '.materialized',
    'metadata.json',
    'overlay.diff',
    'squashed-overlay.diff',
    'progress.log',
]);
const RESERVED_PATCH_ROOT_PREFIXES = ['.git', '.ontology'];
const DEFAULT_SNAPSHOT_DIFF_MAX_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_RESOURCE_MAX_BYTES = 256 * 1024;

function truncateUtf8WithMarker(text: string, maxBytes: number): string {
    if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
    const marker = `\n[truncated at ${maxBytes} bytes]\n`;
    const markerBytes = Buffer.byteLength(marker, 'utf8');
    const limit = Math.max(0, maxBytes - markerBytes);
    let bytes = 0;
    const out: string[] = [];
    for (const char of text) {
        const charBytes = Buffer.byteLength(char, 'utf8');
        if (bytes + charBytes > limit) break;
        out.push(char);
        bytes += charBytes;
    }
    return out.join('') + marker;
}

export class OverlayStore {
    private snapshots = new Map<string, Snapshot>();
    private materializeLocks = new Map<string, Promise<void>>();
    private wantProgress(): boolean {
        const env = process.env;
        return env.DOGFOOD_PROGRESS === '1' || env.PROGRESS_LOGS === '1';
    }

    private maxSnapshotDiffBytes(): number {
        const parsed = Number(process.env.SCI_SNAPSHOT_MAX_DIFF_BYTES || DEFAULT_SNAPSHOT_DIFF_MAX_BYTES);
        if (!Number.isFinite(parsed)) return DEFAULT_SNAPSHOT_DIFF_MAX_BYTES;
        return Math.max(1024, Math.min(16 * 1024 * 1024, Math.floor(parsed)));
    }

    private resourceMaxBytes(value: unknown): number {
        const parsed = Number(value ?? SNAPSHOT_RESOURCE_MAX_BYTES);
        return Number.isFinite(parsed)
            ? Math.max(1, Math.min(SNAPSHOT_RESOURCE_MAX_BYTES, Math.floor(parsed)))
            : SNAPSHOT_RESOURCE_MAX_BYTES;
    }

    private assertSafeSnapshotStoragePath(base: string, target: string, label: string): void {
        if (!fs.existsSync(target)) return;
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink()) {
            throw new Error(`${label} must not be a symlink`);
        }
        if (!stat.isDirectory()) {
            throw new Error(`${label} must be a directory`);
        }
        const realBase = fs.realpathSync(base);
        const realTarget = fs.realpathSync(target);
        const relative = path.relative(realBase, realTarget);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error(`${label} must stay within the workspace`);
        }
    }

    private assertSafeSnapshotStorageRoot(workspaceRoot?: string): string {
        const base = this.resolveWorkspaceBase(workspaceRoot);
        const ontologyDir = path.join(base, '.ontology');
        const snapshotsDir = path.join(ontologyDir, 'snapshots');
        this.assertSafeSnapshotStoragePath(base, ontologyDir, '.ontology');
        this.assertSafeSnapshotStoragePath(base, snapshotsDir, '.ontology/snapshots');
        return snapshotsDir;
    }

    private async logProgress(id: string, msg: string): Promise<void> {
        if (!this.wantProgress()) return;
        try {
            this.assertValidId(id);
            const snap = this.snapshots.get(id);
            const dir = this.snapshotDir(id, snap?.workspaceRoot);
            await fsp.mkdir(dir, { recursive: true }).catch(() => {});
            const line = `[${new Date().toISOString()}] ${msg}\n`;
            const progressPath = path.join(dir, 'progress.log');
            const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
            const handle = await fsp.open(
                progressPath,
                fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | noFollow,
                0o600
            );
            try {
                await handle.writeFile(line, 'utf8');
            } finally {
                await handle.close().catch(() => undefined);
            }
        } catch {
            // ignore progress errors
        }
    }

    private snapshotsRoot(workspaceRoot?: string): string {
        return this.assertSafeSnapshotStorageRoot(workspaceRoot);
    }

    private snapshotDir(id: string, workspaceRoot?: string): string {
        this.assertValidId(id);
        return path.join(this.snapshotsRoot(workspaceRoot), id);
    }

    private assertSafeSnapshotDirectory(
        id: string,
        workspaceRoot?: string,
        opts: { mustExist?: boolean } = {}
    ): string {
        this.assertValidId(id);
        const root = this.snapshotsRoot(workspaceRoot);
        const dir = path.join(root, id);
        if (!fs.existsSync(dir)) {
            if (opts.mustExist) throw new Error('Unknown snapshot id');
            return dir;
        }
        const stat = fs.lstatSync(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            throw new Error('snapshot directory must be a non-symlink directory');
        }
        const realRoot = fs.realpathSync(root);
        const realDir = fs.realpathSync(dir);
        const relative = path.relative(realRoot, realDir);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('snapshot directory must stay within the snapshots root');
        }
        return dir;
    }

    private metadataPath(id: string, workspaceRoot?: string, opts: { mustExist?: boolean } = {}): string {
        return path.join(this.assertSafeSnapshotDirectory(id, workspaceRoot, opts), 'metadata.json');
    }

    private assertSnapshotDirectoryIdentity(
        id: string,
        workspaceRoot: string | undefined,
        expectedRealDir: string
    ): void {
        const actualRealDir = fs.realpathSync(this.assertSafeSnapshotDirectory(id, workspaceRoot, { mustExist: true }));
        if (actualRealDir !== expectedRealDir) {
            throw new Error('snapshot directory changed during metadata operation');
        }
    }

    private readSnapshotMetadataSync(id: string, workspaceRoot?: string): string {
        const dir = this.assertSafeSnapshotDirectory(id, workspaceRoot, { mustExist: true });
        const expectedRealDir = fs.realpathSync(dir);
        const metadata = path.join(dir, 'metadata.json');
        const stat = fs.lstatSync(metadata);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('snapshot metadata must be a non-symlink file');
        this.assertSnapshotDirectoryIdentity(id, workspaceRoot, expectedRealDir);
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
        const fd = fs.openSync(metadata, fs.constants.O_RDONLY | noFollow);
        try {
            this.assertSnapshotDirectoryIdentity(id, workspaceRoot, expectedRealDir);
            return fs.readFileSync(fd, 'utf8');
        } finally {
            fs.closeSync(fd);
        }
    }

    private writeSnapshotMetadataSync(snap: Snapshot): void {
        const dir = this.assertSafeSnapshotDirectory(snap.id, snap.workspaceRoot);
        fs.mkdirSync(dir, { recursive: true });
        const safeDir = this.assertSafeSnapshotDirectory(snap.id, snap.workspaceRoot, { mustExist: true });
        const expectedRealDir = fs.realpathSync(safeDir);
        const tmp = path.join(
            safeDir,
            `.metadata.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
        );
        const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
        let fd: number | null = null;
        try {
            this.assertSnapshotDirectoryIdentity(snap.id, snap.workspaceRoot, expectedRealDir);
            fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow, 0o600);
            fs.writeFileSync(fd, JSON.stringify(this.serializeSnapshot(snap), null, 2), 'utf8');
            fs.closeSync(fd);
            fd = null;
            this.assertSnapshotDirectoryIdentity(snap.id, snap.workspaceRoot, expectedRealDir);
            fs.renameSync(tmp, path.join(safeDir, 'metadata.json'));
            this.assertSnapshotDirectoryIdentity(snap.id, snap.workspaceRoot, expectedRealDir);
        } finally {
            if (fd !== null) fs.closeSync(fd);
            try {
                fs.rmSync(tmp, { force: true });
            } catch {}
        }
    }

    private snapshotDiffFingerprint(snap: Snapshot | null | undefined): string {
        const diffs = Array.isArray(snap?.diffs) ? snap.diffs : [];
        const hash = createHash('sha256');
        for (const diff of diffs) {
            hash.update(String(Buffer.byteLength(diff, 'utf8')));
            hash.update('\0');
            hash.update(diff);
            hash.update('\0');
        }
        return `${diffs.length}:${hash.digest('hex')}`;
    }

    private readMaterializedFingerprint(markerPath: string): string | null {
        let fd: number | null = null;
        try {
            const stat = fs.lstatSync(markerPath);
            if (!stat.isFile() || stat.isSymbolicLink()) return null;
            const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
            fd = fs.openSync(markerPath, fs.constants.O_RDONLY | noFollow);
            const raw = fs.readFileSync(fd, 'utf8');
            const parsed = JSON.parse(raw);
            return typeof parsed?.diffFingerprint === 'string' ? parsed.diffFingerprint : null;
        } catch {
            return null;
        } finally {
            if (fd !== null) fs.closeSync(fd);
        }
    }

    private async writeMaterializedMarker(markerPath: string, snap: Snapshot | null | undefined): Promise<void> {
        const payload = {
            schema: 'semantic-code-intelligence.snapshot_materialized.v1',
            materializedAt: new Date().toISOString(),
            diffFingerprint: this.snapshotDiffFingerprint(snap),
            diffCount: Array.isArray(snap?.diffs) ? snap.diffs.length : 0,
        };
        await fsp.writeFile(markerPath, JSON.stringify(payload, null, 2), 'utf8');
    }

    private stripUnifiedHeaderMetadata(rawPath: string): string {
        const raw = String(rawPath || '').trim();
        const tab = raw.indexOf('\t');
        if (tab >= 0) return raw.slice(0, tab).trim();
        const timestamp = /^(.*?)\s+\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s+[+-]\d{4}|Z)?$/.exec(raw);
        return timestamp?.[1]?.trim() || raw;
    }

    private rejectUnsafePatchFileModes(diff: string): string | null {
        for (const line of diff.split(/\r?\n/)) {
            if (/^(?:new file mode|old mode|new mode|deleted file mode)\s+120000\b/.test(line)) {
                return 'invalid_patch: symlink file modes are not allowed in snapshot patches';
            }
        }
        return null;
    }

    private normalizePatchRelativePath(rawPath: string, inputLabel = 'patch path'): string | null {
        const raw = this.stripUnifiedHeaderMetadata(rawPath);
        if (!raw || raw === '/dev/null') return null;
        if (raw.includes('\0')) throw new Error(`${inputLabel} must not contain NUL bytes`);
        if (raw.includes('\\')) throw new Error(`${inputLabel} must use POSIX-style relative paths`);
        if (path.posix.isAbsolute(raw)) throw new Error(`${inputLabel} must stay within the workspace`);
        const normalized = path.posix.normalize(raw);
        if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
            throw new Error(`${inputLabel} must stay within the workspace`);
        }
        const firstSegment = normalized.split('/')[0];
        if (RESERVED_PATCH_ROOT_PREFIXES.includes(firstSegment)) {
            throw new Error(`${inputLabel} targets reserved workspace control path: ${firstSegment}`);
        }
        if (!normalized.includes('/') && RESERVED_PATCH_ROOT_NAMES.has(normalized)) {
            throw new Error(`${inputLabel} targets reserved snapshot artifact name: ${normalized}`);
        }
        return normalized;
    }

    private normalizeUnifiedHeaderPathForGitApply(rawPath: string, prefix: 'a' | 'b'): string {
        const raw = String(rawPath || '').trim();
        if (!raw || raw === '/dev/null') return raw;
        const stripped = this.stripUnifiedHeaderMetadata(rawPath);
        if (!stripped || stripped === '/dev/null') return raw;
        if (path.posix.isAbsolute(stripped)) return raw;
        const hasMetadata = stripped !== raw;
        const suffix = hasMetadata ? raw.slice(stripped.length) : /\s/.test(stripped) ? '\t' : '';
        if (stripped.startsWith('a/') || stripped.startsWith('b/')) return `${stripped}${suffix}`;
        return `${prefix}/${stripped}${suffix}`;
    }

    private normalizeUnifiedDiffForGitApply(diff: string): string {
        const lines = diff.split(/\r?\n/);
        const out: string[] = [];
        let insideHunk = false;
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            const startsTraditionalHeaderPair =
                /^---\s+(.+)$/.test(line) &&
                /^\+\+\+\s+(.+)$/.test(lines[i + 1] || '') &&
                /^@@\s/.test(lines[i + 2] || '');
            if (insideHunk && startsTraditionalHeaderPair) insideHunk = false;
            if (!insideHunk) {
                const oldHeader = line.match(/^---\s+(.+)$/);
                const newHeader = line.match(/^\+\+\+\s+(.+)$/);
                if (oldHeader) line = `--- ${this.normalizeUnifiedHeaderPathForGitApply(oldHeader[1], 'a')}`;
                else if (newHeader) line = `+++ ${this.normalizeUnifiedHeaderPathForGitApply(newHeader[1], 'b')}`;
            }
            out.push(line);
            if (/^@@\s/.test(line)) insideHunk = true;
            if (!line.startsWith('diff --git ')) continue;

            let hasMode = false;
            let hasNewFileNull = false;
            let hasDeletedFileNull = false;
            for (let j = i + 1; j < lines.length && !lines[j].startsWith('diff --git '); j++) {
                const blockLine = lines[j];
                if (/^(new|deleted) file mode\s+\d+/.test(blockLine)) hasMode = true;
                if (blockLine === '--- /dev/null') hasNewFileNull = true;
                if (blockLine === '+++ /dev/null') hasDeletedFileNull = true;
                if (blockLine.startsWith('@@ ')) break;
            }
            if (!hasMode && hasNewFileNull) out.push('new file mode 100644');
            if (!hasMode && hasDeletedFileNull) out.push('deleted file mode 100644');
        }
        return out.join('\n');
    }

    private containedPath(
        root: string,
        relPath: string,
        inputLabel = 'path'
    ): { absolutePath: string; relativePath: string } {
        const relativePath = this.normalizePatchRelativePath(relPath, inputLabel);
        if (!relativePath) throw new Error(`${inputLabel} must name a file inside the workspace`);
        const absoluteRoot = path.resolve(root);
        const absolutePath = path.resolve(absoluteRoot, relativePath);
        const relativeToRoot = path.relative(absoluteRoot, absolutePath);
        if (isOutsideWorkspaceRelative(relativeToRoot)) {
            throw new Error(`${inputLabel} must stay within the workspace`);
        }
        return { absolutePath, relativePath: relativeToRoot.split(path.sep).join('/') };
    }

    private shellQuote(value: string): string {
        return `'${String(value).replace(/'/g, `'"'"'`)}'`;
    }

    private spawnChecked(command: string, errorLabel: string, cwd?: string): void {
        const result = spawnSync('bash', ['-lc', command], { stdio: 'pipe', cwd });
        if (result.status !== 0) {
            const output = `${String(result.stdout || '')}${String(result.stderr || '')}`.slice(-1000);
            throw new Error(`${errorLabel}: ${output || `exit ${result.status}`}`);
        }
    }

    private spawnCheckedArgs(command: string, args: string[], errorLabel: string, cwd?: string): void {
        const result = spawnSync(command, args, { stdio: 'pipe', cwd });
        if (result.status !== 0) {
            const output = `${String(result.stdout || '')}${String(result.stderr || '')}`.slice(-1000);
            throw new Error(`${errorLabel}: ${output || `exit ${result.status}`}`);
        }
    }

    private async withMaterializeLock<T>(
        snapshotId: string,
        workspaceRoot: string | undefined,
        action: () => Promise<T>
    ): Promise<T> {
        const previous = this.materializeLocks.get(snapshotId) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const chained = previous.catch(() => undefined).then(() => current);
        this.materializeLocks.set(snapshotId, chained);
        await previous.catch(() => undefined);
        let fileLockRelease: (() => Promise<void>) | null = null;
        try {
            fileLockRelease = await this.acquireMaterializeFileLock(snapshotId, workspaceRoot);
            return await action();
        } finally {
            await fileLockRelease?.().catch(() => undefined);
            release();
            if (this.materializeLocks.get(snapshotId) === chained) this.materializeLocks.delete(snapshotId);
        }
    }

    private async acquireMaterializeFileLock(snapshotId: string, workspaceRoot?: string): Promise<() => Promise<void>> {
        const root = this.snapshotsRoot(workspaceRoot);
        const lockDir = path.join(root, `${snapshotId}.lock`);
        const deadline = Date.now() + 30_000;
        while (true) {
            try {
                this.assertSafeSnapshotStorageRoot(workspaceRoot);
                await fsp.mkdir(lockDir, { recursive: false });
                this.assertSafeSnapshotStorageRoot(workspaceRoot);
                await fsp.writeFile(
                    path.join(lockDir, 'owner.json'),
                    JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
                    'utf8'
                );
                return async () => {
                    await fsp.rm(lockDir, { recursive: true, force: true });
                };
            } catch (error: any) {
                if (error?.code !== 'EEXIST') throw error;
                try {
                    const stat = await fsp.stat(lockDir);
                    if (Date.now() - stat.mtimeMs > 5 * 60_000) await fsp.rm(lockDir, { recursive: true, force: true });
                } catch {}
                if (Date.now() > deadline) throw new Error('Timed out waiting for snapshot materialization lock');
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
    }

    private workspaceBaseFingerprint(workspaceRoot?: string): string {
        const root = this.resolveWorkspaceBase(workspaceRoot);
        const hash = createHash('sha256');
        hash.update(`root:${root}\0`);
        const addGit = (args: string[], label: string): string => {
            const result = spawnSync('git', args, { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
            hash.update(label);
            hash.update('\0');
            hash.update(
                result.status === 0
                    ? result.stdout
                    : Buffer.from(`git-failed:${result.status}:${String(result.stderr || '')}`)
            );
            hash.update('\0');
            return result.status === 0 ? result.stdout.toString('utf8') : '';
        };
        const snapshotArtifactPathspec = ':(exclude).ontology/snapshots';
        addGit(['rev-parse', 'HEAD'], 'head');
        addGit(
            ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.', snapshotArtifactPathspec],
            'status'
        );
        addGit(['diff', '--binary', '--', '.', snapshotArtifactPathspec], 'diff');
        addGit(['diff', '--cached', '--binary', '--', '.', snapshotArtifactPathspec], 'cached-diff');
        const untracked = addGit(
            ['ls-files', '--others', '--exclude-standard', '-z', '--', '.', snapshotArtifactPathspec],
            'untracked-list'
        )
            .split('\0')
            .filter(Boolean);
        hash.update(`untracked-count:${untracked.length}\0`);
        for (let i = 0; i < untracked.length; i++) {
            const rel = untracked[i];
            try {
                const { absolutePath, relativePath } = this.containedPath(root, rel, 'untracked file path');
                const stat = fs.lstatSync(absolutePath);
                if (stat.isSymbolicLink()) {
                    hash.update(`untracked-symlink:${relativePath}:${fs.readlinkSync(absolutePath)}\0`);
                    continue;
                }
                if (!stat.isFile()) continue;
                hash.update(`untracked:${relativePath}:${stat.size}:${stat.mtimeMs}:`);
                if (i < 1000 && stat.size <= 1024 * 1024) hash.update(fs.readFileSync(absolutePath));
                hash.update('\0');
            } catch {}
        }
        return hash.digest('hex');
    }

    private serializeSnapshot(snap: Snapshot): Record<string, unknown> {
        return {
            id: snap.id,
            createdAt: snap.createdAt,
            diffs: snap.diffs,
            baseFingerprint: snap.baseFingerprint || null,
            workspaceRoot: snap.workspaceRoot || null,
            touchedFiles: snap.touchedFiles ? Array.from(snap.touchedFiles) : [],
            lastApply: snap.lastApply || null,
            applyCreatedDirs: snap.applyCreatedDirs || [],
            applyPreExistingDirs: snap.applyPreExistingDirs || [],
        };
    }

    private hydrateSnapshot(raw: any, fallbackWorkspaceRoot?: string): Snapshot | null {
        const id = String(raw?.id || '').trim();
        if (!this.isValidSnapshotId(id)) return null;
        const createdAt = Number(raw?.createdAt || Date.now());
        const diffs = Array.isArray(raw?.diffs) ? raw.diffs.filter((d: any) => typeof d === 'string') : [];
        const touched = Array.isArray(raw?.touchedFiles)
            ? raw.touchedFiles.filter((f: any) => typeof f === 'string')
            : [];
        const baseFingerprint = typeof raw?.baseFingerprint === 'string' ? raw.baseFingerprint : undefined;
        const workspaceRoot =
            typeof raw?.workspaceRoot === 'string' && raw.workspaceRoot
                ? path.resolve(raw.workspaceRoot)
                : fallbackWorkspaceRoot
                  ? this.resolveWorkspaceBase(fallbackWorkspaceRoot)
                  : undefined;
        const snap: Snapshot = { id, createdAt, diffs, baseFingerprint, workspaceRoot };
        if (touched.length) snap.touchedFiles = new Set(touched);
        if (raw?.lastApply && typeof raw.lastApply === 'object') snap.lastApply = raw.lastApply;
        if (Array.isArray(raw?.applyCreatedDirs))
            snap.applyCreatedDirs = raw.applyCreatedDirs.filter((dir: any) => typeof dir === 'string');
        if (Array.isArray(raw?.applyPreExistingDirs))
            snap.applyPreExistingDirs = raw.applyPreExistingDirs.filter((dir: any) => typeof dir === 'string');
        return snap;
    }

    private persistSnapshotSync(snap: Snapshot): void {
        try {
            this.writeSnapshotMetadataSync(snap);
        } catch (error) {
            throw new Error(`Failed to persist snapshot metadata: ${errorMessage(error)}`);
        }
    }

    private recordLastApply(
        snapshotId: string,
        receipt: {
            ok: boolean;
            elapsedMs: number;
            outputTail: string;
            args: { check: boolean; reverse: boolean };
            at: number;
        }
    ): { ok: boolean; message?: string } {
        try {
            const snap = this.ensureSnapshot(snapshotId);
            const previousLastApply = snap.lastApply;
            snap.lastApply = receipt;
            try {
                this.persistSnapshotSync(snap);
            } catch (error) {
                snap.lastApply = previousLastApply;
                return { ok: false, message: `Failed to persist snapshot apply receipt: ${errorMessage(error)}` };
            }
            return { ok: true };
        } catch (error) {
            return { ok: false, message: `Failed to record snapshot apply receipt: ${errorMessage(error)}` };
        }
    }

    private loadSnapshotFromDisk(id: string, workspaceRoot?: string): Snapshot | null {
        try {
            this.assertValidId(id);
            const raw = JSON.parse(this.readSnapshotMetadataSync(id, workspaceRoot));
            const snap = this.hydrateSnapshot(raw, workspaceRoot);
            if (!snap) return null;
            this.snapshots.set(snap.id, snap);
            return snap;
        } catch {
            return null;
        }
    }

    private loadAllSnapshotsFromDisk(workspaceRoot?: string): void {
        try {
            const root = this.snapshotsRoot(workspaceRoot);
            if (!fs.existsSync(root)) return;
            for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
                if (!ent.isDirectory() || !this.isValidSnapshotId(ent.name) || this.snapshots.has(ent.name)) continue;
                this.loadSnapshotFromDisk(ent.name, workspaceRoot);
            }
        } catch {}
    }

    private isValidSnapshotId(id: string): boolean {
        return (
            typeof id === 'string' &&
            /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(id.trim())
        );
    }

    private assertValidId(id: string): void {
        if (!id || !this.isValidSnapshotId(id)) {
            throw new Error('Invalid snapshot id');
        }
    }

    private isReusableBaseSnapshot(snap: Snapshot | null | undefined, baseFingerprint: string): snap is Snapshot {
        if (!snap || snap.baseFingerprint !== baseFingerprint) return false;
        // PreferExisting is a convenience for reusing an unchanged workspace-base snapshot.
        // Once diffs are staged, the snapshot represents preview state and must not be
        // returned as a fresh base for later navigation/read workflows.
        return !Array.isArray(snap.diffs) || snap.diffs.length === 0;
    }

    createSnapshot(preferExisting = true, opts: { workspaceRoot?: string } = {}): Snapshot {
        const workspaceRoot = opts.workspaceRoot ? this.resolveWorkspaceBase(opts.workspaceRoot) : undefined;
        const baseFingerprint = this.workspaceBaseFingerprint(workspaceRoot);
        // Optionally reuse the most recent clean snapshot only when it still matches the current workspace base.
        if (preferExisting) {
            this.loadAllSnapshotsFromDisk(workspaceRoot);
            const reusable = Array.from(this.snapshots.values())
                .filter(
                    (candidate) =>
                        candidate.workspaceRoot === workspaceRoot &&
                        this.isReusableBaseSnapshot(candidate, baseFingerprint)
                )
                .sort((a, b) => b.createdAt - a.createdAt)[0];
            if (reusable) return reusable;
        }
        const id = randomUUID();
        const snap: Snapshot = { id, createdAt: Date.now(), diffs: [], baseFingerprint, workspaceRoot };
        this.snapshots.set(id, snap);
        try {
            this.persistSnapshotSync(snap);
        } catch (error) {
            this.snapshots.delete(id);
            throw error;
        }
        return snap;
    }

    ensureSnapshot(id?: string, opts: { workspaceRoot?: string } = {}): Snapshot {
        if (id === undefined) {
            return this.createSnapshot(true, { workspaceRoot: opts.workspaceRoot });
        }
        const trimmed = String(id).trim();
        this.assertValidId(trimmed);
        const workspaceRoot = opts.workspaceRoot ? this.resolveWorkspaceBase(opts.workspaceRoot) : undefined;
        const inMemory = this.snapshots.get(trimmed);
        if (inMemory && workspaceRoot && this.resolveWorkspaceBase(inMemory.workspaceRoot) !== workspaceRoot) {
            throw new Error('Unknown snapshot id');
        }
        const found = inMemory || this.loadSnapshotFromDisk(trimmed, workspaceRoot);
        if (!found || (workspaceRoot && this.resolveWorkspaceBase(found.workspaceRoot) !== workspaceRoot)) {
            throw new Error('Unknown snapshot id');
        }
        return found;
    }

    list(opts: { workspaceRoot?: string } = {}): Snapshot[] {
        const workspaceRoot = opts.workspaceRoot ? this.resolveWorkspaceBase(opts.workspaceRoot) : undefined;
        this.loadAllSnapshotsFromDisk(workspaceRoot);
        return Array.from(this.snapshots.values())
            .filter((snap) => !workspaceRoot || this.resolveWorkspaceBase(snap.workspaceRoot) === workspaceRoot)
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    getSnapshotDirectory(snapshotId: string, opts: { workspaceRoot?: string } = {}): string {
        const snap = this.ensureSnapshot(snapshotId, opts);
        return this.snapshotDir(snapshotId, snap.workspaceRoot);
    }

    getExistingMaterializedDiffPath(snapshotId: string, opts: { workspaceRoot?: string } = {}): string | null {
        const snap = this.ensureSnapshot(snapshotId, opts);
        const dir = this.snapshotDir(snapshotId, snap.workspaceRoot);
        const markerPath = path.join(dir, '.materialized');
        const diffPath = path.join(dir, 'overlay.diff');
        if (!fs.existsSync(markerPath) || !fs.existsSync(diffPath)) return null;
        if (this.readMaterializedFingerprint(markerPath) !== this.snapshotDiffFingerprint(snap)) return null;
        const markerStat = fs.lstatSync(markerPath);
        const diffStat = fs.lstatSync(diffPath);
        if (!markerStat.isFile() || !diffStat.isFile() || markerStat.isSymbolicLink() || diffStat.isSymbolicLink())
            return null;
        return diffPath;
    }

    getOverlayDiffText(snapshotId: string, opts: { workspaceRoot?: string; maxBytes?: number } = {}): string | null {
        const snap = this.ensureSnapshot(snapshotId, opts);
        if (!snap.diffs.length) return null;
        return truncateUtf8WithMarker(snap.diffs.join('\n'), this.resourceMaxBytes(opts.maxBytes));
    }

    private isSafeMaterializedSnapshotDir(dir: string, snap: Snapshot): boolean {
        try {
            const dirStat = fs.lstatSync(dir);
            if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return false;
            const markerPath = path.join(dir, '.materialized');
            const markerStat = fs.lstatSync(markerPath);
            if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;
            const overlayPath = path.join(dir, 'overlay.diff');
            if (snap.diffs.length > 0) {
                const overlayStat = fs.lstatSync(overlayPath);
                if (!overlayStat.isFile() || overlayStat.isSymbolicLink()) return false;
            } else if (fs.existsSync(overlayPath)) {
                const overlayStat = fs.lstatSync(overlayPath);
                if (!overlayStat.isFile() || overlayStat.isSymbolicLink()) return false;
            }
            const progressPath = path.join(dir, 'progress.log');
            if (fs.existsSync(progressPath)) {
                const progressStat = fs.lstatSync(progressPath);
                if (!progressStat.isFile() || progressStat.isSymbolicLink()) return false;
            }
            return true;
        } catch {
            return false;
        }
    }

    /** Clear all in-memory snapshots. Useful for test isolation. */
    clearAll(): void {
        this.snapshots.clear();
    }

    private async cleanupTransientSnapshotWorkspaces(
        snapsRoot: string,
        now: number,
        maxAgeMs: number,
        suffixes = new Set(['check', 'tmp', 'old'])
    ): Promise<void> {
        let entries: fs.Dirent[] = [];
        try {
            entries = await fsp.readdir(snapsRoot, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (!ent.isDirectory() || !ent.name.startsWith('.')) continue;
            const match = ent.name.match(/^\.([0-9a-fA-F-]{8,})(?:\.[^.]+)*\.(check|tmp|old)$/);
            if (!match) continue;
            const [, snapshotId, suffix] = match;
            if (!this.isValidSnapshotId(snapshotId) || !suffixes.has(suffix)) continue;
            const transientDir = path.join(snapsRoot, ent.name);
            try {
                const stat = await fsp.stat(transientDir);
                if (now - stat.mtimeMs > maxAgeMs) {
                    await fsp.rm(transientDir, { recursive: true, force: true });
                }
            } catch {}
        }
    }

    private async cleanupTransientCheckWorkspaces(snapsRoot: string, now: number, maxAgeMs: number): Promise<void> {
        await this.cleanupTransientSnapshotWorkspaces(snapsRoot, now, maxAgeMs, new Set(['check']));
    }

    private async cleanupMaterializeLockWorkspaces(snapsRoot: string, now: number, maxAgeMs: number): Promise<void> {
        let entries: fs.Dirent[] = [];
        try {
            entries = await fsp.readdir(snapsRoot, { withFileTypes: true });
        } catch {
            return;
        }
        for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const match = ent.name.match(/^([0-9a-fA-F-]{8,})\.lock$/);
            if (!match || !this.isValidSnapshotId(match[1])) continue;
            const lockDir = path.join(snapsRoot, ent.name);
            try {
                const stat = await fsp.stat(lockDir);
                if (now - stat.mtimeMs > maxAgeMs) {
                    await fsp.rm(lockDir, { recursive: true, force: true });
                }
            } catch {}
        }
    }

    async cleanup(
        maxKeep = 10,
        maxAgeMs = 3 * 24 * 60 * 60 * 1000,
        opts: { workspaceRoot?: string } = {}
    ): Promise<void> {
        const workspaceRoot = opts.workspaceRoot ? this.resolveWorkspaceBase(opts.workspaceRoot) : undefined;
        const snaps = this.list({ workspaceRoot });
        const now = Date.now();
        const toDelete: Snapshot[] = [];
        // Age-based
        for (const s of snaps) {
            if (now - s.createdAt > maxAgeMs) toDelete.push(s);
        }
        // Count-based
        if (snaps.length - toDelete.length > maxKeep) {
            const excess = snaps.slice(maxKeep);
            for (const s of excess) if (!toDelete.includes(s)) toDelete.push(s);
        }
        const cleanupRoots = new Set<string>();
        for (const s of toDelete) {
            this.snapshots.delete(s.id);
            const snapsRoot = this.snapshotsRoot(s.workspaceRoot);
            cleanupRoots.add(snapsRoot);
            try {
                await fsp.rm(path.join(snapsRoot, s.id), { recursive: true, force: true });
            } catch {}
        }
        cleanupRoots.add(this.snapshotsRoot(workspaceRoot));
        for (const snapsRoot of cleanupRoots) {
            await this.cleanupTransientSnapshotWorkspaces(snapsRoot, now, maxAgeMs);
            await this.cleanupMaterializeLockWorkspaces(snapsRoot, now, maxAgeMs);
        }
    }

    private parseTouchedFilesFromPatch(diff: string): string[] {
        const files = new Set<string>();
        let currentGitPaths: { oldPath: string | null; newPath: string | null } | null = null;
        let insideHunk = false;
        const addPath = (value: string) => {
            const normalized = this.normalizePatchRelativePath(value, 'patch file path');
            if (normalized && !normalized.endsWith('/')) files.add(normalized);
            return normalized;
        };
        const parseUnifiedHeaderPath = (value: string): string | null => {
            const stripped = this.stripUnifiedHeaderMetadata(value);
            if (stripped === '/dev/null') return null;
            if (stripped.startsWith('a/') || stripped.startsWith('b/')) return addPath(stripped.slice(2));
            // Do not let GNU patch interpret absolute or unprefixed header paths differently
            // from the workspace-contained paths recorded from diff --git headers.
            return addPath(stripped);
        };
        const assertHeaderMatchesGitPath = (kind: 'old' | 'new', actual: string | null, line: string) => {
            if (!currentGitPaths || actual === null) return;
            const expected = kind === 'old' ? currentGitPaths.oldPath : currentGitPaths.newPath;
            if (expected !== null && actual !== expected) {
                throw new Error(`patch ${kind} path header does not match diff --git path: ${line}`);
            }
        };
        const lines = diff.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const startsTraditionalHeaderPair =
                /^---\s+(.+)$/.test(line) &&
                /^\+\+\+\s+(.+)$/.test(lines[i + 1] || '') &&
                /^@@\s/.test(lines[i + 2] || '');
            if (insideHunk && startsTraditionalHeaderPair) {
                currentGitPaths = null;
                insideHunk = false;
            }
            // apply_patch format
            let m = line.match(/^\*\*\*\s+(?:Update|Add|Delete) File:\s+(.+)$/);
            if (m) {
                addPath(m[1]);
                currentGitPaths = null;
                continue;
            }
            // diff --git a/path b/path
            m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            if (m) {
                const oldPath = addPath(m[1]);
                const newPath = addPath(m[2]);
                currentGitPaths = { oldPath, newPath };
                insideHunk = false;
                continue;
            }
            if (/^@@\s/.test(line)) {
                insideHunk = true;
                continue;
            }
            // git unified diff headers. Parse every header path, not only a/ and b/ forms,
            // so unsafe absolute/no-prefix paths cannot be hidden behind a safe diff --git line.
            // Only header prologues are path-bearing; inside hunks, source lines may begin
            // with literal "---" or "+++" and must remain ordinary patch content.
            if (insideHunk) continue;
            m = line.match(/^---\s+(.+)$/);
            if (m) {
                const actual = parseUnifiedHeaderPath(m[1]);
                assertHeaderMatchesGitPath('old', actual, line);
                continue;
            }
            m = line.match(/^\+\+\+\s+(.+)$/);
            if (m) {
                const actual = parseUnifiedHeaderPath(m[1]);
                assertHeaderMatchesGitPath('new', actual, line);
            }
        }
        return Array.from(files);
    }

    stagePatch(snapshotId: string, diff: string, maxSizeBytes = 512 * 1024): { accepted: boolean; message?: string } {
        if (!diff || typeof diff !== 'string') return { accepted: false, message: 'Empty diff' };
        if (Buffer.byteLength(diff, 'utf8') > maxSizeBytes) {
            return { accepted: false, message: `Patch too large (> ${maxSizeBytes} bytes)` };
        }
        const normalizedDiff = this.normalizeUnifiedDiffForGitApply(diff);
        let touched: string[];
        try {
            touched = this.parseTouchedFilesFromPatch(normalizedDiff);
        } catch (error) {
            return { accepted: false, message: error instanceof Error ? error.message : String(error) };
        }
        if (!touched.length) {
            return { accepted: false, message: 'invalid_patch: no workspace files found in diff' };
        }
        if (!/^@@\s/m.test(normalizedDiff)) {
            return { accepted: false, message: 'invalid_patch: no patch hunks found in diff' };
        }
        const unsafeMode = this.rejectUnsafePatchFileModes(normalizedDiff);
        if (unsafeMode) return { accepted: false, message: unsafeMode };
        const snap = this.ensureSnapshot(snapshotId);
        const freshness = this.validateSnapshotBaseFresh(snap);
        if (!freshness.ok) return { accepted: false, message: freshness.message };
        if (snap.diffs.includes(normalizedDiff)) {
            return { accepted: true, message: 'Patch already staged in snapshot' };
        }
        const currentBytes = Buffer.byteLength(snap.diffs.join('\n'), 'utf8');
        const separatorBytes = snap.diffs.length ? 1 : 0;
        const nextBytes = currentBytes + separatorBytes + Buffer.byteLength(normalizedDiff, 'utf8');
        const maxSnapshotBytes = this.maxSnapshotDiffBytes();
        if (nextBytes > maxSnapshotBytes) {
            return { accepted: false, message: `Snapshot diff too large (> ${maxSnapshotBytes} bytes)` };
        }
        const validation = this.validatePatchAppliesAgainstSnapshot(normalizedDiff, snap);
        if (!validation.ok) return { accepted: false, message: validation.message };
        const previousTouched = snap.touchedFiles ? new Set(snap.touchedFiles) : undefined;
        snap.diffs.push(normalizedDiff);
        if (touched.length) {
            if (!snap.touchedFiles) snap.touchedFiles = new Set<string>();
            for (const f of touched) snap.touchedFiles.add(f);
        }
        try {
            this.persistSnapshotSync(snap);
        } catch (error) {
            snap.diffs.pop();
            snap.touchedFiles = previousTouched;
            return { accepted: false, message: errorMessage(error) };
        }
        return { accepted: true };
    }

    private validateSnapshotBaseFresh(snap: Snapshot): { ok: boolean; message?: string } {
        if (snap.baseFingerprint && this.workspaceBaseFingerprint(snap.workspaceRoot) !== snap.baseFingerprint) {
            return { ok: false, message: 'Workspace changed since snapshot creation; create a fresh snapshot' };
        }
        return { ok: true };
    }

    private validatePatchAppliesAgainstSnapshot(diff: string, snap: Snapshot): { ok: boolean; message?: string } {
        const root = path.resolve(snap.workspaceRoot || process.cwd());
        const materializedDir = path.join(this.snapshotsRoot(snap.workspaceRoot), snap.id);
        const freshness = this.validateSnapshotBaseFresh(snap);
        if (!freshness.ok) return freshness;
        if (snap.diffs.length === 0) {
            const materializedMarker = path.join(materializedDir, '.materialized');
            const canUseMaterialized =
                fs.existsSync(materializedMarker) && this.isSafeMaterializedSnapshotDir(materializedDir, snap);
            return this.validatePatchApplies(diff, canUseMaterialized ? materializedDir : root);
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-patch-base-'));
        try {
            this.copyWorkspaceForPatchValidation(root, tmpDir);
            for (const previous of snap.diffs) {
                const applied = this.applyDiffText(previous, tmpDir, false);
                if (!applied.ok)
                    return {
                        ok: false,
                        message: `invalid_patch: existing snapshot diff failed validation: ${applied.message || ''}`,
                    };
            }
            return this.validatePatchApplies(diff, tmpDir);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }

    private validatePatchApplies(diff: string, root: string): { ok: boolean; message?: string } {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-patch-check-'));
        const patchFile = path.join(tmpDir, 'candidate.diff');
        try {
            fs.writeFileSync(patchFile, diff, 'utf8');
            const checked = this.applyPatchFile(patchFile, root, true);
            if (checked.ok) return { ok: true };
            return {
                ok: false,
                message: `invalid_patch: patch validation failed${checked.message ? `: ${checked.message}` : ''}`,
            };
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }

    private applyDiffText(diff: string, root: string, check: boolean): { ok: boolean; message?: string } {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sci-patch-apply-'));
        const patchFile = path.join(tmpDir, 'candidate.diff');
        try {
            fs.writeFileSync(patchFile, diff, 'utf8');
            return this.applyPatchFile(patchFile, root, check);
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    }

    private applyPatchFile(patchFile: string, root: string, check: boolean): { ok: boolean; message?: string } {
        const gitArgs = ['apply'];
        if (check) gitArgs.push('--check');
        gitArgs.push('--whitespace=nowarn', patchFile);
        const git = spawnSync('git', gitArgs, { cwd: root, stdio: 'pipe', encoding: 'utf8' });
        if (git.status === 0) return { ok: true };
        const gitOutput = `${String(git.stdout || '')}${String(git.stderr || '')}`.slice(-1000).trim();
        return { ok: false, message: gitOutput };
    }

    private copyWorkspaceForPatchValidation(root: string, dest: string): void {
        if (this.which('rsync')) {
            this.spawnCheckedArgs(
                'rsync',
                [
                    '-a',
                    '--delete',
                    '--exclude',
                    '.git',
                    '--exclude',
                    'node_modules',
                    '--exclude',
                    '.ontology',
                    '--exclude',
                    'dist',
                    `${root}/`,
                    `${dest}/`,
                ],
                'Failed to copy patch validation workspace'
            );
            return;
        }
        if (this.which('tar')) {
            const cmd = `tar -C ${this.shellQuote(root)} --exclude .git --exclude node_modules --exclude .ontology --exclude dist -cf - . | tar -C ${this.shellQuote(dest)} -xf -`;
            this.spawnChecked(cmd, 'Failed to copy patch validation workspace');
            return;
        }
        for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
            if (['.git', '.ontology', 'node_modules', 'dist'].includes(ent.name)) continue;
            this.spawnCheckedArgs(
                'cp',
                ['-a', path.join(root, ent.name), path.join(dest, ent.name)],
                'Failed to copy patch validation workspace entry'
            );
        }
    }

    private which(cmd: string): string | null {
        const res = spawnSync('bash', ['-lc', `command -v ${cmd}`], { stdio: 'pipe' });
        return res.status === 0 ? String(res.stdout).trim() : null;
    }

    private parseCheckCommand(command: string): string[] | null {
        const input = String(command || '').trim();
        if (!input) return null;
        const words: string[] = [];
        let current = '';
        let quote: 'single' | 'double' | null = null;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === '\n' || ch === '\r' || ch === '\0') return null;
            if (!quote && /\s/.test(ch)) {
                if (current) {
                    words.push(current);
                    current = '';
                }
                continue;
            }
            if (!quote && ch === "'") {
                quote = 'single';
                continue;
            }
            if (!quote && ch === '"') {
                quote = 'double';
                continue;
            }
            if (quote === 'single' && ch === "'") {
                quote = null;
                continue;
            }
            if (quote === 'double' && ch === '"') {
                quote = null;
                continue;
            }
            if (ch === '\\') {
                const next = input[i + 1];
                if (next === undefined) return null;
                current += next;
                i++;
                continue;
            }
            current += ch;
        }
        if (quote) return null;
        if (current) words.push(current);
        return words.length ? words : null;
    }

    private isAllowedCheckEnvKey(key: string): boolean {
        return /^(BUN_JOBS|TIMEOUT|CI|FORCE_COLOR|NO_COLOR|LANG|LC_[A-Z_]+)$/.test(key);
    }

    private checkCommandPathBoundaryViolation(
        words: string[],
        env: Record<string, string>,
        cwd?: string
    ): string | null {
        for (const [key, value] of Object.entries(env)) {
            if (this.valueMentionsAbsolutePath(value))
                return `validation environment variable ${key} must not reference absolute paths`;
        }
        for (const word of words.slice(1)) {
            if (this.valueMentionsAbsolutePath(word))
                return `validation command argument must use workspace-relative paths: ${word}`;
            if (cwd) {
                const violation = this.existingCommandPathBoundaryViolation(word, cwd);
                if (violation) return violation;
            }
        }
        return null;
    }

    private existingCommandPathBoundaryViolation(word: string, cwd: string): string | null {
        const raw = String(word || '');
        if (!raw || raw.startsWith('-') || raw.includes('\0')) return null;
        const candidate = path.resolve(cwd, raw);
        try {
            fs.lstatSync(candidate);
        } catch {
            return null;
        }
        let realCwd: string;
        let realCandidate: string;
        try {
            realCwd = fs.realpathSync(cwd);
            realCandidate = fs.realpathSync(candidate);
        } catch {
            return `validation command argument must resolve within the check workspace: ${word}`;
        }
        const relative = path.relative(realCwd, realCandidate);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
            return `validation command argument must resolve within the check workspace: ${word}`;
        }
        return null;
    }

    private valueMentionsAbsolutePath(value: string): boolean {
        const raw = String(value || '');
        if (/file:\/\//i.test(raw)) return true;
        const candidates = [raw];
        const equalsIndex = raw.indexOf('=');
        if (equalsIndex > 0) candidates.push(raw.slice(equalsIndex + 1));
        return candidates.some(
            (candidate) => path.isAbsolute(candidate) || this.valueMentionsParentTraversal(candidate)
        );
    }

    private valueMentionsParentTraversal(value: string): boolean {
        return value.split(/[\\/]+/).some((segment) => segment === '..');
    }

    private isPackageScriptCommand(words: string[]): boolean {
        const executable = words[0];
        if (executable === 'bun') return words[1] === 'run';
        return (executable === 'npm' || executable === 'pnpm' || executable === 'yarn') && words[1] === 'run';
    }

    private isMutableRunnerCommand(words: string[]): boolean {
        return this.isPackageScriptCommand(words) || words[0] === 'just';
    }

    private packageScriptName(words: string[]): string | null {
        if (!this.isPackageScriptCommand(words)) return null;
        const candidate = words[2];
        if (!candidate || candidate === '--') return null;
        if (candidate.startsWith('-')) return null;
        // `bun run ./script.ts` and similar file execution has an explicit path operand;
        // only package-script names hide a second command body behind the runner.
        if (candidate.includes('/') || candidate.includes('\\')) return null;
        return candidate;
    }

    private readPackageScripts(cwd: string): Record<string, string> | null {
        try {
            const raw = fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
            const parsed = JSON.parse(raw);
            const scripts = parsed?.scripts;
            if (!scripts || typeof scripts !== 'object') return null;
            const out: Record<string, string> = {};
            for (const [key, value] of Object.entries(scripts)) {
                if (typeof value === 'string') out[key] = value;
            }
            return out;
        } catch {
            return null;
        }
    }

    private splitCheckScriptBody(script: string): string[] | null {
        const raw = String(script || '').trim();
        if (!raw) return [];
        const withoutAnd = raw.replace(/&&/g, '');
        if (/[;&|<>`\r\n]/.test(withoutAnd) || /\$\s*\(/.test(raw)) return null;
        return raw
            .split(/\s*&&\s*/)
            .map((part) => part.trim())
            .filter(Boolean);
    }

    private validatePackageScriptBody(
        cwd: string,
        scripts: Record<string, string>,
        scriptName: string,
        seen: Set<string>
    ): string | null {
        const script = scripts[scriptName];
        if (typeof script !== 'string') return null;
        const key = `${cwd}:${scriptName}`;
        if (seen.has(key)) return `package script cycle detected for ${scriptName}`;
        const parts = this.splitCheckScriptBody(script);
        if (!parts) return `package script ${scriptName} uses unsupported shell syntax`;
        const nextSeen = new Set(seen);
        nextSeen.add(key);
        for (const part of parts) {
            const resolved = this.resolveCheckCommand(part);
            if (!resolved.ok) return `package script ${scriptName} is not validation-safe: ${resolved.message}`;
            const pathViolation = this.checkCommandPathBoundaryViolation(resolved.words, resolved.env, cwd);
            if (pathViolation) return `package script ${scriptName} is not validation-safe: ${pathViolation}`;
            const nested = this.validatePackageRunnerScript(resolved.words, cwd, nextSeen);
            if (nested) return nested;
        }
        return null;
    }

    private validatePackageRunnerScript(words: string[], cwd: string, seen = new Set<string>()): string | null {
        if (process.env.SCI_ALLOW_CHECK_RUNNER_SCRIPTS === '1') return null;
        if (words[0] === 'just') {
            return 'just runner commands require SCI_ALLOW_CHECK_RUNNER_SCRIPTS=1 because justfile recipe bodies are not inspected';
        }
        if (this.isPackageScriptCommand(words) && words[2]?.startsWith('-')) {
            return 'package runner options are not supported for validation-safe script inspection';
        }
        const scriptName = this.packageScriptName(words);
        if (!scriptName) return null;
        const scripts = this.readPackageScripts(cwd);
        if (!scripts || typeof scripts[scriptName] !== 'string') {
            return `package script ${scriptName} must be explicitly declared for validation-safe runner execution`;
        }
        for (const lifecycleName of [`pre${scriptName}`, scriptName, `post${scriptName}`]) {
            const violation = this.validatePackageScriptBody(cwd, scripts, lifecycleName, seen);
            if (violation) return violation;
        }
        return null;
    }

    private resolveCheckCommand(
        command: string
    ): { ok: true; words: string[]; env: Record<string, string> } | { ok: false; message: string } {
        const parsed = this.parseCheckCommand(command);
        if (!parsed) return { ok: false, message: 'unsupported shell syntax' };
        const env: Record<string, string> = {};
        const words = [...parsed];
        while (words.length > 1 && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(words[0])) {
            const assignment = words.shift()!;
            const index = assignment.indexOf('=');
            const key = assignment.slice(0, index);
            if (!this.isAllowedCheckEnvKey(key))
                return { ok: false, message: `unsupported validation environment variable: ${key}` };
            env[key] = assignment.slice(index + 1);
        }
        const executable = words[0];
        const allowed = new Set([
            'true',
            'false',
            'bun',
            'bunx',
            'npm',
            'pnpm',
            'yarn',
            'just',
            'tsgo',
            'tsc',
            'biome',
            'grep',
            'rg',
            'git',
            'rimraf',
            'test',
        ]);
        if (!allowed.has(executable)) {
            return { ok: false, message: `unsupported validation command: ${executable}` };
        }
        if (executable === 'bun' && !['run', 'test'].includes(words[1] || '')) {
            return { ok: false, message: `unsupported bun validation subcommand: ${words[1] || '<missing>'}` };
        }
        if ((executable === 'npm' || executable === 'pnpm' || executable === 'yarn') && (words[1] || '') !== 'run') {
            return {
                ok: false,
                message: `unsupported ${executable} validation subcommand: ${words[1] || '<missing>'}`,
            };
        }
        if (executable === 'bunx' && !['tsgo', '@biomejs/biome', 'biome'].includes(words[1] || '')) {
            return { ok: false, message: `unsupported bunx validation tool: ${words[1] || '<missing>'}` };
        }
        if (executable === 'git') {
            const subcommand = words[1] || '';
            if (!['status', 'diff', 'apply', 'ls-files', 'rev-parse'].includes(subcommand)) {
                return { ok: false, message: `unsupported git validation subcommand: ${subcommand || '<missing>'}` };
            }
            if (subcommand === 'apply') {
                if (words.includes('--unsafe-paths')) {
                    return { ok: false, message: 'unsupported git apply option: --unsafe-paths' };
                }
                if (!words.includes('--check')) {
                    return { ok: false, message: 'git apply validation commands must include --check' };
                }
            }
        }
        if (executable === 'grep') {
            const followsSymlinks = words
                .slice(1)
                .some((word) => word === '--dereference-recursive' || /^-[^-]*R/.test(word));
            if (followsSymlinks)
                return { ok: false, message: 'unsupported grep option: recursive symlink following is not allowed' };
        }
        if (executable === 'rg') {
            const followsSymlinks = words.slice(1).some((word) => word === '--follow' || /^-[^-]*L/.test(word));
            if (followsSymlinks)
                return { ok: false, message: 'unsupported rg option: symlink following is not allowed' };
        }
        const pathBoundaryViolation = this.checkCommandPathBoundaryViolation(words, env);
        if (pathBoundaryViolation) return { ok: false, message: pathBoundaryViolation };
        return { ok: true, words, env };
    }

    private checkCommandEnvironment(
        gitCeilingDirectory: string,
        isolatedEnvRoot: string,
        extraEnv: Record<string, string> = {}
    ): Record<string, string> {
        const env: Record<string, string> = {};
        const preserve = (key: string) => {
            const value = process.env[key];
            if (typeof value === 'string') env[key] = value;
        };
        for (const key of ['PATH', 'CI', 'FORCE_COLOR', 'NO_COLOR', 'BUN_JOBS', 'LANG']) {
            preserve(key);
        }
        for (const [key, value] of Object.entries(process.env)) {
            if (typeof value === 'string' && key.startsWith('LC_')) {
                env[key] = value;
            }
        }
        const home = path.join(isolatedEnvRoot, 'home');
        const tmp = path.join(isolatedEnvRoot, 'tmp');
        const cache = path.join(isolatedEnvRoot, 'xdg-cache');
        const bunInstall = path.join(isolatedEnvRoot, 'bun-install');
        for (const dir of [home, tmp, cache, bunInstall]) fs.mkdirSync(dir, { recursive: true });
        env.HOME = home;
        env.TMPDIR = tmp;
        env.TMP = tmp;
        env.TEMP = tmp;
        env.XDG_CACHE_HOME = cache;
        env.BUN_INSTALL = bunInstall;
        Object.assign(env, extraEnv);
        env.GIT_CEILING_DIRECTORIES = gitCeilingDirectory;
        return env;
    }

    private resolveWorkspaceBase(workspaceRoot?: string): string {
        if (workspaceRoot) {
            const abs = path.resolve(workspaceRoot);
            if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return abs;
        }
        const envBase = process.env.WORKSPACE_ROOT || process.env.SEMANTIC_CODE_WORKSPACE || '';
        if (envBase) {
            try {
                const abs = path.resolve(envBase);
                if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
                    return abs;
                }
            } catch {}
        }
        // If a tool invocation runs from inside a materialized snapshot directory
        // (e.g. `.ontology/snapshots/<id>`), treat the repo root as the workspace base.
        // This keeps SNAPSHOT_PARTIAL runs able to "ensure" missing files from the real workspace.
        try {
            const cwd = process.cwd();
            const marker = `${path.sep}.ontology${path.sep}snapshots${path.sep}`;
            const idx = cwd.lastIndexOf(marker);
            if (idx !== -1) {
                const root = path.resolve(cwd.slice(0, idx));
                if (fs.existsSync(root) && fs.statSync(root).isDirectory()) {
                    return root;
                }
            }
        } catch {}
        return path.resolve('.');
    }

    private async ensureMaterialized(
        snapshotId: string,
        opts: { workspaceRoot?: string; allowCurrentMaterializedWithWorkspaceDrift?: boolean } = {}
    ): Promise<string | null> {
        this.assertValidId(snapshotId);
        const snap = this.ensureSnapshot(snapshotId, opts);
        return this.withMaterializeLock(snapshotId, snap.workspaceRoot, () =>
            this.ensureMaterializedUnlocked(snapshotId, !!opts.allowCurrentMaterializedWithWorkspaceDrift)
        );
    }

    private async ensureMaterializedUnlocked(
        snapshotId: string,
        allowCurrentMaterializedWithWorkspaceDrift = false
    ): Promise<string | null> {
        const snap = this.ensureSnapshot(snapshotId);
        let snapsRoot = this.snapshotsRoot(snap.workspaceRoot);
        const dir = path.join(snapsRoot, snapshotId);
        await fsp.mkdir(snapsRoot, { recursive: true }).catch(() => {});
        snapsRoot = this.assertSafeSnapshotStorageRoot(snap.workspaceRoot);
        const materializedMarker = path.join(dir, '.materialized');
        const preferPartial = process.env.SNAPSHOT_PARTIAL === '1';
        const base = this.resolveWorkspaceBase(snap.workspaceRoot);
        const desiredFingerprint = this.snapshotDiffFingerprint(snap);
        const currentFingerprint = fs.existsSync(materializedMarker)
            ? this.readMaterializedFingerprint(materializedMarker)
            : null;
        const touched = snap?.touchedFiles ? Array.from(snap.touchedFiles) : [];

        const currentMaterializationIsSafe =
            currentFingerprint === desiredFingerprint && this.isSafeMaterializedSnapshotDir(dir, snap);
        if (currentMaterializationIsSafe && allowCurrentMaterializedWithWorkspaceDrift) return dir;
        if (snap?.baseFingerprint && this.workspaceBaseFingerprint(snap.workspaceRoot) !== snap.baseFingerprint) {
            throw new Error(
                'Workspace changed since snapshot creation before materialization; create a fresh snapshot'
            );
        }
        if (currentMaterializationIsSafe) return dir;

        const tempDir = path.join(snapsRoot, `.${snapshotId}.${process.pid}.${Date.now()}.tmp`);
        const oldDir = path.join(snapsRoot, `.${snapshotId}.${process.pid}.${Date.now()}.old`);
        await this.logProgress(snapshotId, currentFingerprint ? 'materialize:refresh-start' : 'materialize:start');
        await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        await fsp.mkdir(tempDir, { recursive: true });

        try {
            if (preferPartial && touched.length > 0) {
                // Partial materialize: copy only touched files and essential configs
                await this.logProgress(snapshotId, `materialize:partial ${touched.length} files`);
                const essential = ['tsconfig.json', 'tsconfig.build.json', 'package.json'];
                const toCopy = [...new Set([...touched, ...essential])];
                for (const rel of toCopy) {
                    const { absolutePath: src } = this.containedPath(base, rel, 'snapshot source path');
                    const { absolutePath: dst } = this.containedPath(tempDir, rel, 'snapshot destination path');
                    await fsp.mkdir(path.dirname(dst), { recursive: true });
                    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
                        this.spawnCheckedArgs('cp', ['-a', src, dst], 'Failed to copy snapshot file');
                    }
                }
            } else {
                // Full copy: prefer rsync; fallback to tar or cp
                if (this.which('rsync')) {
                    await this.logProgress(snapshotId, `materialize:rsync ${base} -> ${tempDir}`);
                    this.spawnCheckedArgs(
                        'rsync',
                        [
                            '-a',
                            '--delete',
                            '--exclude',
                            '.git',
                            '--exclude',
                            'node_modules',
                            '--exclude',
                            '.ontology',
                            '--exclude',
                            '.test-results',
                            '--exclude',
                            'dist',
                            `${base}/`,
                            `${tempDir}/`,
                        ],
                        'Failed to copy snapshot base with rsync'
                    );
                } else if (this.which('tar')) {
                    await this.logProgress(snapshotId, `materialize:tar ${base} -> ${tempDir}`);
                    const cmd = `tar -C ${this.shellQuote(base)} --exclude .git --exclude node_modules --exclude .ontology --exclude .test-results --exclude dist -cf - . | tar -C ${this.shellQuote(tempDir)} -xf -`;
                    this.spawnChecked(cmd, 'Failed to copy snapshot base with tar');
                } else {
                    const entries = await fsp.readdir(base, { withFileTypes: true });
                    for (const ent of entries) {
                        if (['.git', '.ontology', '.test-results', 'node_modules', 'dist'].includes(ent.name)) continue;
                        const src = path.join(base, ent.name);
                        const dest = path.join(tempDir, ent.name);
                        this.spawnCheckedArgs('cp', ['-a', src, dest], 'Failed to copy snapshot base entry');
                    }
                }
            }

            if (snap?.diffs.length) {
                await this.logProgress(snapshotId, `apply:diffs ${snap.diffs.length}`);
                const overlayText = snap.diffs.join('\n');
                this.parseTouchedFilesFromPatch(overlayText);
                const unsafeMode = this.rejectUnsafePatchFileModes(overlayText);
                if (unsafeMode) throw new Error(unsafeMode);
                const diffFile = path.join(tempDir, 'overlay.diff');
                await fsp.writeFile(diffFile, overlayText, 'utf8');
                let ok = false;
                let output = '';

                if (this.which('git')) {
                    const applied = spawnSync('git', ['-C', tempDir, 'apply', '--whitespace=nowarn', 'overlay.diff'], {
                        stdio: 'pipe',
                        env: { ...process.env, GIT_CEILING_DIRECTORIES: snapsRoot },
                    });
                    ok = applied.status === 0;
                    output += `${String(applied.stdout || '')}${String(applied.stderr || '')}`;
                }

                if (!ok) {
                    throw new Error(
                        `Failed to materialize snapshot overlay: ${output.slice(-1000) || 'patch application failed'}`
                    );
                }
                await this.logProgress(snapshotId, 'apply:done');
            }

            await this.writeMaterializedMarker(path.join(tempDir, '.materialized'), snap);
            if (snap)
                await fsp.writeFile(
                    path.join(tempDir, 'metadata.json'),
                    JSON.stringify(this.serializeSnapshot(snap), null, 2),
                    'utf8'
                );

            await fsp.rm(oldDir, { recursive: true, force: true }).catch(() => {});
            if (fs.existsSync(dir)) await fsp.rename(dir, oldDir);
            await fsp.rename(tempDir, dir);
            await fsp.rm(oldDir, { recursive: true, force: true }).catch(() => {});
            if (snap) this.snapshots.set(snap.id, snap);
            await this.logProgress(snapshotId, currentFingerprint ? 'materialize:refresh-done' : 'materialize:done');
            return dir;
        } catch (error) {
            await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    private async createCheckWorkspace(
        snapshotId: string,
        materializedDir: string
    ): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
        this.assertValidId(snapshotId);
        const snap = this.ensureSnapshot(snapshotId);
        const snapsRoot = this.snapshotsRoot(snap.workspaceRoot);
        const checkDir = path.join(snapsRoot, `.${snapshotId}.${process.pid}.${Date.now()}.${randomUUID()}.check`);
        await fsp.rm(checkDir, { recursive: true, force: true }).catch(() => {});
        await fsp.mkdir(checkDir, { recursive: true });
        try {
            if (this.which('rsync')) {
                this.spawnCheckedArgs(
                    'rsync',
                    ['-a', '--delete', `${materializedDir}/`, `${checkDir}/`],
                    'Failed to copy snapshot check workspace'
                );
            } else if (this.which('tar')) {
                this.spawnChecked(
                    `tar -C ${this.shellQuote(materializedDir)} -cf - . | tar -C ${this.shellQuote(checkDir)} -xf -`,
                    'Failed to copy snapshot check workspace'
                );
            } else {
                const entries = await fsp.readdir(materializedDir, { withFileTypes: true });
                for (const ent of entries) {
                    const src = path.join(materializedDir, ent.name);
                    const dest = path.join(checkDir, ent.name);
                    this.spawnCheckedArgs('cp', ['-a', src, dest], 'Failed to copy snapshot check workspace entry');
                }
            }
            return {
                cwd: checkDir,
                cleanup: async () => {
                    await fsp.rm(checkDir, { recursive: true, force: true });
                },
            };
        } catch (error) {
            await fsp.rm(checkDir, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    private assertNoSymlinkEscapes(root: string, label: string): void {
        const realRoot = fs.realpathSync(root);
        const stack = [root];
        while (stack.length) {
            const current = stack.pop()!;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(current, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const entry of entries) {
                const absolutePath = path.join(current, entry.name);
                const relativePath = path.relative(root, absolutePath) || entry.name;
                const stat = fs.lstatSync(absolutePath);
                if (stat.isSymbolicLink()) {
                    let realTarget: string;
                    try {
                        realTarget = fs.realpathSync(absolutePath);
                    } catch {
                        throw new Error(`${label} contains unreadable symlink: ${relativePath}`);
                    }
                    const relativeTarget = path.relative(realRoot, realTarget);
                    if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) {
                        throw new Error(`${label} contains symlink escape: ${relativePath}`);
                    }
                    continue;
                }
                if (stat.isDirectory()) stack.push(absolutePath);
            }
        }
    }

    async runChecks(
        snapshotId: string,
        commands: string[],
        timeoutSec = 120,
        opts: { onlyTouched?: boolean; workspaceRoot?: string } = {}
    ): Promise<CheckRunResult> {
        this.assertValidId(snapshotId);
        this.ensureSnapshot(snapshotId, { workspaceRoot: opts.workspaceRoot });
        const start = Date.now();
        // Materialize snapshot into .ontology/snapshots/<id>, then run commands in a disposable copy.
        // Check commands are caller-controlled and may write files; they must not mutate the reusable
        // materialized snapshot cache used by later read/search/navigation calls.
        const materializedCwd =
            (await this.ensureMaterialized(snapshotId)) ||
            this.resolveWorkspaceBase(this.ensureSnapshot(snapshotId).workspaceRoot);
        const checkWorkspace = await this.createCheckWorkspace(snapshotId, materializedCwd);
        const cwd = checkWorkspace.cwd;
        const isolatedEnvRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'sci-check-env-'));
        try {
            const output: string[] = [];
            const maxOutputBytes = 1024 * 1024;
            let outputBytes = 0;
            let outputTruncated = false;
            const appendOutput = (text: string) => {
                if (outputTruncated) return;
                const bytes = Buffer.byteLength(text, 'utf8');
                if (outputBytes + bytes <= maxOutputBytes) {
                    output.push(text);
                    outputBytes += bytes;
                    return;
                }
                const remaining = Math.max(0, maxOutputBytes - outputBytes);
                if (remaining > 0) {
                    output.push(Buffer.from(text, 'utf8').subarray(0, remaining).toString('utf8'));
                }
                output.push(`\n[output truncated at ${maxOutputBytes} bytes]\n`);
                outputBytes = maxOutputBytes;
                outputTruncated = true;
            };
            // Build command list before any partial-workspace hydration so default
            // validation commands get the same source/test/script fill as explicit commands.
            let cmdList = commands && commands.length ? [...commands] : ['bun run typecheck', 'bun run build'];
            const maxCommands = 20;
            if (cmdList.length > maxCommands) {
                return {
                    ok: false,
                    output: `Rejected check command list: at most ${maxCommands} commands are allowed\n`,
                    elapsedMs: Date.now() - start,
                    commands: [],
                };
            }
            // If running under partial materialization, ensure essential directories exist
            // for common commands like build/test which require source files or local scripts.
            try {
                const preferPartial = process.env.SNAPSHOT_PARTIAL === '1';
                const needsBuild = cmdList.some((c) => /\b(build(:|\b)|bun\s+build|bun\s+run\s+build)/.test(c));
                const needsTest = cmdList.some((c) => /\b(test(\b|:)|bun\s+test|just\s+test(\b|[-_]))/.test(c));
                const needsScripts = cmdList.some((c) => /\bbun\s+run\s+|npm\s+run\s+|pnpm\s+run\s+/.test(c));
                if (preferPartial && (needsBuild || needsTest || needsScripts)) {
                    const snap = this.ensureSnapshot(snapshotId);
                    const base = this.resolveWorkspaceBase(snap.workspaceRoot);
                    const touched = Array.from(snap.touchedFiles || []);
                    const deletedInSnapshot = touched.filter((rel) => {
                        try {
                            const { absolutePath } = this.containedPath(cwd, rel, 'partial snapshot touched path');
                            return !fs.existsSync(absolutePath);
                        } catch {
                            return false;
                        }
                    });
                    if (
                        snap.baseFingerprint &&
                        this.workspaceBaseFingerprint(snap.workspaceRoot) !== snap.baseFingerprint
                    ) {
                        throw new Error(
                            'Workspace changed since snapshot creation before partial check fill; create a fresh snapshot'
                        );
                    }
                    const ensureDirs = ['src', 'tests', 'scripts', 'bin'];
                    for (const d of ensureDirs) {
                        const needThis =
                            d === 'src'
                                ? needsBuild || needsTest
                                : d === 'tests'
                                  ? needsTest
                                  : d === 'scripts'
                                    ? needsScripts
                                    : d === 'bin'
                                      ? needsTest
                                      : false;
                        if (!needThis) continue;

                        const srcDir = path.join(base, d);
                        const dstDir = path.join(cwd, d);
                        if (!fs.existsSync(srcDir)) continue;

                        await this.logProgress(snapshotId, `materialize:ensure-${d}`);

                        // Fill in missing files without clobbering already-copied (and patched) touched files.
                        fs.mkdirSync(dstDir, { recursive: true });
                        if (this.which('rsync')) {
                            this.spawnCheckedArgs(
                                'rsync',
                                ['-a', '--ignore-existing', `${srcDir}/`, `${dstDir}/`],
                                'Failed to ensure partial snapshot directory'
                            );
                        } else if (this.which('tar')) {
                            // tar-based copy is more reliable than cp -n for deep trees and preserves existing (patched) files.
                            this.spawnChecked(
                                `tar -C ${this.shellQuote(srcDir)} -cf - . | tar -C ${this.shellQuote(dstDir)} -xf - --skip-old-files`,
                                'Failed to ensure partial snapshot directory'
                            );
                        } else {
                            this.spawnCheckedArgs(
                                'cp',
                                ['-a', '-n', `${srcDir}/.`, `${dstDir}/`],
                                'Failed to ensure partial snapshot directory'
                            );
                        }
                    }
                    for (const rel of deletedInSnapshot) {
                        const { absolutePath } = this.containedPath(cwd, rel, 'partial snapshot deleted path');
                        await fsp.rm(absolutePath, { recursive: true, force: true }).catch(() => undefined);
                    }
                    if (
                        snap.baseFingerprint &&
                        this.workspaceBaseFingerprint(snap.workspaceRoot) !== snap.baseFingerprint
                    ) {
                        throw new Error(
                            'Workspace changed since snapshot creation during partial check fill; create a fresh snapshot'
                        );
                    }
                    this.assertNoSymlinkEscapes(cwd, 'check workspace');
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error || 'partial check fill failed');
                return {
                    ok: false,
                    output: `Rejected check workspace: ${message}\n`,
                    elapsedMs: Date.now() - start,
                    commands: [],
                };
            }
            const onlyTouched = !!opts.onlyTouched || (process.env.FAST_STDIO_CHECKS || '').toLowerCase() === 'touched';
            try {
                const snap = this.ensureSnapshot(snapshotId);
                const touched = Array.from(snap.touchedFiles || []);
                const tsFiles = touched.filter((f) => /\.(ts|tsx)$/.test(f));
                if (onlyTouched && touched.length > 0 && tsFiles.length > 0 && this.which('bunx')) {
                    // Prefer a quick tsgo typecheck against touched TS files
                    const limited = tsFiles
                        .slice(0, 50) // cap to avoid overly long cmdlines
                        .map((f) => this.shellQuote(f.startsWith('-') ? `./${f}` : f))
                        .join(' ');
                    const quick = `bunx tsgo --noEmit --pretty false --ignoreConfig ${limited}`;
                    // Prepend quick check if no explicit commands were provided, or if it fits within the command cap.
                    if (!(commands && commands.length)) {
                        cmdList = [quick];
                    } else if (cmdList.length < maxCommands) {
                        cmdList.unshift(quick);
                    }
                }
            } catch {}
            if (cmdList.length > maxCommands) {
                return {
                    ok: false,
                    output: `Rejected check command list: at most ${maxCommands} commands are allowed\n`,
                    elapsedMs: Date.now() - start,
                    commands: [],
                };
            }
            // Enforce a global safety clamp for per-command timeout seconds across all adapters.
            // Rationale: values >600s lead to excessively long CI/dev runs and can hang pipelines.
            // HTTP already clamps to 600; this keeps MCP/CLI parity and centralizes the guard.
            const perCommandTimeoutSec = Math.max(1, Math.min(600, Math.floor(Number(timeoutSec) || 120)));
            const maxCommandLength = 8192;
            const commandResults: CheckCommandReceipt[] = [];

            for (const rawCmd of cmdList) {
                const cmd = String(rawCmd);
                if (cmd.length > maxCommandLength) {
                    appendOutput(
                        `Rejected check command: command length must be at most ${maxCommandLength} characters\n`
                    );
                    commandResults.push({
                        command: cmd.slice(0, maxCommandLength),
                        ok: false,
                        elapsedMs: 0,
                        exitCode: null,
                        timedOut: false,
                    });
                    return {
                        ok: false,
                        output: output.join(''),
                        elapsedMs: Date.now() - start,
                        commands: commandResults,
                    };
                }
                await this.logProgress(snapshotId, `run:${cmd}:start`);
                appendOutput(`$ ${cmd}\n`);
                const allowUnsafeShell = process.env.SCI_ALLOW_UNSAFE_CHECK_COMMANDS === '1';
                const resolvedCommand = allowUnsafeShell ? null : this.resolveCheckCommand(cmd);
                if (resolvedCommand && !resolvedCommand.ok) {
                    const message = `Rejected check command: ${resolvedCommand.message}\n`;
                    appendOutput(message);
                    commandResults.push({ command: cmd, ok: false, elapsedMs: 0, exitCode: null, timedOut: false });
                    return {
                        ok: false,
                        output: output.join(''),
                        elapsedMs: Date.now() - start,
                        commands: commandResults,
                    };
                }
                const bashPath = allowUnsafeShell ? this.which('bash') : null;
                if (allowUnsafeShell && !bashPath) {
                    appendOutput('Rejected check command: unsafe shell mode requires bash\n');
                    commandResults.push({ command: cmd, ok: false, elapsedMs: 0, exitCode: null, timedOut: false });
                    return {
                        ok: false,
                        output: output.join(''),
                        elapsedMs: Date.now() - start,
                        commands: commandResults,
                    };
                }
                if (resolvedCommand?.ok) {
                    const snap = this.ensureSnapshot(snapshotId);
                    const touched = Array.from(snap.touchedFiles || []);
                    const runnerTouched = touched.some(
                        (file) => file === 'package.json' || file === 'justfile' || file === 'Justfile'
                    );
                    if (
                        runnerTouched &&
                        this.isMutableRunnerCommand(resolvedCommand.words) &&
                        process.env.SCI_ALLOW_MUTATED_CHECK_RUNNERS !== '1'
                    ) {
                        const message =
                            'Rejected check command: package/just runner commands are disabled when the patch changes their runner definitions; use direct tool commands or set SCI_ALLOW_MUTATED_CHECK_RUNNERS=1\n';
                        appendOutput(message);
                        commandResults.push({ command: cmd, ok: false, elapsedMs: 0, exitCode: null, timedOut: false });
                        return {
                            ok: false,
                            output: output.join(''),
                            elapsedMs: Date.now() - start,
                            commands: commandResults,
                        };
                    }
                }
                if (resolvedCommand?.ok) {
                    const runnerScriptViolation = this.validatePackageRunnerScript(resolvedCommand.words, cwd);
                    if (runnerScriptViolation) {
                        const message = `Rejected check command: ${runnerScriptViolation}\n`;
                        appendOutput(message);
                        commandResults.push({ command: cmd, ok: false, elapsedMs: 0, exitCode: null, timedOut: false });
                        return {
                            ok: false,
                            output: output.join(''),
                            elapsedMs: Date.now() - start,
                            commands: commandResults,
                        };
                    }
                    const pathBoundaryViolation = this.checkCommandPathBoundaryViolation(
                        resolvedCommand.words,
                        resolvedCommand.env,
                        cwd
                    );
                    if (pathBoundaryViolation) {
                        const message = `Rejected check command: ${pathBoundaryViolation}\n`;
                        appendOutput(message);
                        commandResults.push({ command: cmd, ok: false, elapsedMs: 0, exitCode: null, timedOut: false });
                        return {
                            ok: false,
                            output: output.join(''),
                            elapsedMs: Date.now() - start,
                            commands: commandResults,
                        };
                    }
                    try {
                        this.assertNoSymlinkEscapes(cwd, 'check workspace');
                    } catch (error) {
                        const message =
                            error instanceof Error ? error.message : String(error || 'symlink validation failed');
                        appendOutput(`Rejected check workspace: ${message}\n`);
                        commandResults.push({ command: cmd, ok: false, elapsedMs: 0, exitCode: null, timedOut: false });
                        return {
                            ok: false,
                            output: output.join(''),
                            elapsedMs: Date.now() - start,
                            commands: commandResults,
                        };
                    }
                }
                const [bin, ...args] = resolvedCommand?.ok ? resolvedCommand.words : [bashPath || 'bash', '-lc', cmd];
                const commandStart = Date.now();
                const result = await new Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean }>(
                    (resolve) => {
                        const env = this.checkCommandEnvironment(
                            this.snapshotsRoot(this.ensureSnapshot(snapshotId).workspaceRoot),
                            isolatedEnvRoot,
                            resolvedCommand?.ok ? resolvedCommand.env : {}
                        );
                        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env, detached: true });
                        let settled = false;
                        let timer: ReturnType<typeof setTimeout>;
                        const finish = (value: { ok: boolean; exitCode: number | null; timedOut: boolean }) => {
                            if (settled) return;
                            settled = true;
                            clearTimeout(timer);
                            resolve(value);
                        };
                        timer = setTimeout(() => {
                            try {
                                if (child.pid) process.kill(-child.pid, 'SIGKILL');
                                else child.kill('SIGKILL');
                            } catch {
                                try {
                                    child.kill('SIGKILL');
                                } catch {}
                            }
                            void this.logProgress(snapshotId, `run:${cmd}:timeout`);
                            finish({ ok: false, exitCode: null, timedOut: true });
                        }, perCommandTimeoutSec * 1000);
                        child.stdout.on('data', (d) => appendOutput(String(d)));
                        child.stderr.on('data', (d) => appendOutput(String(d)));
                        child.on('error', (error) => {
                            appendOutput(String(error?.message || error));
                            void this.logProgress(snapshotId, `run:${cmd}:error`);
                            finish({ ok: false, exitCode: null, timedOut: false });
                        });
                        child.on('close', (code) => {
                            void this.logProgress(snapshotId, `run:${cmd}:done code=${code}`);
                            finish({
                                ok: code === 0,
                                exitCode: typeof code === 'number' ? code : null,
                                timedOut: false,
                            });
                        });
                    }
                );
                commandResults.push({
                    command: cmd,
                    ok: result.ok,
                    elapsedMs: Date.now() - commandStart,
                    exitCode: result.exitCode,
                    timedOut: result.timedOut,
                });
                if (!result.ok) {
                    return {
                        ok: false,
                        output: output.join(''),
                        elapsedMs: Date.now() - start,
                        commands: commandResults,
                    };
                }
            }
            await this.logProgress(snapshotId, 'checks:done');
            return { ok: true, output: output.join(''), elapsedMs: Date.now() - start, commands: commandResults };
        } finally {
            await checkWorkspace.cleanup().catch(() => undefined);
            await fsp.rm(isolatedEnvRoot, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    private collectApplyTargetDirs(diffText: string): string[] {
        const dirs = new Set<string>();
        for (const line of diffText.split(/\r?\n/)) {
            const match = line.match(/^\+\+\+\s+b\/(.+)$/) || line.match(/^\*\*\*\s+Add File:\s+(.+)$/);
            if (!match || !match[1]) continue;
            const normalized = this.normalizePatchRelativePath(match[1], 'apply_snapshot patch path');
            if (!normalized) continue;
            const dir = path.posix.dirname(normalized);
            if (dir && dir !== '.' && dir !== '/') dirs.add(dir);
        }
        return Array.from(dirs).sort((a, b) => a.length - b.length);
    }

    private collectApplyDirState(dirs: string[], workspaceRoot?: string): { missing: string[]; existing: string[] } {
        const root = this.resolveWorkspaceBase(workspaceRoot);
        const missing = new Set<string>();
        const existing = new Set<string>();
        for (const dir of dirs) {
            let current = '';
            for (const part of dir.split('/').filter(Boolean)) {
                current = current ? `${current}/${part}` : part;
                const { absolutePath, relativePath } = this.containedPath(root, current, 'apply_snapshot directory');
                if (!fs.existsSync(absolutePath)) {
                    missing.add(relativePath);
                    continue;
                }
                const stat = fs.lstatSync(absolutePath);
                if (!stat.isDirectory() || stat.isSymbolicLink()) {
                    throw new Error('apply_snapshot directory must be a non-symlink directory');
                }
                existing.add(relativePath);
            }
        }
        return {
            missing: Array.from(missing).sort((a, b) => b.length - a.length),
            existing: Array.from(existing).sort((a, b) => a.length - b.length),
        };
    }

    private async removeRecordedApplyDirs(dirs: string[] | undefined, workspaceRoot?: string): Promise<void> {
        const ordered = Array.from(new Set(dirs || [])).sort((a, b) => b.length - a.length);
        for (const rel of ordered) {
            const { absolutePath } = this.containedPath(
                this.resolveWorkspaceBase(workspaceRoot),
                rel,
                'apply_snapshot directory'
            );
            await fsp.rmdir(absolutePath).catch(() => undefined);
        }
    }

    private async recreateRecordedApplyDirs(dirs: string[] | undefined, workspaceRoot?: string): Promise<void> {
        const ordered = Array.from(new Set(dirs || [])).sort((a, b) => a.length - b.length);
        for (const rel of ordered) {
            const { absolutePath } = this.containedPath(
                this.resolveWorkspaceBase(workspaceRoot),
                rel,
                'apply_snapshot directory'
            );
            await fsp.mkdir(absolutePath, { recursive: true }).catch(() => undefined);
        }
    }

    private rewriteNoIndexDiffForWorkspace(diff: string, rel: string, oldPath: string, newPath: string): string {
        const normalizedRel = rel.split(path.sep).join('/');
        return diff
            .split(/\r?\n/)
            .map((line) => {
                if (line.startsWith('diff --git ')) return `diff --git a/${normalizedRel} b/${normalizedRel}`;
                if (line.startsWith('--- '))
                    return oldPath === '/dev/null' ? '--- /dev/null' : `--- a/${normalizedRel}`;
                if (line.startsWith('+++ '))
                    return newPath === '/dev/null' ? '+++ /dev/null' : `+++ b/${normalizedRel}`;
                return line;
            })
            .join('\n');
    }

    private buildSquashedSnapshotDiff(snap: Snapshot, materializedDir: string, workspaceRoot: string): string {
        const chunks: string[] = [];
        const touched = Array.from(snap.touchedFiles || []);
        for (const rel of touched) {
            const { absolutePath: oldAbs, relativePath } = this.containedPath(
                workspaceRoot,
                rel,
                'squashed snapshot source path'
            );
            const { absolutePath: newAbs } = this.containedPath(
                materializedDir,
                relativePath,
                'squashed snapshot materialized path'
            );
            const oldExists = fs.existsSync(oldAbs);
            const newExists = fs.existsSync(newAbs);
            if (!oldExists && !newExists) continue;
            const oldArg = oldExists ? oldAbs : '/dev/null';
            const newArg = newExists ? newAbs : '/dev/null';
            const diff = spawnSync('git', ['diff', '--no-ext-diff', '--no-index', '--binary', '--', oldArg, newArg], {
                cwd: workspaceRoot,
                stdio: 'pipe',
                encoding: 'utf8',
            });
            if (diff.status !== 0 && diff.status !== 1) {
                const output = `${diff.stdout || ''}${diff.stderr || ''}`.slice(-1000);
                throw new Error(`Failed to build squashed snapshot diff: ${output || `exit ${diff.status}`}`);
            }
            const text = String(diff.stdout || '');
            if (text.trim()) chunks.push(this.rewriteNoIndexDiffForWorkspace(text, relativePath, oldArg, newArg));
        }
        return this.normalizeUnifiedDiffForGitApply(chunks.join('\n'));
    }

    private async effectiveApplyDiffFile(
        snap: Snapshot,
        materializedDir: string,
        workspaceRoot: string,
        reverse: boolean
    ): Promise<string> {
        const overlayDiffFile = path.join(materializedDir, 'overlay.diff');
        if ((snap.diffs || []).length <= 1) return overlayDiffFile;
        const squashedDiffFile = path.join(materializedDir, 'squashed-overlay.diff');
        if (reverse && fs.existsSync(squashedDiffFile)) return squashedDiffFile;
        if (reverse && !fs.existsSync(squashedDiffFile)) return overlayDiffFile;
        const squashed = this.buildSquashedSnapshotDiff(snap, materializedDir, workspaceRoot);
        await fsp.writeFile(squashedDiffFile, squashed, 'utf8');
        return squashedDiffFile;
    }

    async applyToWorkingTree(
        snapshotId: string,
        {
            check = false,
            reverse = false,
            workspaceRoot: requestedWorkspaceRoot,
        }: { check?: boolean; reverse?: boolean; workspaceRoot?: string } = {}
    ): Promise<{
        ok: boolean;
        output: string;
        elapsedMs: number;
    }> {
        this.assertValidId(snapshotId);
        const start = Date.now();
        const snap = this.ensureSnapshot(snapshotId, { workspaceRoot: requestedWorkspaceRoot });
        const workspaceRoot = this.resolveWorkspaceBase(snap.workspaceRoot);
        const dir =
            (await this.ensureMaterialized(snapshotId, { allowCurrentMaterializedWithWorkspaceDrift: true })) ||
            workspaceRoot;
        const diffFile = await this.effectiveApplyDiffFile(snap, dir, workspaceRoot, reverse);
        let output = '';
        const outputWithReceiptStatus = (
            currentOutput: string,
            receiptStatus: { ok: boolean; message?: string }
        ): string =>
            receiptStatus.ok ? currentOutput : `${currentOutput}${currentOutput ? '\n' : ''}${receiptStatus.message}`;
        let applyCreatedDirs: string[] = [];
        let applyPreExistingDirs: string[] = [];
        if (
            !reverse &&
            snap?.baseFingerprint &&
            this.workspaceBaseFingerprint(snap.workspaceRoot) !== snap.baseFingerprint
        ) {
            const elapsedMs = Date.now() - start;
            const message = 'Workspace changed since snapshot creation before apply; create a fresh snapshot';
            const receiptStatus = this.recordLastApply(snapshotId, {
                ok: false,
                elapsedMs,
                outputTail: message,
                args: { check, reverse },
                at: Date.now(),
            });
            return { ok: false, output: outputWithReceiptStatus(message, receiptStatus), elapsedMs };
        }
        // Validate caller-controlled diff paths before invoking apply tools. Non-check apply
        // may need parent directories for newly added nested files; check/dry-run must not
        // create workspace directories before proving preview-only behavior.
        try {
            const diffText = await fsp.readFile(diffFile, 'utf8');
            const ensureDirs = this.collectApplyTargetDirs(diffText);
            if (!check && !reverse) {
                const dirState = this.collectApplyDirState(ensureDirs, workspaceRoot);
                applyCreatedDirs = dirState.missing;
                applyPreExistingDirs = dirState.existing;
                for (const rel of ensureDirs) {
                    if (!rel || rel === '.' || rel === '/') continue;
                    const { absolutePath } = this.containedPath(workspaceRoot, rel, 'apply_snapshot directory');
                    await fsp.mkdir(absolutePath, { recursive: true });
                }
            }
        } catch {
            const elapsedMs = Date.now() - start;
            const message = 'Invalid apply_snapshot patch paths or missing overlay diff';
            const receiptStatus = this.recordLastApply(snapshotId, {
                ok: false,
                elapsedMs,
                outputTail: message,
                args: { check, reverse },
                at: Date.now(),
            });
            return {
                ok: false,
                output: outputWithReceiptStatus(message, receiptStatus),
                elapsedMs,
            };
        }
        if (reverse && !check) {
            const reversePreflight = spawnSync('git', ['apply', '--check', '-R', '--whitespace=nowarn', diffFile], {
                stdio: 'pipe',
                cwd: workspaceRoot,
            });
            if (reversePreflight.status !== 0) {
                const elapsedMs = Date.now() - start;
                const message =
                    `${String(reversePreflight.stdout || '')}${String(reversePreflight.stderr || '')}` ||
                    'Reverse apply preflight failed';
                const receiptStatus = this.recordLastApply(snapshotId, {
                    ok: false,
                    elapsedMs,
                    outputTail: message.slice(-4000),
                    args: { check, reverse },
                    at: Date.now(),
                });
                return { ok: false, output: outputWithReceiptStatus(message, receiptStatus), elapsedMs };
            }
        }
        const argsGit = ['apply'];
        if (reverse) argsGit.push('-R');
        if (check) argsGit.push('--check');
        argsGit.push('--whitespace=nowarn', diffFile);
        const git = spawnSync('git', argsGit, { stdio: 'pipe', cwd: workspaceRoot });
        output += String(git.stdout || '') + String(git.stderr || '');
        const elapsed = Date.now() - start;
        if (git.status === 0) {
            if (!check && !reverse) {
                snap.applyCreatedDirs = applyCreatedDirs;
                snap.applyPreExistingDirs = applyPreExistingDirs;
            }
            if (!check && reverse) {
                await this.removeRecordedApplyDirs(snap.applyCreatedDirs, workspaceRoot).catch(() => undefined);
                await this.recreateRecordedApplyDirs(snap.applyPreExistingDirs, workspaceRoot).catch(() => undefined);
                snap.applyCreatedDirs = [];
                snap.applyPreExistingDirs = [];
            }
            const receiptStatus = this.recordLastApply(snapshotId, {
                ok: true,
                elapsedMs: elapsed,
                outputTail: output.slice(-4000),
                args: { check, reverse },
                at: Date.now(),
            });
            return {
                ok: true,
                output: outputWithReceiptStatus(output, receiptStatus),
                elapsedMs: elapsed,
            };
        }
        if (!check && !reverse)
            await this.removeRecordedApplyDirs(applyCreatedDirs, workspaceRoot).catch(() => undefined);
        const receiptStatus = this.recordLastApply(snapshotId, {
            ok: false,
            elapsedMs: Date.now() - start,
            outputTail: output.slice(-4000),
            args: { check, reverse },
            at: Date.now(),
        });
        return { ok: false, output: outputWithReceiptStatus(output, receiptStatus), elapsedMs: Date.now() - start };
    }

    getStatus(snapshotId: string, opts: { workspaceRoot?: string } = {}): any {
        this.assertValidId(snapshotId);
        const s = this.ensureSnapshot(snapshotId, opts);
        const touched = Array.from(s.touchedFiles || []);
        return {
            id: s.id,
            createdAt: s.createdAt,
            diffsCount: s.diffs.length,
            touchedFiles: touched,
            lastApply: s.lastApply || null,
        };
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const overlayStore = new OverlayStore();
