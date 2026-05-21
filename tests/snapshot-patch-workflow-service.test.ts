import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { overlayStore } from '../src/core/overlay-store.js';
import { SnapshotPatchWorkflowService, extractFilesFromPatch, recommendChecksPayload } from '../src/core/workflows/snapshot-patch-workflow.js';

const roots: string[] = [];
function tempWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'sci-snapshot-workflow-'));
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

describe('SnapshotPatchWorkflowService', () => {
    test('stages apply_patch and checks inside configured workspace snapshots', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'target.ts'), 'export const value = 1;\n', 'utf8');
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });

        const snap = payload(await service.getSnapshot({ preferExisting: false }));
        const patch = `*** Begin Patch\n*** Update File: target.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch\n`;

        const staged = payload(await service.proposePatch({ snapshot: snap.snapshot, patch }));
        expect(staged).toMatchObject({ accepted: true, snapshot: snap.snapshot });

        const snapshotDir = overlayStore.getSnapshotDirectory(snap.snapshot, { workspaceRoot });
        expect(snapshotDir.startsWith(join(workspaceRoot, '.ontology', 'snapshots'))).toBe(true);

        const checked = payload(await service.runChecks({ snapshot: snap.snapshot, commands: ['true'], timeoutSec: 30 }));
        expect(checked).toMatchObject({ snapshot: snap.snapshot, ok: true });
        expect(checked.commands?.[0]).toMatchObject({ command: 'true', ok: true });
    });

    test('keeps recommendation and patch file parsing protocol-neutral', () => {
        const patch = 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n';
        expect(extractFilesFromPatch(patch)).toEqual(['src/example.ts']);
        const recommendation = recommendChecksPayload({ patch, mode: 'minimum' });
        expect(recommendation).toMatchObject({ workflow: 'recommend_checks', ok: true });
        expect(recommendation.minimum).toContain('bun run typecheck');
    });
});
