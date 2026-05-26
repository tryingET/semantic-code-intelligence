import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CoreError } from '../errors.js';
import { overlayStore } from '../overlay-store.js';
import { openWorkspaceFileForRead, resolveWorkspacePath } from '../workspace-path.js';
import { snapshotArtifactLinks, type SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

export function findAstGrepBinary(): string | null {
    const candidates = ['ast-grep', 'sg'];
    for (const candidate of candidates) {
        const found = spawnSync('bash', ['-lc', `command -v ${candidate}`], { stdio: 'pipe', encoding: 'utf8' });
        if (found.status !== 0) continue;
        const bin = String(found.stdout || '').trim();
        if (!bin) continue;
        const version = spawnSync(bin, ['--version'], { stdio: 'pipe', encoding: 'utf8' });
        const text = `${version.stdout || ''}${version.stderr || ''}`.trim().toLowerCase();
        if (candidate === 'ast-grep' || text.includes('ast-grep')) return bin;
    }
    return null;
}

export async function normalizeStructuralPaths(pathsArg: any, workspaceRoot: string): Promise<string[]> {
    const rawPaths = Array.isArray(pathsArg) && pathsArg.length > 0 ? pathsArg : ['.'];
    const out: string[] = [];
    for (const raw of rawPaths) {
        const requested = String(raw || '').trim();
        if (!requested) continue;
        const resolved = await resolveWorkspacePath(requested, {
            workspaceRoot,
            inputLabel: 'structural path',
            allowRoot: true,
        });
        out.push(resolved.relativePath === '.' ? '.' : resolved.relativePath);
    }
    return out.length ? out : ['.'];
}

export async function runStructuralProcess(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; maxBuffer: number }
): Promise<{ status: number | null; stdout: string; stderr: string; timedOut: boolean; outputExceeded: boolean }> {
    return await new Promise((resolve) => {
        const proc = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let outputExceeded = false;
        const finish = (status: number | null, timedOut: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ status, stdout, stderr, timedOut, outputExceeded });
        };
        const append = (kind: 'stdout' | 'stderr', chunk: unknown) => {
            const next = kind === 'stdout' ? stdout + String(chunk) : stderr + String(chunk);
            if (Buffer.byteLength(next, 'utf8') > options.maxBuffer) {
                outputExceeded = true;
                stderr += `\nprocess output exceeded ${options.maxBuffer} bytes`;
                proc.kill('SIGTERM');
                finish(null, false);
                return;
            }
            if (kind === 'stdout') stdout = next;
            else stderr = next;
        };
        const timer = setTimeout(() => {
            stderr += `\nprocess timed out after ${options.timeoutMs}ms`;
            proc.kill('SIGTERM');
            finish(null, true);
        }, options.timeoutMs);
        proc.stdout?.on('data', (chunk) => append('stdout', chunk));
        proc.stderr?.on('data', (chunk) => append('stderr', chunk));
        proc.on('error', (error) => {
            stderr += error instanceof Error ? error.message : String(error);
            finish(null, false);
        });
        proc.on('close', (code) => finish(code, false));
    });
}

export function structuralProcessErrorPayload(
    proc: { stderr: string; timedOut: boolean; outputExceeded: boolean },
    command: string
) {
    const stderr = String(proc.stderr || '').trim();
    if (proc.timedOut) {
        return { ok: false, code: 'timeout', message: stderr || 'ast-grep timed out', command };
    }
    if (proc.outputExceeded) {
        return { ok: false, code: 'too_much_output', message: stderr || 'ast-grep output exceeded buffer limit', command };
    }
    const lower = stderr.toLowerCase();
    const code = lower.includes('pattern') || lower.includes('parse') || lower.includes('invalid') ? 'bad_ast_grep_pattern' : 'ast_grep_failed';
    return { ok: false, code, message: stderr.slice(0, 4000), command };
}

export function summarizeStructuralDiff(diff: string) {
    const files = new Map<string, { added: number; removed: number }>();
    let current = '';
    for (const line of diff.split(/\r?\n/)) {
        const file = /^diff --git a\/(.+?) b\//.exec(line)?.[1];
        if (file) {
            current = file;
            files.set(current, { added: 0, removed: 0 });
            continue;
        }
        if (!current || line.startsWith('+++') || line.startsWith('---')) continue;
        const item = files.get(current);
        if (!item) continue;
        if (line.startsWith('+')) item.added += 1;
        if (line.startsWith('-')) item.removed += 1;
    }
    return Array.from(files.entries()).map(([file, counts]) => ({ file, ...counts }));
}

export function parseAstGrepJsonLines(stdout: string): any[] {
    const trimmed = String(stdout || '').trim();
    if (!trimmed) return [];
    const parsed: any[] = [];
    try {
        const value = JSON.parse(trimmed);
        return Array.isArray(value) ? value : [value];
    } catch {}
    for (const line of trimmed.split(/\r?\n/)) {
        const item = line.trim();
        if (!item) continue;
        try {
            parsed.push(JSON.parse(item));
        } catch {}
    }
    return parsed;
}

export function applyStructuralReplacements(
    text: string,
    replacements: Array<{ start: number; end: number; replacement: string }>
): string {
    const original = Buffer.from(text, 'utf8');
    const ordered = [...replacements].sort((a, b) => b.start - a.start);
    let current = original;
    for (const edit of ordered) {
        const start = Math.max(0, Math.min(current.length, edit.start));
        const end = Math.max(start, Math.min(current.length, edit.end));
        current = Buffer.concat([current.subarray(0, start), Buffer.from(edit.replacement, 'utf8'), current.subarray(end)]);
    }
    return current.toString('utf8');
}

export class StructuralWorkflowService {
    constructor(private readonly options: { workspaceRoot: () => string }) {}

    get workspaceRoot(): string {
        return this.options.workspaceRoot();
    }

    async structuralSearch(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const language = String(args?.language || '').trim();
        const pattern = String(args?.pattern || '').trim();
        if (!language || !pattern) {
            return { text: 'language and pattern required', isError: true };
        }
        const bin = findAstGrepBinary();
        if (!bin) {
            return { payload: { ok: false, code: 'ast_grep_unavailable', message: 'ast-grep binary not found on PATH' }, isError: true };
        }
        const paths = await normalizeStructuralPaths(args?.paths, this.workspaceRoot);
        const maxResults = Math.max(1, Math.min(1000, Number(args?.maxResults || 50)));
        const timeoutMs = Math.max(1_000, Math.min(120_000, Number(args?.timeoutMs || 30_000)));
        const maxBuffer = Math.max(64 * 1024, Math.min(32 * 1024 * 1024, Number(args?.maxBuffer || 8 * 1024 * 1024)));
        const proc = await runStructuralProcess(bin, ['run', '--pattern', pattern, '--lang', language, '--json=stream', ...paths], {
            cwd: this.workspaceRoot,
            maxBuffer,
            timeoutMs,
        });
        if (proc.status !== 0 && (String(proc.stderr || '').trim() || proc.timedOut || proc.outputExceeded)) {
            return { payload: structuralProcessErrorPayload(proc, 'ast-grep run'), isError: true };
        }
        const allMatches = parseAstGrepJsonLines(String(proc.stdout || ''));
        const matches = allMatches.slice(0, maxResults).map((m: any) => ({
            file: m.file,
            range: m.range,
            snippet: String(m.text || m.lines || '').slice(0, 1000),
            language: m.language || language,
        }));
        return {
            payload: {
                workflow: 'structural_search',
                ok: true,
                backend: 'ast-grep',
                language,
                pattern,
                paths,
                limits: { maxResults, timeoutMs, maxBuffer },
                count: matches.length,
                capped: allMatches.length > matches.length,
                matches,
            },
            isError: false,
        };
    }

    async buildStructuralDiff(matches: any[]): Promise<{ diff: string; files: string[]; replacementCount: number }> {
        const workspaceRoot = this.workspaceRoot;
        const byFile = new Map<string, Array<{ start: number; end: number; replacement: string }>>();
        for (const match of matches) {
            const rel = String(match?.file || '').trim();
            const replacement = typeof match?.replacement === 'string' ? match.replacement : undefined;
            const start = Number(match?.replacementOffsets?.start ?? match?.range?.byteOffset?.start);
            const end = Number(match?.replacementOffsets?.end ?? match?.range?.byteOffset?.end);
            if (!rel || replacement === undefined || !Number.isFinite(start) || !Number.isFinite(end)) continue;
            const abs = path.resolve(workspaceRoot, rel);
            const normalizedRel = path.relative(workspaceRoot, abs);
            if (!normalizedRel || normalizedRel.startsWith('..') || path.isAbsolute(normalizedRel)) continue;
            const edits = byFile.get(normalizedRel) || [];
            edits.push({ start, end, replacement });
            byFile.set(normalizedRel, edits);
        }
        if (byFile.size === 0) return { diff: '', files: [], replacementCount: 0 };

        const tmpRoot = await fs.mkdtemp(path.join('/tmp', 'sci-structural-'));
        try {
            const diffParts: string[] = [];
            let replacementCount = 0;
            for (const [rel, edits] of byFile.entries()) {
                const ordered = [...edits].sort((a, b) => a.start - b.start);
                for (let i = 1; i < ordered.length; i++) {
                    if (ordered[i].start < ordered[i - 1].end) {
                        throw new CoreError('InvalidParams', 'ast-grep produced overlapping structural replacements', { file: rel });
                    }
                }
                const opened = await openWorkspaceFileForRead(rel, {
                    workspaceRoot,
                    inputLabel: 'structural match file',
                });
                let original = '';
                try {
                    original = await opened.handle.readFile('utf8');
                } finally {
                    await opened.handle.close().catch(() => undefined);
                }
                const modified = applyStructuralReplacements(original, edits);
                if (modified === original) continue;
                replacementCount += edits.length;
                const origPath = path.join(tmpRoot, 'orig', rel);
                const modPath = path.join(tmpRoot, 'mod', rel);
                await fs.mkdir(path.dirname(origPath), { recursive: true });
                await fs.mkdir(path.dirname(modPath), { recursive: true });
                await fs.writeFile(origPath, original, 'utf8');
                await fs.writeFile(modPath, modified, 'utf8');
                const proc = spawnSync('diff', ['-u', '--label', `a/${rel}`, '--label', `b/${rel}`, origPath, modPath], {
                    stdio: 'pipe',
                    encoding: 'utf8',
                    maxBuffer: 4 * 1024 * 1024,
                    timeout: 10_000,
                });
                const body = String(proc.stdout || '');
                if (body.trim()) diffParts.push(`diff --git a/${rel} b/${rel}\n${body}`);
            }
            return { diff: diffParts.join('\n'), files: Array.from(byFile.keys()), replacementCount };
        } finally {
            await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
        }
    }

    async structuralPatchChecks(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const language = String(args?.language || '').trim();
        const pattern = String(args?.pattern || '').trim();
        const rewrite = String(args?.rewrite ?? '');
        if (!language || !pattern || !rewrite) {
            return { text: 'language, pattern, and rewrite required', isError: true };
        }
        const bin = findAstGrepBinary();
        if (!bin) {
            return { payload: { ok: false, code: 'ast_grep_unavailable', message: 'ast-grep binary not found on PATH' }, isError: true };
        }
        const paths = await normalizeStructuralPaths(args?.paths, this.workspaceRoot);
        const maxResults = Math.max(1, Math.min(2000, Number(args?.maxResults || 200)));
        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
        const timeoutMs = Math.max(1_000, Math.min(120_000, Number(args?.timeoutMs || 30_000)));
        const maxBuffer = Math.max(64 * 1024, Math.min(32 * 1024 * 1024, Number(args?.maxBuffer || 16 * 1024 * 1024)));
        const proc = await runStructuralProcess(
            bin,
            ['run', '--pattern', pattern, '--rewrite', rewrite, '--lang', language, '--json=stream', ...paths],
            { cwd: this.workspaceRoot, maxBuffer, timeoutMs }
        );
        if (proc.status !== 0 && (String(proc.stderr || '').trim() || proc.timedOut || proc.outputExceeded)) {
            return { payload: structuralProcessErrorPayload(proc, 'ast-grep run --rewrite'), isError: true };
        }
        const allMatches = parseAstGrepJsonLines(String(proc.stdout || ''));
        const matches = allMatches.slice(0, maxResults);
        const built = await this.buildStructuralDiff(matches);
        if (!built.diff.trim()) {
            return {
                payload: {
                    workflow: 'structural_patch_checks',
                    ok: true,
                    backend: 'ast-grep',
                    language,
                    pattern,
                    rewrite,
                    paths,
                    limits: { maxResults, timeoutMs, maxBuffer },
                    matches: allMatches.length,
                    capped: allMatches.length > matches.length,
                    patch: { files: [], replacementCount: 0, diffBytes: 0, summary: [] },
                    snapshot: null,
                    snapshotArtifacts: null,
                    checks: null,
                    applied: false,
                    applyResult: null,
                    next_actions: ['No structural replacements were generated; adjust pattern/rewrite or paths'],
                },
                isError: false,
            };
        }

        const snap = overlayStore.createSnapshot(false, { workspaceRoot: this.workspaceRoot });
        const stage = overlayStore.stagePatch(snap.id, built.diff);
        if (!stage.accepted) {
            return { payload: { ok: false, matches: allMatches.length, snapshot: snap.id, stage, applied: false }, isError: true };
        }
        const checks = await overlayStore.runChecks(snap.id, commands, timeoutSec, { workspaceRoot: this.workspaceRoot });
        let applied = false;
        let applyResult: any = null;
        if (args?.apply === true) {
            if (process.env.ALLOW_SNAPSHOT_APPLY === '1' && checks.ok) {
                applyResult = await overlayStore.applyToWorkingTree(snap.id, { check: false, workspaceRoot: this.workspaceRoot });
                applied = !!applyResult?.ok;
            } else {
                applyResult = {
                    ok: false,
                    message: process.env.ALLOW_SNAPSHOT_APPLY === '1' ? 'checks_failed' : 'ALLOW_SNAPSHOT_APPLY=1 required',
                };
            }
        }
        const ok = !!checks.ok && (args?.apply === true ? applied : true);
        const snapshotArtifacts = snapshotArtifactLinks(snap.id);
        return {
            payload: {
                workflow: 'structural_patch_checks',
                ok,
                backend: 'ast-grep',
                language,
                pattern,
                rewrite,
                paths,
                limits: { maxResults, timeoutMs, maxBuffer, timeoutSec },
                matches: allMatches.length,
                capped: allMatches.length > matches.length,
                patch: {
                    files: built.files,
                    replacementCount: built.replacementCount,
                    diffBytes: Buffer.byteLength(built.diff, 'utf8'),
                    summary: summarizeStructuralDiff(built.diff),
                    diffSummary: built.diff.split(/\r?\n/).slice(0, 80).join('\n'),
                },
                snapshot: snap.id,
                snapshotArtifacts,
                links: Object.values(snapshotArtifacts),
                stage,
                checks: {
                    commands: Array.isArray(checks.commands) ? checks.commands : [],
                    ok: !!checks.ok,
                    elapsedMs: checks.elapsedMs,
                    output: String(checks.output || '').slice(-4000),
                },
                applied,
                applyResult,
                next_actions: applied
                    ? ['Review working tree diff and commit if appropriate']
                    : [
                          `Open snapshot diff: ${snapshotArtifacts.overlayDiff}`,
                          `Open snapshot status: ${snapshotArtifacts.status}`,
                          args?.apply === true && process.env.ALLOW_SNAPSHOT_APPLY !== '1'
                              ? 'Set ALLOW_SNAPSHOT_APPLY=1 only when intentionally applying'
                              : 'Apply separately only after review',
                      ],
            },
            isError: false,
        };
    }
}
