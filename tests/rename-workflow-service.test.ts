import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
});
