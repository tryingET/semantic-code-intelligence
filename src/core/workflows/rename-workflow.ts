import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CoreError } from '../errors.js';
import { overlayStore } from '../overlay-store.js';
import type { SnapshotWorkflowResult } from './snapshot-patch-workflow.js';

type TextEdit = {
    range: { start: { line: number; character: number }; end: { line: number; character: number } };
    newText: string;
};

export interface RenameWorkflowServiceDeps {
    workspaceRoot: () => string;
    coreAnalyzer?: any;
    pickOntologySeedFile?: (symbol: string) => Promise<string | undefined | null>;
    planRename?: (args: { oldName: string; newName: string; file?: string }) => Promise<any>;
}

export class RenameWorkflowService {
    constructor(private readonly deps: RenameWorkflowServiceDeps) {}

    async renameSymbol(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        validateRequired(args, ['oldName', 'newName']);
        const result = await this.coreAnalyzer.rename(
            buildRenameRequest({
                uri: normalizeUri('file://workspace'),
                position: createPosition(0, 0),
                identifier: args.oldName,
                newName: args.newName,
                dryRun: args.preview ?? true,
            })
        );

        const changes = Object.entries(result.data.changes || {}).map(([uri, edits]) => ({
            file: uri,
            edits: (edits as any[]).map((edit: any) => ({
                range: {
                    start: { line: edit.range.start.line, character: edit.range.start.character },
                    end: { line: edit.range.end.line, character: edit.range.end.character },
                },
                newText: edit.newText,
            })),
        }));

        return {
            payload: {
                schemaVersion: 2,
                changes,
                performance: result.performance,
                requestId: result.requestId,
                preview: args.preview ?? true,
                scope: args.scope || 'exact',
                summary: `${changes.length} files affected with ${changes.reduce((acc, change) => acc + change.edits.length, 0)} edits`,
            },
            isError: false,
        };
    }

    async planRename(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        const payload = await this.computePlanRename(args);
        return { payload, isError: false };
    }

    async applyRename(args: Record<string, any>): Promise<SnapshotWorkflowResult> {
        if (args && typeof args === 'object' && args.changes) {
            return { payload: { schemaVersion: 2, status: 'applied', changes: args.changes }, isError: false };
        }

        validateRequired(args, ['oldName', 'newName']);
        const result = await this.coreAnalyzer.rename(
            buildRenameRequest({
                uri: normalizeUri(args.file || 'file://workspace'),
                position: createPosition(0, 0),
                identifier: args.oldName,
                newName: args.newName,
                dryRun: false,
            })
        );
        return {
            payload: {
                schemaVersion: 2,
                status: 'applied',
                changes: result.data.changes,
                performance: result.performance,
                requestId: result.requestId,
            },
            isError: false,
        };
    }

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

        const plan = this.deps.planRename
            ? await this.deps.planRename({ oldName, newName, file })
            : await this.computePlanRename({ oldName, newName, file });
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

        const tmpRoot = path.join(tmpRootBase, '.sci-work');
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

    private get coreAnalyzer() {
        if (!this.deps.coreAnalyzer) {
            throw new CoreError('Internal', 'Core analyzer is required for rename workflows');
        }
        return this.deps.coreAnalyzer;
    }

    private async computePlanRename(args: Record<string, any>) {
        validateRequired(args, ['oldName', 'newName']);
        const result = await this.coreAnalyzer.rename(
            buildRenameRequest({
                uri: normalizeUri(args.file || 'file://workspace'),
                position: createPosition(0, 0),
                identifier: args.oldName,
                newName: args.newName,
                dryRun: true,
            })
        );

        let changes = result.data.changes || {};
        if (Object.keys(changes).length === 0 && typeof args.file === 'string' && args.file.trim()) {
            try {
                const definitions = await this.coreAnalyzer.findDefinitionAsync({
                    uri: normalizeUri(args.file),
                    position: createPosition(0, 0),
                    identifier: args.oldName,
                    includeDeclaration: true,
                    precise: true,
                });
                const definitionsArray = Array.isArray(definitions?.data) ? definitions.data : [];
                const fallback: Record<string, any[]> = {};
                for (const definition of definitionsArray) {
                    if (!definition?.range || !definition?.uri) continue;
                    const edit = { range: definition.range, newText: args.newName };
                    fallback[definition.uri] = fallback[definition.uri] || [];
                    fallback[definition.uri].push(edit);
                }
                if (Object.keys(fallback).length > 0) {
                    changes = fallback;
                }
            } catch {}
        }

        return {
            schemaVersion: 2,
            changes,
            performance: result.performance,
            requestId: result.requestId,
            preview: true,
            summary: {
                filesAffected: Object.keys(changes || {}).length,
                totalEdits: Object.values(changes || {}).reduce((acc: number, edits: any) => acc + (edits as any[]).length, 0),
            },
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

function buildRenameRequest(params: { uri: string; position: { line: number; character: number }; identifier: string; newName: string; dryRun?: boolean }) {
    return {
        uri: normalizeUri(params.uri),
        position: params.position,
        oldName: params.identifier,
        newName: params.newName,
        dryRun: params.dryRun ?? false,
    } as any;
}

function createPosition(line: number, character: number) {
    return { line: Math.max(0, line), character: Math.max(0, character) };
}

function normalizeUri(uri: string): string {
    return pathToFileURL(uriToPath(uri)).href;
}

function uriToPath(uri: string): string {
    const workspacePrefix = 'file://workspace';
    if (uri.startsWith(workspacePrefix)) {
        const sub = uri.length > workspacePrefix.length ? uri.substring(workspacePrefix.length) : '';
        const rel = sub.replace(/^\/+/, '');
        const resolved = rel ? path.join(process.cwd(), rel) : process.cwd();
        return path.resolve(resolved);
    }
    if (uri.startsWith('file://')) {
        try {
            return fileURLToPath(uri);
        } catch {
            const body = uri.replace(/^file:\/\//, '');
            return path.isAbsolute(body) ? body : path.resolve('/', body);
        }
    }
    return path.isAbsolute(uri) ? uri : path.resolve(process.cwd(), uri);
}

function filePathFromUriLike(uri: string): string {
    try {
        return new URL(uri).pathname;
    } catch {
        return uri.replace(/^file:\/\//, '');
    }
}

function validateRequired(args: Record<string, any>, fields: string[]) {
    if (!args || typeof args !== 'object') {
        throw new CoreError('InvalidParams', 'Arguments must be an object');
    }
    for (const field of fields) {
        if (args[field] === undefined || args[field] === null || (typeof args[field] === 'string' && args[field].trim() === '')) {
            throw new CoreError('InvalidParams', `Missing required parameter: ${field}`, { field });
        }
    }
}
