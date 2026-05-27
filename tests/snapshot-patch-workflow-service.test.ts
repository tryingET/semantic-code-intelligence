import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { overlayStore } from '../src/core/overlay-store.js';
import {
    extractFilesFromPatch,
    recommendChecksPayload,
    SnapshotPatchWorkflowService,
} from '../src/core/workflows/snapshot-patch-workflow.js';

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

        const checked = payload(
            await service.runChecks({ snapshot: snap.snapshot, commands: ['true'], timeoutSec: 30 })
        );
        expect(checked).toMatchObject({ snapshot: snap.snapshot, ok: true });
        expect(checked.commands?.[0]).toMatchObject({ command: 'true', ok: true });

        const artifacts = payload(
            await service.extractSnapshotArtifacts({ snapshot: snap.snapshot, includeContent: true, maxBytes: 20 })
        );
        expect(artifacts).toMatchObject({
            snapshot: snap.snapshot,
            status: { exists: true, diffCount: 1, materialized: true },
        });
        expect(artifacts.links.map((link: any) => link.uri)).toContain(`snapshot://${snap.snapshot}/overlay.diff`);
        expect(artifacts.contents.overlayDiff.text.length).toBeLessThanOrEqual(20);
        expect(artifacts.contents.overlayDiff.truncated).toBe(true);
    });

    test('stages sequential apply_patch updates against snapshot overlay state', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'target.ts'), 'export const value = 1;\n', 'utf8');
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snap = payload(await service.getSnapshot({ preferExisting: false }));

        const first = `*** Begin Patch\n*** Update File: target.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch\n`;
        expect(payload(await service.proposePatch({ snapshot: snap.snapshot, patch: first })).accepted).toBe(true);

        const second = `*** Begin Patch\n*** Update File: target.ts\n@@\n-export const value = 2;\n+export const value = 3;\n*** End Patch\n`;
        const staged = payload(await service.proposePatch({ snapshot: snap.snapshot, patch: second }));
        expect(staged).toMatchObject({ accepted: true, snapshot: snap.snapshot });
    });

    test('extractSnapshotArtifacts does not follow replaced snapshot artifact symlinks', async () => {
        const workspaceRoot = tempWorkspace();
        const outside = join(tempWorkspace(), 'secret.txt');
        writeFileSync(outside, 'secret-from-outside\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'target.ts'), 'export const value = 1;\n', 'utf8');
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snap = payload(await service.getSnapshot({ preferExisting: false }));
        const patch = `diff --git a/target.ts b/target.ts
--- a/target.ts
+++ b/target.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
        expect(payload(await service.proposePatch({ snapshot: snap.snapshot, patch })).accepted).toBe(true);
        const firstArtifacts = payload(
            await service.extractSnapshotArtifacts({ snapshot: snap.snapshot, includeContent: true })
        );
        expect(firstArtifacts.contents.overlayDiff.text).toContain('target.ts');

        const snapshotDir = overlayStore.getSnapshotDirectory(snap.snapshot, { workspaceRoot });
        rmSync(join(snapshotDir, 'overlay.diff'), { force: true });
        symlinkSync(outside, join(snapshotDir, 'overlay.diff'));

        const artifacts = payload(
            await service.extractSnapshotArtifacts({ snapshot: snap.snapshot, includeContent: true })
        );
        expect(artifacts.contents.overlayDiff.text).not.toContain('secret-from-outside');
    });

    test('snapshot metadata load rejects symlinked snapshot directories', async () => {
        const workspaceRoot = tempWorkspace();
        const outside = tempWorkspace();
        const snapshot = '11111111-1111-4111-8111-111111111111';
        mkdirSync(join(workspaceRoot, '.ontology', 'snapshots'), { recursive: true });
        writeFileSync(join(outside, 'metadata.json'), JSON.stringify({
            id: snapshot,
            createdAt: Date.now(),
            diffs: [],
            workspaceRoot,
            touchedFiles: [],
        }), 'utf8');
        symlinkSync(outside, join(workspaceRoot, '.ontology', 'snapshots', snapshot));

        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const artifacts = payload(await service.extractSnapshotArtifacts({ snapshot, includeContent: true }));
        expect(artifacts.status.exists).toBe(false);
        expect(artifacts.status.error).toBeTruthy();
    });

    test('snapshot checks isolate HOME and reject mutated package-script runners', async () => {
        const workspaceRoot = tempWorkspace();
        const hostSentinel = join(process.env.HOME || tempWorkspace(), 'sci-safe-write-host-home-sentinel');
        rmSync(hostSentinel, { force: true });
        writeFileSync(join(workspaceRoot, 'home-write.test.ts'), "import { test, expect } from 'bun:test';\nimport { writeFileSync } from 'node:fs';\nimport { join } from 'node:path';\ntest('home is isolated', () => { writeFileSync(join(process.env.HOME!, 'sci-safe-write-host-home-sentinel'), 'isolated'); expect(true).toBe(true); });\n", 'utf8');
        writeFileSync(join(workspaceRoot, 'package.json'), '{"scripts":{"typecheck":"echo ok"}}\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'target.ts'), 'export const value = 1;\n', 'utf8');
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snap = payload(await service.getSnapshot({ preferExisting: false }));

        const safePatch = `diff --git a/target.ts b/target.ts
--- a/target.ts
+++ b/target.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
        expect(payload(await service.proposePatch({ snapshot: snap.snapshot, patch: safePatch })).accepted).toBe(true);
        const checked = payload(await service.runChecks({ snapshot: snap.snapshot, commands: ['bun test home-write.test.ts'], timeoutSec: 30 }));
        expect(checked.ok).toBe(true);
        expect(existsSync(hostSentinel)).toBe(false);

        const packagePatch = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"scripts":{"typecheck":"echo ok"}}
+{"scripts":{"typecheck":"echo unsafe"}}
`;
        const packageSnap = payload(await service.getSnapshot({ preferExisting: false }));
        expect(payload(await service.proposePatch({ snapshot: packageSnap.snapshot, patch: packagePatch })).accepted).toBe(true);
        const rejected = payload(await service.runChecks({ snapshot: packageSnap.snapshot, commands: ['bun run typecheck'], timeoutSec: 30 }));
        expect(rejected.ok).toBe(false);
        expect(rejected.output).toContain('runner commands are disabled');
    });

    test('snapshot progress logging does not follow replaced progress symlinks', async () => {
        const previousProgress = process.env.PROGRESS_LOGS;
        process.env.PROGRESS_LOGS = '1';
        try {
            const workspaceRoot = tempWorkspace();
            const outside = join(tempWorkspace(), 'progress-outside.txt');
            writeFileSync(outside, 'original-outside\n', 'utf8');
            writeFileSync(join(workspaceRoot, 'target.ts'), 'export const value = 1;\n', 'utf8');
            const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
            const snap = payload(await service.getSnapshot({ preferExisting: false }));
            const patch = `diff --git a/target.ts b/target.ts
--- a/target.ts
+++ b/target.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;
            expect(payload(await service.proposePatch({ snapshot: snap.snapshot, patch })).accepted).toBe(true);
            expect(payload(await service.extractSnapshotArtifacts({ snapshot: snap.snapshot, includeContent: true })).status.materialized).toBe(true);

            const snapshotDir = overlayStore.getSnapshotDirectory(snap.snapshot, { workspaceRoot });
            rmSync(join(snapshotDir, 'progress.log'), { force: true });
            symlinkSync(outside, join(snapshotDir, 'progress.log'));

            expect(payload(await service.extractSnapshotArtifacts({ snapshot: snap.snapshot, includeContent: true })).status.materialized).toBe(true);
            expect(readFileSync(outside, 'utf8')).toBe('original-outside\n');
        } finally {
            if (previousProgress === undefined) delete process.env.PROGRESS_LOGS;
            else process.env.PROGRESS_LOGS = previousProgress;
        }
    });

    test('extractSnapshotArtifacts clamps invalid maxBytes and truncates UTF-8 on code point boundaries', async () => {
        const workspaceRoot = tempWorkspace();
        const file = 'éééabc.txt';
        writeFileSync(join(workspaceRoot, file), 'before\n', 'utf8');
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => workspaceRoot });
        const snap = payload(await service.getSnapshot({ preferExisting: false }));
        const patch = `diff --git a/${file} b/${file}
--- a/${file}
+++ b/${file}
@@ -1 +1 @@
-before
+after
`;
        expect(payload(await service.proposePatch({ snapshot: snap.snapshot, patch })).accepted).toBe(true);

        const invalidLimit = payload(
            await service.extractSnapshotArtifacts({
                snapshot: snap.snapshot,
                includeContent: true,
                maxBytes: 'not-a-number',
            })
        );
        expect(invalidLimit.contents.overlayDiff.text).toContain(file);

        const bounded = payload(
            await service.extractSnapshotArtifacts({ snapshot: snap.snapshot, includeContent: true, maxBytes: 14 })
        );
        expect(bounded.contents.overlayDiff.truncated).toBe(true);
        expect(Buffer.byteLength(bounded.contents.overlayDiff.text, 'utf8')).toBeLessThanOrEqual(14);
        expect(bounded.contents.overlayDiff.text).toBe('diff --git a/');
    });

    test('reports missing snapshot artifact arguments without MCP protocol objects', async () => {
        const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => tempWorkspace() });

        expect(await service.extractSnapshotArtifacts({})).toEqual({ text: 'snapshot required', isError: true });
    });

    test('keeps recommendation and patch file parsing protocol-neutral', () => {
        const patch = 'diff --git a/src/example.ts b/src/example.ts\n--- a/src/example.ts\n+++ b/src/example.ts\n';
        expect(extractFilesFromPatch(patch)).toEqual(['src/example.ts']);
        const recommendation = recommendChecksPayload({ patch, mode: 'minimum' });
        expect(recommendation).toMatchObject({ workflow: 'recommend_checks', ok: true });
        expect(recommendation.minimum).toContain('bun run typecheck');
    });
});
