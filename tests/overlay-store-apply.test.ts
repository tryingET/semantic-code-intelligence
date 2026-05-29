import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { OverlayStore, overlayStore } from '../src/core/overlay-store.js';
import { SnapshotPatchWorkflowService } from '../src/core/workflows/snapshot-patch-workflow.js';

describe('OverlayStore applyToWorkingTree with unified diff', () => {
    const targetRel = 'tests/fixtures/example.ts';
    const targetAbs = path.join(process.cwd(), targetRel);
    const marker = '// overlay unified add';

    function patchAddingMarker(rel: string): string {
        return [
            `diff --git a/${rel} b/${rel}`,
            `--- a/${rel}`,
            `+++ b/${rel}`,
            '@@ -5,3 +5,4 @@',
            ' export class TestClass {',
            '     // mcp unified apply_after_checks test',
            `+    ${marker}`,
            '     private value: number = 0;',
            '',
        ].join('\n');
    }

    beforeAll(async () => {});

    afterAll(async () => {});

    test('adds new file and reverts via reverse apply', async () => {
        const before = await fs.readFile(targetAbs, 'utf8');
        const snap = overlayStore.createSnapshot(false);
        const patch = patchAddingMarker(targetRel);
        const staged = overlayStore.stagePatch(snap.id, patch);
        expect(staged.accepted).toBe(true);

        // Optional quick checks (true)
        const chk = await overlayStore.runChecks(snap.id, ['true'], 30);
        expect(chk.ok).toBe(true);
        expect(chk.commands[0]).toMatchObject({ command: 'true', ok: true, exitCode: 0, timedOut: false });

        // Apply to working tree
        const applied = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: false });
        expect(applied.ok).toBe(true);
        const afterApply = await fs.readFile(targetAbs, 'utf8');
        expect(afterApply).toContain(marker);
        expect(afterApply).not.toEqual(before);

        // Reverse
        const reverted = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: true });
        expect(reverted.ok).toBe(true);
        const afterRevert = await fs.readFile(targetAbs, 'utf8');
        expect(afterRevert).toEqual(before);
    }, 30000);

    test('persists dry-run apply status across snapshot reloads', async () => {
        const snap = overlayStore.createSnapshot(false);
        const patch = patchAddingMarker(targetRel);
        const staged = overlayStore.stagePatch(snap.id, patch);
        expect(staged.accepted).toBe(true);

        const checked = await overlayStore.applyToWorkingTree(snap.id, { check: true, reverse: false });
        expect(checked.ok).toBe(true);

        overlayStore.clearAll();
        const status = overlayStore.getStatus(snap.id);
        expect(status.lastApply).toMatchObject({ ok: true, args: { check: true, reverse: false } });
        expect(typeof status.lastApply.at).toBe('number');
    }, 30000);

    test('dry-run apply for nested new files does not create workspace directories', async () => {
        const nestedDir = `.tmp-overlay-check-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const nestedRel = `${nestedDir}/new-file.ts`;
        try {
            rmSync(nestedDir, { recursive: true, force: true });
            const snap = overlayStore.createSnapshot(false);
            const patch = `diff --git a/${nestedRel} b/${nestedRel}\n--- /dev/null\n+++ b/${nestedRel}\n@@ -0,0 +1,1 @@\n+export const nestedDryRun = true;\n`;
            const staged = overlayStore.stagePatch(snap.id, patch);
            expect(staged.accepted).toBe(true);

            const checked = await overlayStore.applyToWorkingTree(snap.id, { check: true, reverse: false });
            expect(checked.ok).toBe(true);
            expect(existsSync(nestedDir)).toBe(false);
        } finally {
            rmSync(nestedDir, { recursive: true, force: true });
        }
    }, 30000);

    test('preflight apply failures are persisted without leaking workspace paths', async () => {
        const snap = overlayStore.createSnapshot(false);
        const failed = await overlayStore.applyToWorkingTree(snap.id, { check: true, reverse: false });
        expect(failed.ok).toBe(false);
        expect(failed.output).toBe('Invalid apply_snapshot patch paths or missing overlay diff');
        expect(failed.output).not.toContain(process.cwd());

        overlayStore.clearAll();
        const status = overlayStore.getStatus(snap.id);
        expect(status.lastApply).toMatchObject({ ok: false, args: { check: true, reverse: false } });
        expect(status.lastApply.outputTail).toBe('Invalid apply_snapshot patch paths or missing overlay diff');
    }, 30000);

    test('apply target directory fingerprints detect recreated normal directories', () => {
        const nestedDir = `.tmp-overlay-dir-fingerprint-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const childDir = path.join(nestedDir, 'child');
        try {
            rmSync(nestedDir, { recursive: true, force: true });
            mkdirSync(childDir, { recursive: true });
            const before = (overlayStore as any).collectApplyDirFingerprints([`${nestedDir}/child`]);
            rmSync(childDir, { recursive: true, force: true });
            mkdirSync(childDir, { recursive: true });
            const after = (overlayStore as any).collectApplyDirFingerprints([`${nestedDir}/child`]);

            expect((overlayStore as any).applyDirFingerprintsMatch(before, after)).toBe(false);
        } finally {
            rmSync(nestedDir, { recursive: true, force: true });
        }
    });

    test('nested add-file apply reverses file and empty parent directory', async () => {
        const nestedDir = `.tmp-overlay-apply-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const nestedRel = `${nestedDir}/new-file.ts`;
        try {
            rmSync(nestedDir, { recursive: true, force: true });
            const snap = overlayStore.createSnapshot(false);
            const patch = `diff --git a/${nestedRel} b/${nestedRel}\n--- /dev/null\n+++ b/${nestedRel}\n@@ -0,0 +1,1 @@\n+export const nestedApply = true;\n`;
            expect(overlayStore.stagePatch(snap.id, patch).accepted).toBe(true);

            const applied = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: false });
            expect(applied.ok).toBe(true);
            expect(await fs.readFile(path.join(process.cwd(), nestedRel), 'utf8')).toContain('nestedApply');

            const reverted = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: true });
            expect(reverted.ok).toBe(true);
            expect(existsSync(path.join(process.cwd(), nestedRel))).toBe(false);
            expect(existsSync(nestedDir)).toBe(false);
        } finally {
            rmSync(nestedDir, { recursive: true, force: true });
        }
    }, 30000);

    test('normalizes add-file diffs so git apply does not create dev/null', async () => {
        const targetRel = `tests/fixtures/overlay_new_${Date.now()}_${Math.random().toString(16).slice(2)}.ts`;
        const targetAbs = path.join(process.cwd(), targetRel);
        const devNullAbs = path.join(process.cwd(), 'dev/null');
        try {
            rmSync(path.join(process.cwd(), 'dev'), { recursive: true, force: true });
            rmSync(targetAbs, { force: true });
            const snap = overlayStore.createSnapshot(false);
            const patch = `diff --git a/${targetRel} b/${targetRel}\n--- /dev/null\n+++ b/${targetRel}\n@@ -0,0 +1,1 @@\n+export const overlayAddFile = true;\n`;
            const staged = overlayStore.stagePatch(snap.id, patch);
            expect(staged.accepted).toBe(true);
            expect((snap as any).diffs[0]).toContain('new file mode 100644');

            const applied = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: false });
            expect(applied.ok).toBe(true);
            expect(existsSync(devNullAbs)).toBe(false);
            expect(await fs.readFile(targetAbs, 'utf8')).toContain('overlayAddFile');

            const reverted = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: true });
            expect(reverted.ok).toBe(true);
            expect(existsSync(targetAbs)).toBe(false);
            expect(existsSync(devNullAbs)).toBe(false);
        } finally {
            rmSync(targetAbs, { force: true });
            rmSync(path.join(process.cwd(), 'dev'), { recursive: true, force: true });
        }
    }, 30000);

    test('normalizes unprefixed traditional nested paths to the recorded touched file', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-traditional-nested-'));
        try {
            spawnSync('git', ['init', '-q'], { cwd: root });
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const staged = store.stagePatch(snap.id, '--- /dev/null\n+++ nested/file.txt\n@@ -0,0 +1 @@\n+hi\n');
            expect(staged.accepted).toBe(true);
            expect(Array.from(store.ensureSnapshot(snap.id, { workspaceRoot: root }).touchedFiles || [])).toEqual([
                'nested/file.txt',
            ]);

            const applied = await store.applyToWorkingTree(snap.id, { workspaceRoot: root });
            expect(applied.ok).toBe(true);
            expect(await fs.readFile(path.join(root, 'nested/file.txt'), 'utf8')).toBe('hi\n');
            expect(existsSync(path.join(root, 'file.txt'))).toBe(false);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('safe_write verification follows normalized traditional nested paths', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-safe-write-traditional-nested-'));
        const previousAllow = process.env.ALLOW_SNAPSHOT_APPLY;
        try {
            spawnSync('git', ['init', '-q'], { cwd: root });
            process.env.ALLOW_SNAPSHOT_APPLY = '1';
            const service = new SnapshotPatchWorkflowService({ workspaceRoot: () => root } as any);
            const result: any = await service.safeWrite({
                patch: '--- /dev/null\n+++ nested/file.txt\n@@ -0,0 +1 @@\n+hi\n',
                commands: ['true'],
                timeoutSec: 5,
                apply: true,
            });

            expect(result.payload.ok).toBe(true);
            expect(result.payload.verification.appliedDiffMatchesSnapshot).toBe(true);
            expect(await fs.readFile(path.join(root, 'nested/file.txt'), 'utf8')).toBe('hi\n');
            expect(existsSync(path.join(root, 'file.txt'))).toBe(false);
        } finally {
            if (previousAllow === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = previousAllow;
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('squashed multi-diff apply accepts in-workspace paths beginning with dot-dot text', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-squash-dotdot-'));
        try {
            spawnSync('git', ['init', '-q'], { cwd: root });
            await fs.writeFile(path.join(root, '..foo.ts'), 'one\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            expect(
                store.stagePatch(snap.id, '--- a/..foo.ts\n+++ b/..foo.ts\n@@ -1 +1 @@\n-one\n+two\n').accepted
            ).toBe(true);
            expect(
                store.stagePatch(snap.id, '--- a/..foo.ts\n+++ b/..foo.ts\n@@ -1 +1 @@\n-two\n+three\n').accepted
            ).toBe(true);

            const applied = await store.applyToWorkingTree(snap.id, { workspaceRoot: root });
            expect(applied.ok).toBe(true);
            expect(await fs.readFile(path.join(root, '..foo.ts'), 'utf8')).toBe('three\n');
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('fails closed when refreshing a materialized snapshot after workspace changes', async () => {
        const rel = `.tmp-overlay-refresh-base-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
        const abs = path.join(process.cwd(), rel);
        try {
            await fs.writeFile(abs, 'one\n', 'utf8');
            const snap = overlayStore.createSnapshot(false);
            const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
            expect(ensure).toBeTruthy();
            const initialDir = await ensure(snap.id);
            expect(await fs.readFile(path.join(initialDir, rel), 'utf8')).toBe('one\n');

            await fs.writeFile(abs, 'workspace changed\n', 'utf8');
            const patch = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-one\n+two\n`;
            const staged = overlayStore.stagePatch(snap.id, patch);
            expect(staged.accepted).toBe(false);
            expect(staged.message).toContain('Workspace changed since snapshot creation');
            expect(await fs.readFile(path.join(initialDir, rel), 'utf8')).toBe('one\n');
        } finally {
            rmSync(abs, { force: true });
        }
    }, 30000);

    test('does not report patch acceptance when snapshot metadata persistence fails', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-persist-fail-'));
        try {
            await fs.writeFile(path.join(root, 'file.txt'), 'one\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const originalWrite = (store as any).writeSnapshotMetadataSync;
            (store as any).writeSnapshotMetadataSync = () => {
                throw new Error('simulated metadata write failure');
            };
            const staged = store.stagePatch(
                snap.id,
                'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n'
            );

            expect(staged.accepted).toBe(false);
            expect(staged.message).toContain('Failed to persist snapshot metadata');
            expect(store.ensureSnapshot(snap.id, { workspaceRoot: root }).diffs).toHaveLength(0);
            (store as any).writeSnapshotMetadataSync = originalWrite;
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('repeated identical patch staging is idempotent within a snapshot', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-idempotent-'));
        try {
            await fs.writeFile(path.join(root, 'file.txt'), 'one\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n';

            expect(store.stagePatch(snap.id, patch).accepted).toBe(true);
            const repeated = store.stagePatch(snap.id, patch);
            expect(repeated.accepted).toBe(true);
            expect(repeated.message).toContain('already staged');
            expect(store.ensureSnapshot(snap.id, { workspaceRoot: root }).diffs).toHaveLength(1);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('duplicate patch staging still fails closed after workspace drift', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-idempotent-drift-'));
        try {
            await fs.writeFile(path.join(root, 'file.txt'), 'one\n', 'utf8');
            spawnSync('git', ['init', '-q'], { cwd: root });
            spawnSync('git', ['add', 'file.txt'], { cwd: root });
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n';

            expect(store.stagePatch(snap.id, patch).accepted).toBe(true);
            await fs.writeFile(path.join(root, 'file.txt'), 'workspace drift\n', 'utf8');
            const repeated = store.stagePatch(snap.id, patch);
            expect(repeated.accepted).toBe(false);
            expect(repeated.message).toContain('Workspace changed since snapshot creation');
            expect(store.ensureSnapshot(snap.id, { workspaceRoot: root }).diffs).toHaveLength(1);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('apply check surfaces snapshot metadata persistence failures without changing apply result', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-apply-receipt-fail-'));
        try {
            await fs.writeFile(path.join(root, 'file.txt'), 'one\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n';
            expect(store.stagePatch(snap.id, patch).accepted).toBe(true);
            const originalWrite = (store as any).writeSnapshotMetadataSync;
            (store as any).writeSnapshotMetadataSync = () => {
                throw new Error('simulated apply receipt write failure');
            };

            try {
                const checked = await store.applyToWorkingTree(snap.id, { check: true, workspaceRoot: root });
                expect(checked.ok).toBe(true);
                expect(checked.output).toContain('Failed to persist snapshot apply receipt');
                expect(await fs.readFile(path.join(root, 'file.txt'), 'utf8')).toBe('one\n');
            } finally {
                (store as any).writeSnapshotMetadataSync = originalWrite;
            }
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('mutating apply receipt persistence failures do not falsely report an unapplied patch', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-apply-receipt-mutating-fail-'));
        try {
            await fs.writeFile(path.join(root, 'file.txt'), 'one\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const patch = 'diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-one\n+two\n';
            expect(store.stagePatch(snap.id, patch).accepted).toBe(true);
            const originalWrite = (store as any).writeSnapshotMetadataSync;
            (store as any).writeSnapshotMetadataSync = () => {
                throw new Error('simulated apply receipt write failure');
            };

            try {
                const applied = await store.applyToWorkingTree(snap.id, { workspaceRoot: root });
                expect(applied.ok).toBe(true);
                expect(applied.output).toContain('Failed to persist snapshot apply receipt');
                expect(await fs.readFile(path.join(root, 'file.txt'), 'utf8')).toBe('two\n');
            } finally {
                (store as any).writeSnapshotMetadataSync = originalWrite;
            }
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('refreshes materialized snapshot when new staged diffs are added', async () => {
        const rel = `.tmp-overlay-rematerialize-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
        const abs = path.join(process.cwd(), rel);
        try {
            await fs.writeFile(abs, 'one\n', 'utf8');
            const snap = overlayStore.createSnapshot(false);
            const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
            expect(ensure).toBeTruthy();

            const initialDir = await ensure(snap.id);
            expect(await fs.readFile(path.join(initialDir, rel), 'utf8')).toBe('one\n');

            const firstPatch = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-one\n+two\n`;
            expect(overlayStore.stagePatch(snap.id, firstPatch).accepted).toBe(true);
            const afterFirstDir = await ensure(snap.id);
            expect(afterFirstDir).toBe(initialDir);
            expect(await fs.readFile(path.join(afterFirstDir, rel), 'utf8')).toBe('two\n');

            const secondPatch = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-two\n+three\n`;
            expect(overlayStore.stagePatch(snap.id, secondPatch).accepted).toBe(true);
            const afterSecondDir = await ensure(snap.id);
            expect(afterSecondDir).toBe(initialDir);
            expect(await fs.readFile(path.join(afterSecondDir, rel), 'utf8')).toBe('three\n');
            expect(await fs.readFile(abs, 'utf8')).toBe('one\n');
        } finally {
            rmSync(abs, { force: true });
        }
    }, 30000);

    test('rejects escaping patch paths before staging', () => {
        const snap = overlayStore.createSnapshot(false);
        const rejected = overlayStore.stagePatch(
            snap.id,
            'diff --git a/../../outside.txt b/../../outside.txt\n--- a/../../outside.txt\n+++ b/../../outside.txt\n@@ -1 +1 @@\n-old\n+new\n'
        );

        expect(rejected.accepted).toBe(false);
        expect(rejected.message).toContain('workspace');
    });

    test('rejects mismatched absolute unified headers instead of falling back to GNU patch paths', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-mismatch-'));
        try {
            await fs.writeFile(path.join(root, 'safe.txt'), 'old\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const staged = store.stagePatch(
                snap.id,
                'diff --git a/safe.txt b/safe.txt\n--- /tmp/doesnotexist\n+++ /tmp/evil.txt\n@@ -0,0 +1 @@\n+evil\n'
            );

            expect(staged.accepted).toBe(false);
            expect(staged.message).toContain('workspace');
            expect(existsSync(path.join(root, 'tmp', 'evil.txt'))).toBe(false);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('accepts hunk content lines that look like file headers', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-header-content-'));
        try {
            await fs.writeFile(path.join(root, 'options.txt'), 'alpha\n-- flag\nomega\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const staged = store.stagePatch(
                snap.id,
                'diff --git a/options.txt b/options.txt\n--- a/options.txt\n+++ b/options.txt\n@@ -1,3 +1,3 @@\n alpha\n--- flag\n+++ flag\n omega\n'
            );

            expect(staged.accepted).toBe(true);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('accepts valid git diffs whose filenames end with date-like text', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-date-name-'));
        try {
            await fs.mkdir(path.join(root, 'notes'), { recursive: true });
            const rel = 'notes/release 2026-05-28';
            const undatedRel = 'notes/release';
            await fs.writeFile(path.join(root, rel), 'old\n', 'utf8');
            await fs.writeFile(path.join(root, undatedRel), 'old\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const staged = store.stagePatch(
                snap.id,
                `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-old\n+new\n`
            );

            expect(staged.accepted).toBe(true);
            expect(Array.from(store.ensureSnapshot(snap.id, { workspaceRoot: root }).touchedFiles || [])).toEqual([
                rel,
            ]);
            const applied = await store.applyToWorkingTree(snap.id, { workspaceRoot: root });
            expect(applied.ok).toBe(true);
            expect(await fs.readFile(path.join(root, rel), 'utf8')).toBe('new\n');
            expect(await fs.readFile(path.join(root, undatedRel), 'utf8')).toBe('old\n');
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('strips full unified-diff timestamp metadata without truncating filenames', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-header-timestamp-'));
        try {
            await fs.writeFile(path.join(root, 'dated.txt'), 'old\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const staged = store.stagePatch(
                snap.id,
                '--- dated.txt 2026-05-28 12:34:56 +0000\n+++ dated.txt 2026-05-28 12:35:00 +0000\n@@ -1 +1 @@\n-old\n+new\n'
            );

            expect(staged.accepted).toBe(true);
            expect(Array.from(store.ensureSnapshot(snap.id, { workspaceRoot: root }).touchedFiles || [])).toEqual([
                'dated.txt',
            ]);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('tracks every file in traditional multi-file unified diffs', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-multifile-'));
        try {
            await fs.writeFile(path.join(root, 'a.txt'), 'old a\n', 'utf8');
            await fs.writeFile(path.join(root, 'b.txt'), 'old b\n', 'utf8');
            const store = new OverlayStore();
            const snap = store.createSnapshot(false, { workspaceRoot: root });
            const staged = store.stagePatch(
                snap.id,
                '--- a.txt\n+++ a.txt\n@@ -1 +1 @@\n-old a\n+new a\n--- b.txt\n+++ b.txt\n@@ -1 +1 @@\n-old b\n+new b\n'
            );

            expect(staged.accepted).toBe(true);
            expect(
                Array.from(store.ensureSnapshot(snap.id, { workspaceRoot: root }).touchedFiles || []).sort()
            ).toEqual(['a.txt', 'b.txt']);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    test('does not mark failed materialization current or create escaped paths', async () => {
        const outsideDir = path.join(
            tmpdir(),
            `sci-overlay-escape-${Date.now()}-${Math.random().toString(16).slice(2)}`
        );
        const snap = overlayStore.createSnapshot(false);
        const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
        (snap as any).diffs.push(
            `diff --git a/../../${path.basename(outsideDir)}/file.txt b/../../${path.basename(outsideDir)}/file.txt\n--- a/../../${path.basename(outsideDir)}/file.txt\n+++ b/../../${path.basename(outsideDir)}/file.txt\n@@ -1 +1 @@\n-old\n+new\n`
        );
        try {
            await expect(ensure(snap.id)).rejects.toThrow('workspace');
            expect(existsSync(path.join(process.cwd(), '.ontology', 'snapshots', snap.id, '.materialized'))).toBe(
                false
            );
            expect(existsSync(outsideDir)).toBe(false);
        } finally {
            rmSync(outsideDir, { recursive: true, force: true });
        }
    }, 30000);

    test('partial snapshot checks preserve staged deletions during build/test directory refill', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-partial-delete-'));
        const previous = process.env.SNAPSHOT_PARTIAL;
        try {
            process.env.SNAPSHOT_PARTIAL = '1';
            await fs.mkdir(path.join(root, 'src'), { recursive: true });
            await fs.writeFile(
                path.join(root, 'package.json'),
                '{"type":"module","scripts":{"build":"test ! -e src/foo.ts"}}\n',
                'utf8'
            );
            await fs.writeFile(path.join(root, 'src', 'foo.ts'), 'export const foo = 1;\n', 'utf8');

            const snap = overlayStore.createSnapshot(false, { workspaceRoot: root });
            const patch = `diff --git a/src/foo.ts b/src/foo.ts\ndeleted file mode 100644\n--- a/src/foo.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const foo = 1;\n`;
            expect(overlayStore.stagePatch(snap.id, patch).accepted).toBe(true);

            const checks = await overlayStore.runChecks(snap.id, ['bun run build'], 30, { workspaceRoot: root });
            expect(checks.ok).toBe(true);
        } finally {
            if (previous === undefined) delete process.env.SNAPSHOT_PARTIAL;
            else process.env.SNAPSHOT_PARTIAL = previous;
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('partial snapshot default checks hydrate needed files and preserve staged deletions', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-partial-default-delete-'));
        const previous = process.env.SNAPSHOT_PARTIAL;
        try {
            process.env.SNAPSHOT_PARTIAL = '1';
            await fs.mkdir(path.join(root, 'src'), { recursive: true });
            await fs.writeFile(
                path.join(root, 'package.json'),
                '{"type":"module","scripts":{"typecheck":"true","build":"test ! -e src/foo.ts"}}\n',
                'utf8'
            );
            await fs.writeFile(path.join(root, 'src', 'foo.ts'), 'export const foo = 1;\n', 'utf8');

            const snap = overlayStore.createSnapshot(false, { workspaceRoot: root });
            const patch = `diff --git a/src/foo.ts b/src/foo.ts\ndeleted file mode 100644\n--- a/src/foo.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-export const foo = 1;\n`;
            expect(overlayStore.stagePatch(snap.id, patch).accepted).toBe(true);

            const checks = await overlayStore.runChecks(snap.id, [], 30, { workspaceRoot: root });
            expect(checks.ok).toBe(true);
            expect(checks.commands.map((cmd) => cmd.command)).toEqual(['bun run typecheck', 'bun run build']);
        } finally {
            if (previous === undefined) delete process.env.SNAPSHOT_PARTIAL;
            else process.env.SNAPSHOT_PARTIAL = previous;
            await fs.rm(root, { recursive: true, force: true });
        }
    }, 30000);

    test('fails closed when workspace changes before lazy snapshot materialization', async () => {
        const rel = `.tmp-overlay-lazy-base-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
        const abs = path.join(process.cwd(), rel);
        const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
        try {
            await fs.writeFile(abs, 'before\n', 'utf8');
            const snap = overlayStore.createSnapshot(false);
            await fs.writeFile(abs, 'after\n', 'utf8');
            await expect(ensure(snap.id)).rejects.toThrow('Workspace changed since snapshot creation');
            expect(existsSync(path.join(process.cwd(), '.ontology', 'snapshots', snap.id, '.materialized'))).toBe(
                false
            );
        } finally {
            rmSync(abs, { force: true });
        }
    }, 30000);

    test('fails closed when workspace changes after checks but before apply', async () => {
        const rel = `.tmp-overlay-apply-base-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
        const abs = path.join(process.cwd(), rel);
        try {
            await fs.writeFile(abs, 'one\n', 'utf8');
            const snap = overlayStore.createSnapshot(false);
            const patch = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-one\n+two\n`;
            expect(overlayStore.stagePatch(snap.id, patch).accepted).toBe(true);
            const checks = await overlayStore.runChecks(snap.id, ['true'], 30);
            expect(checks.ok).toBe(true);

            await fs.writeFile(abs, 'workspace changed\n', 'utf8');
            const applied = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: false });
            expect(applied.ok).toBe(false);
            expect(applied.output).toContain('Workspace changed since snapshot creation before apply');
            expect(await fs.readFile(abs, 'utf8')).toBe('workspace changed\n');
        } finally {
            rmSync(abs, { force: true });
        }
    }, 30000);

    test('reverse apply preflights current touched-file content before rollback', async () => {
        const rel = `.tmp-overlay-reverse-preflight-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`;
        const abs = path.join(process.cwd(), rel);
        try {
            await fs.writeFile(abs, 'one\n', 'utf8');
            const snap = overlayStore.createSnapshot(false);
            const patch = `diff --git a/${rel} b/${rel}\n--- a/${rel}\n+++ b/${rel}\n@@ -1 +1 @@\n-one\n+two\n`;
            expect(overlayStore.stagePatch(snap.id, patch).accepted).toBe(true);
            const applied = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: false });
            expect(applied.ok).toBe(true);

            await fs.writeFile(abs, 'unexpected drift\n', 'utf8');
            const reversed = await overlayStore.applyToWorkingTree(snap.id, { check: false, reverse: true });
            expect(reversed.ok).toBe(false);
            expect(await fs.readFile(abs, 'utf8')).toBe('unexpected drift\n');
        } finally {
            rmSync(abs, { force: true });
        }
    }, 30000);
});
