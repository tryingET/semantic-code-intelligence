import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

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
    touchedFiles?: Set<string>;
    lastApply?: {
        ok: boolean;
        elapsedMs: number;
        outputTail: string;
        args: { check: boolean; reverse: boolean };
        at: number;
    };
};

export class OverlayStore {
    private snapshots = new Map<string, Snapshot>();
    private materializeLocks = new Map<string, Promise<void>>();
    private wantProgress(): boolean {
        const env = process.env;
        return env.DOGFOOD_PROGRESS === '1' || env.PROGRESS_LOGS === '1';
    }
    private async logProgress(id: string, msg: string): Promise<void> {
        if (!this.wantProgress()) return;
        try {
            this.assertValidId(id);
            const snapsRoot = path.resolve('.ontology', 'snapshots');
            const dir = path.join(snapsRoot, id);
            await fsp.mkdir(dir, { recursive: true }).catch(() => {});
            const line = `[${new Date().toISOString()}] ${msg}\n`;
            await fsp.appendFile(path.join(dir, 'progress.log'), line, 'utf8');
        } catch {
            // ignore progress errors
        }
    }

    private snapshotsRoot(): string {
        return path.resolve('.ontology', 'snapshots');
    }

    private snapshotDir(id: string): string {
        this.assertValidId(id);
        return path.join(this.snapshotsRoot(), id);
    }

    private metadataPath(id: string): string {
        return path.join(this.snapshotDir(id), 'metadata.json');
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
        try {
            const raw = fs.readFileSync(markerPath, 'utf8');
            const parsed = JSON.parse(raw);
            return typeof parsed?.diffFingerprint === 'string' ? parsed.diffFingerprint : null;
        } catch {
            return null;
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

    private normalizePatchRelativePath(rawPath: string, inputLabel = 'patch path'): string | null {
        const raw = String(rawPath || '').trim();
        if (!raw || raw === '/dev/null') return null;
        if (raw.includes('\0')) throw new Error(`${inputLabel} must not contain NUL bytes`);
        if (raw.includes('\\')) throw new Error(`${inputLabel} must use POSIX-style relative paths`);
        if (path.posix.isAbsolute(raw)) throw new Error(`${inputLabel} must stay within the workspace`);
        const normalized = path.posix.normalize(raw);
        if (!normalized || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
            throw new Error(`${inputLabel} must stay within the workspace`);
        }
        return normalized;
    }

    private normalizeUnifiedDiffForGitApply(diff: string): string {
        const lines = diff.split(/\r?\n/);
        const out: string[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            out.push(line);
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

    private containedPath(root: string, relPath: string, inputLabel = 'path'): { absolutePath: string; relativePath: string } {
        const relativePath = this.normalizePatchRelativePath(relPath, inputLabel);
        if (!relativePath) throw new Error(`${inputLabel} must name a file inside the workspace`);
        const absoluteRoot = path.resolve(root);
        const absolutePath = path.resolve(absoluteRoot, relativePath);
        const relativeToRoot = path.relative(absoluteRoot, absolutePath);
        if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
            throw new Error(`${inputLabel} must stay within the workspace`);
        }
        return { absolutePath, relativePath: relativeToRoot.split(path.sep).join('/') };
    }

    private spawnChecked(command: string, errorLabel: string, cwd?: string): void {
        const result = spawnSync('bash', ['-lc', command], { stdio: 'pipe', cwd });
        if (result.status !== 0) {
            const output = `${String(result.stdout || '')}${String(result.stderr || '')}`.slice(-1000);
            throw new Error(`${errorLabel}: ${output || `exit ${result.status}`}`);
        }
    }

    private async withMaterializeLock<T>(snapshotId: string, action: () => Promise<T>): Promise<T> {
        const previous = this.materializeLocks.get(snapshotId) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => { release = resolve; });
        const chained = previous.catch(() => undefined).then(() => current);
        this.materializeLocks.set(snapshotId, chained);
        await previous.catch(() => undefined);
        let fileLockRelease: (() => Promise<void>) | null = null;
        try {
            fileLockRelease = await this.acquireMaterializeFileLock(snapshotId);
            return await action();
        } finally {
            await fileLockRelease?.().catch(() => undefined);
            release();
            if (this.materializeLocks.get(snapshotId) === chained) this.materializeLocks.delete(snapshotId);
        }
    }

    private async acquireMaterializeFileLock(snapshotId: string): Promise<() => Promise<void>> {
        const lockDir = path.join(this.snapshotsRoot(), `${snapshotId}.lock`);
        const deadline = Date.now() + 30_000;
        while (true) {
            try {
                await fsp.mkdir(lockDir, { recursive: false });
                await fsp.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), 'utf8');
                return async () => { await fsp.rm(lockDir, { recursive: true, force: true }); };
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

    private workspaceBaseFingerprint(): string {
        const root = this.resolveWorkspaceBase();
        const hash = createHash('sha256');
        hash.update(`root:${root}\0`);
        const addGit = (args: string[], label: string): string => {
            const result = spawnSync('git', args, { cwd: root, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
            hash.update(label);
            hash.update('\0');
            hash.update(result.status === 0 ? result.stdout : Buffer.from(`git-failed:${result.status}:${String(result.stderr || '')}`));
            hash.update('\0');
            return result.status === 0 ? result.stdout.toString('utf8') : '';
        };
        addGit(['rev-parse', 'HEAD'], 'head');
        addGit(['status', '--porcelain=v1', '-z'], 'status');
        addGit(['diff', '--binary'], 'diff');
        addGit(['diff', '--cached', '--binary'], 'cached-diff');
        const untracked = addGit(['ls-files', '--others', '--exclude-standard', '-z'], 'untracked-list')
            .split('\0')
            .filter(Boolean)
            .slice(0, 1000);
        for (const rel of untracked) {
            try {
                const { absolutePath, relativePath } = this.containedPath(root, rel, 'untracked file path');
                const stat = fs.statSync(absolutePath);
                if (!stat.isFile()) continue;
                hash.update(`untracked:${relativePath}:${stat.size}:`);
                if (stat.size <= 1024 * 1024) hash.update(fs.readFileSync(absolutePath));
                else hash.update(String(stat.mtimeMs));
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
            touchedFiles: snap.touchedFiles ? Array.from(snap.touchedFiles) : [],
            lastApply: snap.lastApply || null,
        };
    }

    private hydrateSnapshot(raw: any): Snapshot | null {
        const id = String(raw?.id || '').trim();
        if (!this.isValidSnapshotId(id)) return null;
        const createdAt = Number(raw?.createdAt || Date.now());
        const diffs = Array.isArray(raw?.diffs) ? raw.diffs.filter((d: any) => typeof d === 'string') : [];
        const touched = Array.isArray(raw?.touchedFiles) ? raw.touchedFiles.filter((f: any) => typeof f === 'string') : [];
        const baseFingerprint = typeof raw?.baseFingerprint === 'string' ? raw.baseFingerprint : undefined;
        const snap: Snapshot = { id, createdAt, diffs, baseFingerprint };
        if (touched.length) snap.touchedFiles = new Set(touched);
        if (raw?.lastApply && typeof raw.lastApply === 'object') snap.lastApply = raw.lastApply;
        return snap;
    }

    private persistSnapshotSync(snap: Snapshot): void {
        try {
            const dir = this.snapshotDir(snap.id);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.metadataPath(snap.id), JSON.stringify(this.serializeSnapshot(snap), null, 2), 'utf8');
        } catch {
            // Snapshot metadata is best-effort; in-memory behavior remains authoritative for current process.
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
    ): void {
        try {
            const snap = this.ensureSnapshot(snapshotId);
            snap.lastApply = receipt;
            this.persistSnapshotSync(snap);
        } catch {}
    }

    private loadSnapshotFromDisk(id: string): Snapshot | null {
        try {
            this.assertValidId(id);
            const raw = JSON.parse(fs.readFileSync(this.metadataPath(id), 'utf8'));
            const snap = this.hydrateSnapshot(raw);
            if (!snap) return null;
            this.snapshots.set(snap.id, snap);
            return snap;
        } catch {
            return null;
        }
    }

    private loadAllSnapshotsFromDisk(): void {
        try {
            const root = this.snapshotsRoot();
            if (!fs.existsSync(root)) return;
            for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
                if (!ent.isDirectory() || !this.isValidSnapshotId(ent.name) || this.snapshots.has(ent.name)) continue;
                this.loadSnapshotFromDisk(ent.name);
            }
        } catch {}
    }

    private isValidSnapshotId(id: string): boolean {
        return typeof id === 'string' && /^[0-9a-fA-F-]{8,}$/.test(id.trim());
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

    createSnapshot(preferExisting = true): Snapshot {
        const baseFingerprint = this.workspaceBaseFingerprint();
        // Optionally reuse the most recent clean snapshot only when it still matches the current workspace base.
        if (preferExisting) {
            this.loadAllSnapshotsFromDisk();
            const reusable = Array.from(this.snapshots.values())
                .filter((candidate) => this.isReusableBaseSnapshot(candidate, baseFingerprint))
                .sort((a, b) => b.createdAt - a.createdAt)[0];
            if (reusable) return reusable;
        }
        const id = randomUUID();
        const snap: Snapshot = { id, createdAt: Date.now(), diffs: [], baseFingerprint };
        this.snapshots.set(id, snap);
        this.persistSnapshotSync(snap);
        return snap;
    }

    ensureSnapshot(id?: string): Snapshot {
        if (id === undefined) {
            return this.createSnapshot(true);
        }
        const trimmed = String(id).trim();
        this.assertValidId(trimmed);
        const found = this.snapshots.get(trimmed) || this.loadSnapshotFromDisk(trimmed);
        if (!found) {
            throw new Error('Unknown snapshot id');
        }
        return found;
    }

    list(): Snapshot[] {
        this.loadAllSnapshotsFromDisk();
        return Array.from(this.snapshots.values()).sort((a, b) => b.createdAt - a.createdAt);
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

    async cleanup(maxKeep = 10, maxAgeMs = 3 * 24 * 60 * 60 * 1000): Promise<void> {
        const snaps = this.list();
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
        const snapsRoot = this.snapshotsRoot();
        for (const s of toDelete) {
            this.snapshots.delete(s.id);
            try {
                await fsp.rm(path.join(snapsRoot, s.id), { recursive: true, force: true });
            } catch {}
        }
        await this.cleanupTransientSnapshotWorkspaces(snapsRoot, now, maxAgeMs);
        await this.cleanupMaterializeLockWorkspaces(snapsRoot, now, maxAgeMs);
    }

    private parseTouchedFilesFromPatch(diff: string): string[] {
        const files = new Set<string>();
        const addPath = (value: string) => {
            const normalized = this.normalizePatchRelativePath(value, 'patch file path');
            if (normalized && !normalized.endsWith('/')) files.add(normalized);
        };
        const lines = diff.split(/\r?\n/);
        for (const line of lines) {
            // apply_patch format
            let m = line.match(/^\*\*\*\s+(?:Update|Add|Delete) File:\s+(.+)$/);
            if (m) {
                addPath(m[1]);
                continue;
            }
            // git unified diff header
            m = line.match(/^\+\+\+\s+[ab]\/(.+)$/) || line.match(/^---\s+[ab]\/(.+)$/);
            if (m) {
                addPath(m[1]);
                continue;
            }
            // diff --git a/path b/path
            m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            if (m) {
                addPath(m[1]);
                addPath(m[2]);
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
        const snap = this.ensureSnapshot(snapshotId);
        snap.diffs.push(normalizedDiff);
        if (touched.length) {
            if (!snap.touchedFiles) snap.touchedFiles = new Set<string>();
            for (const f of touched) snap.touchedFiles.add(f);
        }
        this.persistSnapshotSync(snap);
        return { accepted: true };
    }

    private which(cmd: string): string | null {
        const res = spawnSync('bash', ['-lc', `command -v ${cmd}`], { stdio: 'pipe' });
        return res.status === 0 ? String(res.stdout).trim() : null;
    }

    private resolveWorkspaceBase(): string {
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

    private async ensureMaterialized(snapshotId: string): Promise<string | null> {
        this.assertValidId(snapshotId);
        return this.withMaterializeLock(snapshotId, () => this.ensureMaterializedUnlocked(snapshotId));
    }

    private async ensureMaterializedUnlocked(snapshotId: string): Promise<string | null> {
        const base = this.resolveWorkspaceBase();
        const snapsRoot = this.snapshotsRoot();
        const dir = path.join(snapsRoot, snapshotId);
        await fsp.mkdir(snapsRoot, { recursive: true }).catch(() => {});
        const materializedMarker = path.join(dir, '.materialized');
        const preferPartial = process.env.SNAPSHOT_PARTIAL === '1';
        const snap = this.snapshots.get(snapshotId) || this.loadSnapshotFromDisk(snapshotId);
        const desiredFingerprint = this.snapshotDiffFingerprint(snap);
        const currentFingerprint = fs.existsSync(materializedMarker) ? this.readMaterializedFingerprint(materializedMarker) : null;
        const touched = snap?.touchedFiles ? Array.from(snap.touchedFiles) : [];

        if (currentFingerprint === desiredFingerprint) return dir;
        if (snap?.baseFingerprint && !currentFingerprint && this.workspaceBaseFingerprint() !== snap.baseFingerprint) {
            throw new Error('Workspace changed since snapshot creation before materialization; create a fresh snapshot');
        }

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
                        this.spawnChecked(`cp -a ${JSON.stringify(src)} ${JSON.stringify(dst)}`, 'Failed to copy snapshot file');
                    }
                }
            } else {
                // Full copy: prefer rsync; fallback to tar or cp
                if (this.which('rsync')) {
                    await this.logProgress(snapshotId, `materialize:rsync ${base} -> ${tempDir}`);
                    this.spawnChecked(
                        `rsync -a --delete --exclude .git --exclude node_modules --exclude .ontology --exclude dist ${JSON.stringify(base)}/ ${tempDir}/`,
                        'Failed to copy snapshot base with rsync'
                    );
                } else if (this.which('tar')) {
                    await this.logProgress(snapshotId, `materialize:tar ${base} -> ${tempDir}`);
                    const cmd = `tar -C ${JSON.stringify(base)} --exclude .git --exclude node_modules --exclude .ontology --exclude dist -cf - . | tar -C ${JSON.stringify(tempDir)} -xf -`;
                    this.spawnChecked(cmd, 'Failed to copy snapshot base with tar');
                } else {
                    const entries = await fsp.readdir(base, { withFileTypes: true });
                    for (const ent of entries) {
                        if (['.git', '.ontology', 'node_modules', 'dist'].includes(ent.name)) continue;
                        const src = path.join(base, ent.name);
                        const dest = path.join(tempDir, ent.name);
                        this.spawnChecked(`cp -a ${JSON.stringify(src)} ${JSON.stringify(dest)}`, 'Failed to copy snapshot base entry');
                    }
                }
            }

            if (snap?.diffs.length) {
                await this.logProgress(snapshotId, `apply:diffs ${snap.diffs.length}`);
                const overlayText = snap.diffs.join('\n');
                this.parseTouchedFilesFromPatch(overlayText);
                const diffFile = path.join(tempDir, 'overlay.diff');
                await fsp.writeFile(diffFile, overlayText, 'utf8');
                const diffText = await fsp.readFile(diffFile, 'utf8').catch(() => '');
                let ok = false;
                let output = '';

                if (this.which('git')) {
                    const applied = spawnSync(
                        'bash',
                        [
                            '-lc',
                            `GIT_CEILING_DIRECTORIES=${JSON.stringify(snapsRoot)} git -C ${JSON.stringify(tempDir)} apply --whitespace=nowarn overlay.diff`,
                        ],
                        { stdio: 'pipe' }
                    );
                    ok = applied.status === 0;
                    output += `${String(applied.stdout || '')}${String(applied.stderr || '')}`;
                }

                if (!ok && this.which('patch')) {
                    const pLevel = /\ndiff --git a\//.test('\n' + diffText) ? 1 : 0;
                    const patched = spawnSync('bash', ['-lc', `patch -p${pLevel} < overlay.diff`], { cwd: tempDir, stdio: 'pipe' });
                    ok = patched.status === 0;
                    output += `${String(patched.stdout || '')}${String(patched.stderr || '')}`;
                }

                if (!ok) {
                    throw new Error(`Failed to materialize snapshot overlay: ${output.slice(-1000) || 'patch application failed'}`);
                }
                await this.logProgress(snapshotId, 'apply:done');
            }

            await this.writeMaterializedMarker(path.join(tempDir, '.materialized'), snap);
            if (snap) await fsp.writeFile(path.join(tempDir, 'metadata.json'), JSON.stringify(this.serializeSnapshot(snap), null, 2), 'utf8');

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

    private async createCheckWorkspace(snapshotId: string, materializedDir: string): Promise<{ cwd: string; cleanup: () => Promise<void> }> {
        this.assertValidId(snapshotId);
        const snapsRoot = this.snapshotsRoot();
        const checkDir = path.join(snapsRoot, `.${snapshotId}.${process.pid}.${Date.now()}.${randomUUID()}.check`);
        await fsp.rm(checkDir, { recursive: true, force: true }).catch(() => {});
        await fsp.mkdir(checkDir, { recursive: true });
        try {
            if (this.which('rsync')) {
                this.spawnChecked(
                    `rsync -a --delete ${JSON.stringify(materializedDir)}/ ${JSON.stringify(checkDir)}/`,
                    'Failed to copy snapshot check workspace'
                );
            } else if (this.which('tar')) {
                this.spawnChecked(
                    `tar -C ${JSON.stringify(materializedDir)} -cf - . | tar -C ${JSON.stringify(checkDir)} -xf -`,
                    'Failed to copy snapshot check workspace'
                );
            } else {
                const entries = await fsp.readdir(materializedDir, { withFileTypes: true });
                for (const ent of entries) {
                    const src = path.join(materializedDir, ent.name);
                    const dest = path.join(checkDir, ent.name);
                    this.spawnChecked(`cp -a ${JSON.stringify(src)} ${JSON.stringify(dest)}`, 'Failed to copy snapshot check workspace entry');
                }
            }
            return { cwd: checkDir, cleanup: async () => { await fsp.rm(checkDir, { recursive: true, force: true }); } };
        } catch (error) {
            await fsp.rm(checkDir, { recursive: true, force: true }).catch(() => {});
            throw error;
        }
    }

    async runChecks(
        snapshotId: string,
        commands: string[],
        timeoutSec = 120,
        opts: { onlyTouched?: boolean } = {}
    ): Promise<CheckRunResult> {
        this.assertValidId(snapshotId);
        const start = Date.now();
        // Materialize snapshot into .ontology/snapshots/<id>, then run commands in a disposable copy.
        // Check commands are caller-controlled and may write files; they must not mutate the reusable
        // materialized snapshot cache used by later read/search/navigation calls.
        const materializedCwd = (await this.ensureMaterialized(snapshotId)) || process.cwd();
        const checkWorkspace = await this.createCheckWorkspace(snapshotId, materializedCwd);
        const cwd = checkWorkspace.cwd;
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

        // If running under partial materialization, ensure essential directories exist
        // for common commands like build/test which require source files or local scripts.
        try {
            const preferPartial = process.env.SNAPSHOT_PARTIAL === '1';
            const needsBuild = (commands || []).some((c) => /\b(build(:|\b)|bun\s+build|bun\s+run\s+build)/.test(c));
            const needsTest = (commands || []).some((c) => /\b(test(\b|:)|bun\s+test|just\s+test(\b|[-_]))/.test(c));
            const needsScripts = (commands || []).some((c) => /\bbun\s+run\s+|npm\s+run\s+|pnpm\s+run\s+/.test(c));
            if (preferPartial && (needsBuild || needsTest || needsScripts)) {
                const base = this.resolveWorkspaceBase();
                const ensureDirs = ['src', 'tests', 'scripts', 'bin'];
                for (const d of ensureDirs) {
                    const needThis =
                        d === 'src' ? needsBuild || needsTest : d === 'tests' ? needsTest : d === 'scripts' ? needsScripts : d === 'bin' ? needsTest : false;
                    if (!needThis) continue;

                    const srcDir = path.join(base, d);
                    const dstDir = path.join(cwd, d);
                    if (!fs.existsSync(srcDir)) continue;

                    await this.logProgress(snapshotId, `materialize:ensure-${d}`);

                    // Fill in missing files without clobbering already-copied (and patched) touched files.
                    if (this.which('rsync')) {
                        spawnSync(
                            'bash',
                            ['-lc', `mkdir -p ${JSON.stringify(dstDir)} && rsync -a --ignore-existing ${JSON.stringify(srcDir)}/ ${JSON.stringify(dstDir)}/`],
                            { stdio: 'pipe' }
                        );
                    } else if (this.which('tar')) {
                        // tar-based copy is more reliable than cp -n for deep trees and preserves existing (patched) files.
                        spawnSync(
                            'bash',
                            [
                                '-lc',
                                `mkdir -p ${JSON.stringify(dstDir)} && tar -C ${JSON.stringify(srcDir)} -cf - . | tar -C ${JSON.stringify(dstDir)} -xf - --skip-old-files`,
                            ],
                            { stdio: 'pipe' }
                        );
                    } else {
                        spawnSync(
                            'bash',
                            [
                                '-lc',
                                `mkdir -p ${JSON.stringify(dstDir)} && cp -a -n ${JSON.stringify(srcDir)}/. ${JSON.stringify(dstDir)}/`,
                            ],
                            { stdio: 'pipe' }
                        );
                    }
                }
            }
        } catch {
            // best-effort; continue even if ensure-src fails
        }
        // Build command list
        let cmdList = commands && commands.length ? [...commands] : ['bun run typecheck', 'bun run build'];
        const onlyTouched = !!opts.onlyTouched || (process.env.FAST_STDIO_CHECKS || '').toLowerCase() === 'touched';
        try {
            const snap = this.ensureSnapshot(snapshotId);
            const touched = Array.from(snap.touchedFiles || []);
            const tsFiles = touched.filter((f) => /\.(ts|tsx)$/.test(f));
            if (onlyTouched && touched.length > 0 && tsFiles.length > 0 && this.which('bunx')) {
                // Prefer a quick tsgo typecheck against touched TS files
                const limited = tsFiles
                    .slice(0, 50) // cap to avoid overly long cmdlines
                    .map((f) => JSON.stringify(f))
                    .join(' ');
                const quick = `bunx tsgo --noEmit --pretty false ${limited}`;
                // Prepend quick check if no explicit commands were provided
                if (!(commands && commands.length)) {
                    cmdList = [quick];
                } else {
                    cmdList.unshift(quick);
                }
            }
        } catch {}
        // Enforce a global safety clamp for per-command timeout seconds across all adapters.
        // Rationale: values >600s lead to excessively long CI/dev runs and can hang pipelines.
        // HTTP already clamps to 600; this keeps MCP/CLI parity and centralizes the guard.
        const perCommandTimeoutSec = Math.max(1, Math.min(600, Math.floor(Number(timeoutSec) || 120)));
        const commandResults: CheckCommandReceipt[] = [];

        for (const rawCmd of cmdList) {
            const cmd = String(rawCmd);
            await this.logProgress(snapshotId, `run:${cmd}:start`);
            appendOutput(`$ ${cmd}\n`);
            const [bin, ...args] = cmd.split(' ');
            const commandStart = Date.now();
            const result = await new Promise<{ ok: boolean; exitCode: number | null; timedOut: boolean }>((resolve) => {
                const useShell = this.which('bash');
                const env = { ...process.env, GIT_CEILING_DIRECTORIES: this.snapshotsRoot() };
                const child = useShell
                    ? spawn('bash', ['-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'], cwd, env })
                    : spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env });
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
                        child.kill('SIGKILL');
                    } catch {}
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
                    finish({ ok: code === 0, exitCode: typeof code === 'number' ? code : null, timedOut: false });
                });
            });
            commandResults.push({ command: cmd, ok: result.ok, elapsedMs: Date.now() - commandStart, exitCode: result.exitCode, timedOut: result.timedOut });
            if (!result.ok) {
                return { ok: false, output: output.join(''), elapsedMs: Date.now() - start, commands: commandResults };
            }
        }
        await this.logProgress(snapshotId, 'checks:done');
        return { ok: true, output: output.join(''), elapsedMs: Date.now() - start, commands: commandResults };
        } finally {
            await checkWorkspace.cleanup().catch(() => undefined);
        }
    }

    async applyToWorkingTree(
        snapshotId: string,
        { check = false, reverse = false }: { check?: boolean; reverse?: boolean } = {}
    ): Promise<{
        ok: boolean;
        output: string;
        elapsedMs: number;
    }> {
        this.assertValidId(snapshotId);
        const start = Date.now();
        const dir = (await this.ensureMaterialized(snapshotId)) || process.cwd();
        const diffFile = path.join(dir, 'overlay.diff');
        let output = '';
        // Best-effort: ensure parent directories exist for contained files referenced in diff.
        // Diff-derived paths are caller-controlled, so validate containment before mkdir.
        try {
            const diffText = await fsp.readFile(diffFile, 'utf8');
            const ensureDirs = new Set<string>();
            for (const line of diffText.split(/\r?\n/)) {
                let m = line.match(/^\+\+\+\s+b\/(.+)$/);
                if (m && m[1]) {
                    const normalized = this.normalizePatchRelativePath(m[1], 'apply_snapshot patch path');
                    if (normalized) ensureDirs.add(path.posix.dirname(normalized));
                }
                m = line.match(/^\*\*\*\s+Add File:\s+(.+)$/);
                if (m && m[1]) {
                    const normalized = this.normalizePatchRelativePath(m[1], 'apply_snapshot patch path');
                    if (normalized) ensureDirs.add(path.posix.dirname(normalized));
                }
            }
            for (const rel of ensureDirs) {
                if (!rel || rel === '.' || rel === '/') continue;
                const { absolutePath } = this.containedPath(process.cwd(), rel, 'apply_snapshot directory');
                await fsp.mkdir(absolutePath, { recursive: true });
            }
        } catch (error) {
            return {
                ok: false,
                output: `Invalid apply_snapshot patch paths: ${error instanceof Error ? error.message : String(error)}`,
                elapsedMs: Date.now() - start,
            };
        }
        const argsGit = [
            '-lc',
            `git apply ${reverse ? '-R ' : ''}${check ? '--check ' : ''}--whitespace=nowarn ${JSON.stringify(diffFile)}`,
        ];
        const git = spawnSync('bash', argsGit, { stdio: 'pipe', cwd: process.cwd() });
        output += String(git.stdout || '') + String(git.stderr || '');
        const elapsed = Date.now() - start;
        if (git.status === 0) {
            this.recordLastApply(snapshotId, {
                ok: true,
                elapsedMs: elapsed,
                outputTail: output.slice(-4000),
                args: { check, reverse },
                at: Date.now(),
            });
            return { ok: true, output, elapsedMs: elapsed };
        }
        if (this.which('patch')) {
            const diffText = await fsp.readFile(diffFile, 'utf8').catch(() => '');
            const pLevel = /\ndiff --git a\//.test('\n' + diffText) ? 1 : 0;
            const dry = check ? `--dry-run ` : '';
            const rev = reverse ? `-R ` : '';
            const patchArgs = ['-lc', `patch ${dry}${rev}-p${pLevel} < ${JSON.stringify(diffFile)}`];
            const p = spawnSync('bash', patchArgs, { stdio: 'pipe', cwd: process.cwd() });
            output += String(p.stdout || '') + String(p.stderr || '');
            const ok = p.status === 0;
            this.recordLastApply(snapshotId, {
                ok,
                elapsedMs: Date.now() - start,
                outputTail: output.slice(-4000),
                args: { check, reverse },
                at: Date.now(),
            });
            return { ok, output, elapsedMs: Date.now() - start };
        }
        this.recordLastApply(snapshotId, {
            ok: false,
            elapsedMs: Date.now() - start,
            outputTail: output.slice(-4000),
            args: { check, reverse },
            at: Date.now(),
        });
        return { ok: false, output, elapsedMs: Date.now() - start };
    }

    getStatus(snapshotId: string): any {
        this.assertValidId(snapshotId);
        const s = this.ensureSnapshot(snapshotId);
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

export const overlayStore = new OverlayStore();
