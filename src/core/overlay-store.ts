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

    private serializeSnapshot(snap: Snapshot): Record<string, unknown> {
        return {
            id: snap.id,
            createdAt: snap.createdAt,
            diffs: snap.diffs,
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
        const snap: Snapshot = { id, createdAt, diffs };
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

    createSnapshot(preferExisting = true): Snapshot {
        // Optionally reuse the most recent snapshot to avoid churn
        if (preferExisting) {
            this.loadAllSnapshotsFromDisk();
            const last = Array.from(this.snapshots.values()).sort((a, b) => b.createdAt - a.createdAt)[0];
            if (last) return last;
        }
        const id = randomUUID();
        const snap: Snapshot = { id, createdAt: Date.now(), diffs: [] };
        this.snapshots.set(id, snap);
        this.persistSnapshotSync(snap);
        // Best-effort cleanup after creating a snapshot
        void this.cleanup().catch(() => {});
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
    }

    private parseTouchedFilesFromPatch(diff: string): string[] {
        const files = new Set<string>();
        const lines = diff.split(/\r?\n/);
        for (const line of lines) {
            // apply_patch format
            let m = line.match(/^\*\*\*\s+(?:Update|Add|Delete) File:\s+(.+)$/);
            if (m) {
                files.add(m[1].trim());
                continue;
            }
            // git unified diff header
            m = line.match(/^\+\+\+\s+[ab]\/(.+)$/) || line.match(/^---\s+[ab]\/(.+)$/);
            if (m) {
                files.add(m[1].trim());
                continue;
            }
            // diff --git a/path b/path
            m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
            if (m) {
                files.add(m[1].trim());
                files.add(m[2].trim());
            }
        }
        // Filter obvious non-files
        return Array.from(files).filter((p) => p && !p.endsWith('/'));
    }

    stagePatch(snapshotId: string, diff: string, maxSizeBytes = 512 * 1024): { accepted: boolean; message?: string } {
        if (!diff || typeof diff !== 'string') return { accepted: false, message: 'Empty diff' };
        if (Buffer.byteLength(diff, 'utf8') > maxSizeBytes) {
            return { accepted: false, message: `Patch too large (> ${maxSizeBytes} bytes)` };
        }
        const snap = this.ensureSnapshot(snapshotId);
        snap.diffs.push(diff);
        try {
            const touched = this.parseTouchedFilesFromPatch(diff);
            if (touched.length) {
                if (!snap.touchedFiles) snap.touchedFiles = new Set<string>();
                for (const f of touched) snap.touchedFiles.add(f);
            }
        } catch {}
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
        const base = this.resolveWorkspaceBase();
        const snapsRoot = this.snapshotsRoot();
        const dir = path.join(snapsRoot, snapshotId);
        await fsp.mkdir(snapsRoot, { recursive: true }).catch(() => {});
        const materializedMarker = path.join(dir, '.materialized');
        const preferPartial = process.env.SNAPSHOT_PARTIAL === '1';
        const snap = this.snapshots.get(snapshotId) || this.loadSnapshotFromDisk(snapshotId);
        const desiredFingerprint = this.snapshotDiffFingerprint(snap);
        const currentFingerprint = fs.existsSync(materializedMarker) ? this.readMaterializedFingerprint(materializedMarker) : null;
        const isCurrent = currentFingerprint === desiredFingerprint;
        const touched = snap?.touchedFiles ? Array.from(snap.touchedFiles) : [];

        if (isCurrent) return dir;

        await this.logProgress(snapshotId, currentFingerprint ? 'materialize:refresh-start' : 'materialize:start');
        await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        await fsp.mkdir(dir, { recursive: true });

        if (preferPartial && touched.length > 0) {
            // Partial materialize: copy only touched files and essential configs
            await this.logProgress(snapshotId, `materialize:partial ${touched.length} files`);
            const essential = ['tsconfig.json', 'tsconfig.build.json', 'package.json'];
            const toCopy = [...new Set([...touched, ...essential])];
            for (const rel of toCopy) {
                try {
                    const src = path.join(base, rel);
                    const dst = path.join(dir, rel);
                    await fsp.mkdir(path.dirname(dst), { recursive: true }).catch(() => {});
                    if (fs.existsSync(src) && fs.statSync(src).isFile()) {
                        spawnSync('bash', ['-lc', `cp -a ${JSON.stringify(src)} ${JSON.stringify(dst)}`], {
                            stdio: 'pipe',
                        });
                    }
                } catch {}
            }
        } else {
            // Full copy: prefer rsync; fallback to tar or cp
            if (this.which('rsync')) {
                await this.logProgress(snapshotId, `materialize:rsync ${base} -> ${dir}`);
                spawnSync(
                    'bash',
                    [
                        '-lc',
                        `rsync -a --delete --exclude .git --exclude node_modules --exclude .ontology --exclude dist ${JSON.stringify(base)}/ ${dir}/`,
                    ],
                    { stdio: 'pipe' }
                );
            } else if (this.which('tar')) {
                await this.logProgress(snapshotId, `materialize:tar ${base} -> ${dir}`);
                const cmd = `tar -C ${JSON.stringify(base)} --exclude .git --exclude node_modules --exclude .ontology --exclude dist -cf - . | tar -C ${JSON.stringify(dir)} -xf -`;
                spawnSync('bash', ['-lc', cmd], { stdio: 'pipe' });
            } else {
                const entries = await fsp.readdir(base, { withFileTypes: true });
                for (const ent of entries) {
                    if (['.git', '.ontology', 'node_modules', 'dist'].includes(ent.name)) continue;
                    const src = path.join(base, ent.name);
                    const dest = path.join(dir, ent.name);
                    try {
                        spawnSync('bash', ['-lc', `cp -a ${JSON.stringify(src)} ${JSON.stringify(dest)}`], {
                            stdio: 'pipe',
                        });
                    } catch {}
                }
            }
        }

        if (snap?.diffs.length) {
            await this.logProgress(snapshotId, `apply:diffs ${snap.diffs.length}`);
            const diffFile = path.join(dir, 'overlay.diff');
            await fsp.writeFile(diffFile, snap.diffs.join('\n'), 'utf8');
            const diffText = await fsp.readFile(diffFile, 'utf8').catch(() => '');
            let ok = false;
            let output = '';

            if (this.which('git')) {
                const applied = spawnSync(
                    'bash',
                    [
                        '-lc',
                        `GIT_CEILING_DIRECTORIES=${JSON.stringify(snapsRoot)} git -C ${JSON.stringify(dir)} apply --whitespace=nowarn overlay.diff`,
                    ],
                    { stdio: 'pipe' }
                );
                ok = applied.status === 0;
                output += `${String(applied.stdout || '')}${String(applied.stderr || '')}`;
            }

            if (!ok && this.which('patch')) {
                const pLevel = /\ndiff --git a\//.test('\n' + diffText) ? 1 : 0;
                const patched = spawnSync('bash', ['-lc', `patch -p${pLevel} < overlay.diff`], { cwd: dir, stdio: 'pipe' });
                ok = patched.status === 0;
                output += `${String(patched.stdout || '')}${String(patched.stderr || '')}`;
            }

            if (!ok) {
                throw new Error(`Failed to materialize snapshot overlay: ${output.slice(-1000) || 'patch application failed'}`);
            }
            await this.logProgress(snapshotId, 'apply:done');
        }

        await this.writeMaterializedMarker(materializedMarker, snap);
        if (snap) this.persistSnapshotSync(snap);
        await this.logProgress(snapshotId, currentFingerprint ? 'materialize:refresh-done' : 'materialize:done');
        return dir;
    }

    async runChecks(
        snapshotId: string,
        commands: string[],
        timeoutSec = 120,
        opts: { onlyTouched?: boolean } = {}
    ): Promise<CheckRunResult> {
        this.assertValidId(snapshotId);
        const start = Date.now();
        // Materialize snapshot into .ontology/snapshots/<id>
        const cwd = (await this.ensureMaterialized(snapshotId)) || process.cwd();
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
                const child = useShell
                    ? spawn('bash', ['-lc', cmd], { stdio: ['ignore', 'pipe', 'pipe'], cwd })
                    : spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
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
        // Best-effort: ensure parent directories exist for files referenced in diff
        try {
            const diffText = await fsp.readFile(diffFile, 'utf8');
            const ensureDirs = new Set<string>();
            for (const line of diffText.split(/\r?\n/)) {
                let m = line.match(/^\+\+\+\s+b\/(.+)$/);
                if (m && m[1]) {
                    ensureDirs.add(path.dirname(m[1].trim()));
                }
                m = line.match(/^\*\*\*\s+Add File:\s+(.+)$/);
                if (m && m[1]) {
                    ensureDirs.add(path.dirname(m[1].trim()));
                }
            }
            for (const rel of ensureDirs) {
                if (!rel || rel === '.' || rel === '/') continue;
                const abs = path.resolve(process.cwd(), rel);
                try {
                    await fsp.mkdir(abs, { recursive: true });
                } catch {}
            }
        } catch {
            // ignore ensure-dir errors
        }
        const argsGit = [
            '-lc',
            `git apply ${reverse ? '-R ' : ''}${check ? '--check ' : ''}--whitespace=nowarn ${JSON.stringify(diffFile)}`,
        ];
        const git = spawnSync('bash', argsGit, { stdio: 'pipe', cwd: process.cwd() });
        output += String(git.stdout || '') + String(git.stderr || '');
        const elapsed = Date.now() - start;
        if (git.status === 0) {
            // record status
            try {
                const snap = this.ensureSnapshot(snapshotId);
                snap.lastApply = {
                    ok: true,
                    elapsedMs: elapsed,
                    outputTail: output.slice(-4000),
                    args: { check, reverse },
                    at: Date.now(),
                };
            } catch {}
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
            try {
                const snap = this.ensureSnapshot(snapshotId);
                snap.lastApply = {
                    ok,
                    elapsedMs: Date.now() - start,
                    outputTail: output.slice(-4000),
                    args: { check, reverse },
                    at: Date.now(),
                };
            } catch {}
            return { ok, output, elapsedMs: Date.now() - start };
        }
        try {
            const snap = this.ensureSnapshot(snapshotId);
            snap.lastApply = {
                ok: false,
                elapsedMs: Date.now() - start,
                outputTail: output.slice(-4000),
                args: { check, reverse },
                at: Date.now(),
            };
        } catch {}
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
