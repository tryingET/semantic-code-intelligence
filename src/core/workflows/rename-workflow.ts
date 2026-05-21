import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../overlay-store.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type TextEdit = {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
};

export interface RenameWorkflowServiceDeps {
    workspaceRoot: () => string;
    pickOntologySeedFile?: (symbol: string) => Promise<string | undefined | null>;
    planRename: (args: { oldName: string; newName: string; file?: string }) => Promise<any>;
}

export class RenameWorkflowService {
    constructor(private readonly deps: RenameWorkflowServiceDeps) {}

    async safeRename(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const oldName = String(args?.oldName || '').trim();
        const newName = String(args?.newName || '').trim();
        if (!oldName || !newName) {
            return { text: 'oldName and newName required', isError: true };
        }

        let file = typeof args?.file === 'string' ? args.file : undefined;
        if (!file && this.deps.pickOntologySeedFile) {
            file = (await this.deps.pickOntologySeedFile(oldName)) || undefined;
        }

        const commands = Array.isArray(args?.commands) ? (args.commands as string[]) : ['bun run typecheck'];
        const timeoutSec = typeof args?.timeoutSec === 'number' ? args.timeoutSec : 240;
        const runChecksFlag: boolean = args?.runChecks !== false;

        const plan = await this.deps.planRename({ oldName, newName, file });
        const changes = plan?.changes || {};
        const files = Object.keys(changes);
        if (!files.length) {
            return { payload: { ok: false, reason: 'no_changes', message: 'Rename produced no changes' }, isError: false };
        }

        const root = this.deps.workspaceRoot();
        const snap = overlayStore.createSnapshot(true, { workspaceRoot: root });
        const tmpRootBase = runChecksFlag
            ? (await (overlayStore as any).ensureMaterialized?.(snap.id, { workspaceRoot: root })) || ''
            : path.resolve(root, '.ontology', 'tmp-diffs');
        if (!tmpRootBase) {
            return {
                payload: { ok: false, reason: 'snapshot_failed', message: 'Failed to prepare snapshot' },
                isError: true,
            };
        }

        const tmpRoot = path.join(tmpRootBase, '.mcp-work');
        await fs.mkdir(tmpRoot, { recursive: true }).catch(() => {});

        const diffParts: string[] = [];
        for (const uri of files) {
            const fileEdits = changes[uri] as TextEdit[];
            if (!Array.isArray(fileEdits) || !fileEdits.length) continue;

            const absPath = filePathFromUriLike(uri);
            const rel = path.relative(root, absPath);
            const srcPath = path.join(root, rel);
            let orig = '';
            try {
                orig = await fs.readFile(srcPath, 'utf8');
            } catch {
                continue;
            }

            const mod = applyTextEdits(orig, fileEdits);
            const tmpPath = path.join(tmpRoot, rel);
            await fs.mkdir(path.dirname(tmpPath), { recursive: true }).catch(() => {});
            await fs.writeFile(tmpPath, mod, 'utf8');

            const left = srcPath.replace(/"/g, '\\"');
            const right = tmpPath.replace(/"/g, '\\"');
            const cmd = `git diff --no-index --src-prefix=a/ --dst-prefix=b/ -- "${left}" "${right}"`;
            const proc = spawnSync('bash', ['-lc', cmd], { stdio: 'pipe' });
            const out = String(proc.stdout || '');
            if (out && out.trim().length > 0) {
                diffParts.push(out);
            }
        }

        const unifiedDiff = diffParts.join('\n');
        const stage = overlayStore.stagePatch(snap.id, unifiedDiff);
        if (!stage.accepted) {
            return {
                payload: { ok: false, reason: 'stage_failed', message: stage.message || 'Failed to stage diff' },
                isError: true,
            };
        }

        const totalEdits = files.reduce((acc, f) => acc + (Array.isArray(changes[f]) ? changes[f].length : 0), 0);
        if (!runChecksFlag) {
            return {
                payload: {
                    workflow: 'rename_safely',
                    ok: true,
                    snapshot: snap.id,
                    filesAffected: files.length,
                    totalEdits,
                    next_actions: ['Run checks when ready', 'Open snapshot diff: snapshot://' + snap.id + '/overlay.diff'],
                },
                isError: false,
            };
        }

        const onlyTouchedEnv = (process.env.FAST_STDIO_CHECKS || '').toLowerCase() === 'touched';
        const onlyTouched = typeof args?.onlyTouched === 'boolean' ? !!args.onlyTouched : onlyTouchedEnv;
        const checks = await overlayStore.runChecks(snap.id, commands, timeoutSec, { onlyTouched, workspaceRoot: root });
        const ok = !!checks.ok;
        return {
            payload: {
                workflow: 'rename_safely',
                ok,
                snapshot: snap.id,
                filesAffected: files.length,
                totalEdits,
                elapsedMs: checks.elapsedMs,
                checks: { ok, commands: Array.isArray(checks.commands) ? checks.commands : [], elapsedMs: checks.elapsedMs },
                outputTail: (checks.output || '').slice(-4000),
                next_actions: ok
                    ? ['Optionally apply this patch to working tree', 'Open snapshot diff: snapshot://' + snap.id + '/overlay.diff']
                    : ['Review failing checks in outputTail', 'Adjust plan and retry'],
            },
            isError: !ok,
        };
    }
}

export function applyTextEdits(text: string, edits: TextEdit[]): string {
    if (!Array.isArray(edits) || edits.length === 0) return text;
    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') lineStarts.push(i + 1);
    }
    const toOffset = (pos: { line: number; character: number }) => {
        const line = Math.max(0, Math.min(pos.line, lineStarts.length - 1));
        const lineStart = lineStarts[line] ?? 0;
        return lineStart + Math.max(0, pos.character);
    };
    const items = edits.map((edit) => ({
        start: toOffset(edit.range.start),
        end: toOffset(edit.range.end),
        newText: edit.newText ?? '',
    }));
    items.sort((a, b) => b.start - a.start);

    let out = text;
    for (const edit of items) {
        out = out.slice(0, edit.start) + edit.newText + out.slice(edit.end);
    }
    return out;
}

function filePathFromUriLike(uri: string): string {
    try {
        return new URL(uri).pathname;
    } catch {
        return uri.replace(/^file:\/\//, '');
    }
}
