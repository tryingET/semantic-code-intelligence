import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

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
            const last = Array.from(this.snapshots.values()).sort((a, b) => b.createdAt - a.createdAt)[0];
            if (last) return last;
        }
        const id = randomUUID();
        const snap: Snapshot = { id, createdAt: Date.now(), diffs: [] };
        this.snapshots.set(id, snap);
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
        const found = this.snapshots.get(trimmed);
        if (!found) {
            throw new Error('Unknown snapshot id');
        }
        return found;
    }

    list(): Snapshot[] {
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
        const snapsRoot = path.resolve('.ontology', 'snapshots');
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
        // Respect workspace root if provided to avoid copying entire repo for snapshots
        const base = this.resolveWorkspaceBase();
        const snapsRoot = path.resolve('.ontology', 'snapshots');
        const dir = path.join(snapsRoot, snapshotId);
        await fsp.mkdir(snapsRoot, { recursive: true }).catch(() => {});
        const exists = fs.existsSync(dir);
        const preferPartial = process.env.SNAPSHOT_PARTIAL === '1';
        const snap = this.snapshots.get(snapshotId);
        const touched = snap?.touchedFiles ? Array.from(snap.touchedFiles) : [];
        if (!exists) {
            await this.logProgress(snapshotId, 'materialize:start');
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
            await this.logProgress(snapshotId, 'materialize:done');
        }
        // Apply staged diffs if any
        if (!snap) return dir;
        if (snap.diffs.length > 0) {
            await this.logProgress(snapshotId, `apply:diffs ${snap.diffs.length}`);
            const diffFile = path.join(dir, 'overlay.diff');
            await fsp.writeFile(diffFile, snap.diffs.join('\n'), 'utf8');
            if (this.which('git')) {
                const applied = spawnSync(
                    'bash',
                    ['-lc', `git -C ${JSON.stringify(dir)} apply --whitespace=nowarn overlay.diff`],
                    { stdio: 'pipe' }
                );
                if (applied.status !== 0 && this.which('patch')) {
                    // Choose -p level based on diff header (a/ b/ prefixes -> -p1)
                    const diffText = await fsp.readFile(diffFile, 'utf8').catch(() => '');
                    const pLevel = /\ndiff --git a\//.test('\n' + diffText) ? 1 : 0;
                    spawnSync('bash', ['-lc', `patch -p${pLevel} < overlay.diff`], { cwd: dir, stdio: 'pipe' });
                }
            } else if (this.which('patch')) {
                const diffText = await fsp.readFile(diffFile, 'utf8').catch(() => '');
                const pLevel = /\ndiff --git a\//.test('\n' + diffText) ? 1 : 0;
                spawnSync('bash', ['-lc', `patch -p${pLevel} < overlay.diff`], { cwd: dir, stdio: 'pipe' });
            }
            await this.logProgress(snapshotId, 'apply:done');
        }
        return dir;
    }

    async runChecks(
        snapshotId: string,
        commands: string[],
        timeoutSec = 120,
        opts: { onlyTouched?: boolean } = {}
    ): Promise<{ ok: boolean; output: string; elapsedMs: number }> {
        this.assertValidId(snapshotId);
        const start = Date.now();
        // Materialize snapshot into .ontology/snapshots/<id>
        const cwd = (await this.ensureMaterialized(snapshotId)) || process.cwd();
        const output: string[] = [];

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

        for (const cmd of cmdList) {
            await this.logProgress(snapshotId, `run:${cmd}:start`);
            output.push(`$ ${cmd}\n`);
            const [bin, ...args] = cmd.split(' ');
            const ok = await new Promise<boolean>((resolve) => {
                const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });
                child.stdout.on('data', (d) => output.push(String(d)));
                child.stderr.on('data', (d) => output.push(String(d)));
                const timer = setTimeout(() => {
                    try {
                        child.kill('SIGKILL');
                    } catch {}
                    void this.logProgress(snapshotId, `run:${cmd}:timeout`);
                    resolve(false);
                }, perCommandTimeoutSec * 1000);
                child.on('close', (code) => {
                    clearTimeout(timer);
                    void this.logProgress(snapshotId, `run:${cmd}:done code=${code}`);
                    resolve(code === 0);
                });
            });
            if (!ok) {
                return { ok: false, output: output.join(''), elapsedMs: Date.now() - start };
            }
        }
        await this.logProgress(snapshotId, 'checks:done');
        return { ok: true, output: output.join(''), elapsedMs: Date.now() - start };
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
