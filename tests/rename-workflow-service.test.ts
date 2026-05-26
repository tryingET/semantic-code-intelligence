import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { overlayStore } from '../src/core/overlay-store.js';
import { RenameWorkflowService, applyTextEdits } from '../src/core/workflows/rename-workflow.js';

const roots: string[] = [];
function tempWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'sci-rename-workflow-'));
    roots.push(root);
    return root;
}
function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

afterEach(() => {
    overlayStore.clearAll();
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('RenameWorkflowService', () => {
    test('applies text edits from the end to preserve offsets', () => {
        const result = applyTextEdits('alpha beta gamma\n', [
            {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
                newText: 'ALPHA',
            },
            {
                range: { start: { line: 0, character: 11 }, end: { line: 0, character: 16 } },
                newText: 'GAMMA',
            },
        ]);
        expect(result).toBe('ALPHA beta GAMMA\n');
    });

    test('shapes rename preview, plan, and apply payloads without MCP protocol objects', async () => {
        const service = new RenameWorkflowService({
            workspaceRoot: () => process.cwd(),
            coreAnalyzer: {
                rename: async (request: any) => ({
                    data: {
                        changes: {
                            [request.uri]: [
                                {
                                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: request.oldName.length } },
                                    newText: request.newName,
                                },
                            ],
                        },
                    },
                    performance: { total: 1 },
                    requestId: 'rename-1',
                }),
            },
        });

        const renamed = payload(await service.renameSymbol({ oldName: 'oldName', newName: 'newName', preview: true }));
        expect(renamed).toMatchObject({ schemaVersion: 2, preview: true, requestId: 'rename-1' });
        expect(renamed.summary).toContain('1 files affected with 1 edits');

        const planned = payload(await service.planRename({ oldName: 'oldName', newName: 'newName' }));
        expect(planned).toMatchObject({ schemaVersion: 2, preview: true, summary: { filesAffected: 1, totalEdits: 1 } });

        const applied = await service.applyRename({ changes: { 'file:///tmp/a.ts': [] } });
        expect(applied.isError).toBe(true);
        expect(payload(applied)).toMatchObject({ schemaVersion: 2, status: 'unsupported' });
    });

    test('plans rename against configured workspace root instead of process cwd', async () => {
        const workspaceRoot = tempWorkspace();
        const seen: any[] = [];
        const service = new RenameWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                rename: async (request: any) => {
                    seen.push(request);
                    return { data: { changes: {} }, performance: {}, requestId: 'rename-root' };
                },
            },
        });

        await service.planRename({ oldName: 'oldName', newName: 'newName' });
        expect(seen[0].uri).toBe(`file://${workspaceRoot}`);
    });

    test('stages safe rename diffs in configured workspace snapshots', async () => {
        const workspaceRoot = tempWorkspace();
        const target = join(workspaceRoot, 'target.ts');
        writeFileSync(target, 'export const oldName = 1;\nconsole.log(oldName);\n', 'utf8');

        const service = new RenameWorkflowService({
            workspaceRoot: () => workspaceRoot,
            planRename: async () => ({
                changes: {
                    [`file://${target}`]: [
                        {
                            range: { start: { line: 0, character: 13 }, end: { line: 0, character: 20 } },
                            newText: 'newName',
                        },
                        {
                            range: { start: { line: 1, character: 12 }, end: { line: 1, character: 19 } },
                            newText: 'newName',
                        },
                    ],
                },
            }),
        });

        const result = payload(await service.safeRename({ oldName: 'oldName', newName: 'newName', runChecks: false }));
        expect(result).toMatchObject({ workflow: 'rename_safely', ok: true, filesAffected: 1, totalEdits: 2 });
        expect(typeof result.snapshot).toBe('string');

        const snapshotDir = overlayStore.getSnapshotDirectory(result.snapshot, { workspaceRoot });
        expect(snapshotDir.startsWith(join(workspaceRoot, '.ontology', 'snapshots'))).toBe(true);
    });

    test('safe rename rejects out-of-workspace plan paths explicitly', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace();
        const outsideTarget = join(outsideRoot, 'outside.ts');
        writeFileSync(outsideTarget, 'export const oldName = 1;\n', 'utf8');

        const service = new RenameWorkflowService({
            workspaceRoot: () => workspaceRoot,
            planRename: async () => ({
                changes: {
                    [`file://${outsideTarget}`]: [
                        {
                            range: { start: { line: 0, character: 13 }, end: { line: 0, character: 20 } },
                            newText: 'newName',
                        },
                    ],
                },
            }),
        });

        const result = await service.safeRename({ oldName: 'oldName', newName: 'newName', runChecks: false });
        expect(result.isError).toBe(true);
        expect(payload(result)).toMatchObject({ ok: false, reason: 'invalid_plan_path' });
        expect(payload(result).paths).toEqual([`file://${outsideTarget}`]);
    });

    test('safe rename rejects plan paths that escape through workspace symlinks', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace();
        const outsideTarget = join(outsideRoot, 'outside.ts');
        const linkPath = join(workspaceRoot, 'linked-outside');
        writeFileSync(outsideTarget, 'export const oldName = 1;\n', 'utf8');
        symlinkSync(outsideRoot, linkPath, 'dir');

        const service = new RenameWorkflowService({
            workspaceRoot: () => workspaceRoot,
            planRename: async () => ({
                changes: {
                    [`file://${join(linkPath, 'outside.ts')}`]: [
                        {
                            range: { start: { line: 0, character: 13 }, end: { line: 0, character: 20 } },
                            newText: 'newName',
                        },
                    ],
                },
            }),
        });

        const result = await service.safeRename({ oldName: 'oldName', newName: 'newName', runChecks: false });
        expect(result.isError).toBe(true);
        expect(payload(result)).toMatchObject({ ok: false, reason: 'invalid_plan_path' });
    });

    test('safe rename accepts in-workspace paths with names that start with dot-dot text', async () => {
        const workspaceRoot = tempWorkspace();
        const weirdDir = join(workspaceRoot, '..fixtures');
        const target = join(weirdDir, 'target.ts');
        mkdirSync(weirdDir);
        writeFileSync(target, 'export const oldName = 1;\n', 'utf8');

        const service = new RenameWorkflowService({
            workspaceRoot: () => workspaceRoot,
            planRename: async () => ({
                changes: {
                    [`file://${target}`]: [
                        {
                            range: { start: { line: 0, character: 13 }, end: { line: 0, character: 20 } },
                            newText: 'newName',
                        },
                    ],
                },
            }),
        });

        const result = payload(await service.safeRename({ oldName: 'oldName', newName: 'newName', runChecks: false }));
        expect(result).toMatchObject({ workflow: 'rename_safely', ok: true, filesAffected: 1, totalEdits: 1 });
    });
});
