import { describe, expect, test } from 'bun:test';
import { existsSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { overlayStore } from '../src/core/overlay-store.js';

describe('OverlayStore runChecks evidence receipts', () => {
    test('preferExisting reuses only clean base snapshots, not staged preview snapshots', async () => {
        const clean = overlayStore.createSnapshot(false);
        await Bun.sleep(5);
        const dirty = overlayStore.createSnapshot(false);
        const staged = overlayStore.stagePatch(
            dirty.id,
            `diff --git a/docs/project/alpha-mvp-contract.md b/docs/project/alpha-mvp-contract.md
--- a/docs/project/alpha-mvp-contract.md
+++ b/docs/project/alpha-mvp-contract.md
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+<!-- prefer-existing-regression-marker -->
`
        );
        expect(staged.accepted).toBe(true);
        expect(dirty.diffs.length).toBe(1);

        overlayStore.clearAll();
        const reused = overlayStore.createSnapshot(true);

        expect(reused.id).not.toBe(dirty.id);
        expect(reused.diffs.length).toBe(0);
        expect(reused.baseFingerprint).toBe(clean.baseFingerprint);
    });

    test('configured-workspace snapshots reload by id with explicit workspace root after memory is cleared', async () => {
        const workspace = path.join(tmpdir(), `sci-snapshot-reload-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(workspace, { recursive: true });
        try {
            const snap = overlayStore.createSnapshot(false, { workspaceRoot: workspace });
            const expectedDir = path.join(workspace, '.ontology', 'snapshots', snap.id);
            expect(overlayStore.getSnapshotDirectory(snap.id, { workspaceRoot: workspace })).toBe(expectedDir);

            overlayStore.clearAll();

            const reloaded = overlayStore.ensureSnapshot(snap.id, { workspaceRoot: workspace });
            expect(reloaded.id).toBe(snap.id);
            expect(reloaded.workspaceRoot).toBe(path.resolve(workspace));
            expect(overlayStore.getSnapshotDirectory(snap.id, { workspaceRoot: workspace })).toBe(expectedDir);
        } finally {
            overlayStore.clearAll();
            await rm(workspace, { recursive: true, force: true });
        }
    });

    test('configured-workspace lookups reject in-memory snapshots from another workspace', async () => {
        const workspaceA = path.join(tmpdir(), `sci-snapshot-a-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const workspaceB = path.join(tmpdir(), `sci-snapshot-b-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        await mkdir(workspaceA, { recursive: true });
        await mkdir(workspaceB, { recursive: true });
        try {
            const snapA = overlayStore.createSnapshot(false, { workspaceRoot: workspaceA });

            expect(() => overlayStore.ensureSnapshot(snapA.id, { workspaceRoot: workspaceB })).toThrow('Unknown snapshot id');
            await expect(overlayStore.runChecks(snapA.id, ['true'], 30, { workspaceRoot: workspaceB })).rejects.toThrow('Unknown snapshot id');
        } finally {
            overlayStore.clearAll();
            await rm(workspaceA, { recursive: true, force: true });
            await rm(workspaceB, { recursive: true, force: true });
        }
    });

    test('snapshot materialization treats metacharacter workspace paths as data, not shell syntax', async () => {
        const markerName = `sci-shell-marker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const marker = path.join(tmpdir(), markerName);
        const workspace = path.join(tmpdir(), `sci-$(touch\${IFS}`, 'tmp', `${markerName})`);
        try {
            await rm(marker, { force: true });
            await mkdir(workspace, { recursive: true });
            writeFileSync(path.join(workspace, 'sample.txt'), 'before\n', 'utf8');
            const snap = overlayStore.createSnapshot(false, { workspaceRoot: workspace });
            const staged = overlayStore.stagePatch(
                snap.id,
                `diff --git a/sample.txt b/sample.txt
--- a/sample.txt
+++ b/sample.txt
@@ -1 +1 @@
-before
+after
`
            );
            expect(staged.accepted).toBe(true);

            const result = await overlayStore.runChecks(snap.id, ['true'], 30, { workspaceRoot: workspace });

            expect(result.ok).toBe(true);
            expect(existsSync(marker)).toBe(false);
        } finally {
            overlayStore.clearAll();
            await rm(workspace, { recursive: true, force: true });
            await rm(path.dirname(path.dirname(workspace)), { recursive: true, force: true }).catch(() => undefined);
            await rm(marker, { force: true });
        }
    }, 30000);

    test('runChecks command side effects do not mutate reusable materialized snapshots', async () => {
        const snap = overlayStore.createSnapshot(false);
        const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
        expect(typeof ensure).toBe('function');

        const beforeDir = await ensure(snap.id);
        const result = await overlayStore.runChecks(snap.id, ['bash -lc "echo leaked > .reuse-leak"'], 30);
        const afterDir = await ensure(snap.id);

        expect(result.ok).toBe(true);
        expect(afterDir).toBe(beforeDir);
        expect(existsSync(path.join(afterDir, '.reuse-leak'))).toBe(false);
    });

    test('cleanup removes stale disposable check workspaces', async () => {
        const snap = overlayStore.createSnapshot(false);
        const checkDir = path.join(process.cwd(), '.ontology', 'snapshots', `.${snap.id}.1.1.00000000-0000-4000-8000-000000000000.check`);
        await mkdir(checkDir, { recursive: true });
        await utimes(checkDir, new Date(0), new Date(0));

        const cleanupTransient = (overlayStore as any).cleanupTransientCheckWorkspaces?.bind(overlayStore);
        expect(typeof cleanupTransient).toBe('function');
        await cleanupTransient(path.join(process.cwd(), '.ontology', 'snapshots'), Date.now(), 60_000);

        expect(existsSync(checkDir)).toBe(false);
    });

    test('cleanup removes stale transient materialization workspaces without deleting fresh or foreign entries', async () => {
        const snap = overlayStore.createSnapshot(false);
        const snapsRoot = path.join(process.cwd(), '.ontology', 'snapshots');
        const staleTmp = path.join(snapsRoot, `.${snap.id}.1.1.tmp`);
        const staleOld = path.join(snapsRoot, `.${snap.id}.1.2.old`);
        const freshTmp = path.join(snapsRoot, `.${snap.id}.1.3.tmp`);
        const foreignDir = path.join(snapsRoot, '.not-a-snapshot.1.tmp');
        const validLookingFile = path.join(snapsRoot, `.${snap.id}.1.4.tmp`);

        await mkdir(staleTmp, { recursive: true });
        await mkdir(staleOld, { recursive: true });
        await mkdir(freshTmp, { recursive: true });
        await mkdir(foreignDir, { recursive: true });
        await writeFile(validLookingFile, 'not a directory', 'utf8');
        await utimes(staleTmp, new Date(0), new Date(0));
        await utimes(staleOld, new Date(0), new Date(0));
        await utimes(foreignDir, new Date(0), new Date(0));

        const cleanupTransient = (overlayStore as any).cleanupTransientSnapshotWorkspaces?.bind(overlayStore);
        expect(typeof cleanupTransient).toBe('function');
        await cleanupTransient(snapsRoot, Date.now(), 60_000);

        expect(existsSync(staleTmp)).toBe(false);
        expect(existsSync(staleOld)).toBe(false);
        expect(existsSync(freshTmp)).toBe(true);
        expect(existsSync(foreignDir)).toBe(true);
        expect(existsSync(validLookingFile)).toBe(true);

        await rm(freshTmp, { recursive: true, force: true });
        await rm(foreignDir, { recursive: true, force: true });
        await rm(validLookingFile, { force: true });
    });

    test('cleanup tolerates transient deletion failures without throwing', async () => {
        const snap = overlayStore.createSnapshot(false);
        const snapsRoot = path.join(process.cwd(), '.ontology', 'snapshots', `cleanup-permission-${Date.now()}`);
        const staleTmp = path.join(snapsRoot, `.${snap.id}.1.1.tmp`);
        await mkdir(staleTmp, { recursive: true });
        await utimes(staleTmp, new Date(0), new Date(0));

        const cleanupTransient = (overlayStore as any).cleanupTransientSnapshotWorkspaces?.bind(overlayStore);
        expect(typeof cleanupTransient).toBe('function');
        try {
            await chmod(snapsRoot, 0o555);
            await cleanupTransient(snapsRoot, Date.now(), 60_000);
        } finally {
            await chmod(snapsRoot, 0o755).catch(() => undefined);
            await rm(snapsRoot, { recursive: true, force: true });
        }
    });

    test('cleanup removes stale materialization locks without deleting fresh or foreign entries', async () => {
        const staleSnap = overlayStore.createSnapshot(false);
        const freshSnap = overlayStore.createSnapshot(false);
        const fileSnap = overlayStore.createSnapshot(false);
        const snapsRoot = path.join(process.cwd(), '.ontology', 'snapshots');
        const staleLock = path.join(snapsRoot, `${staleSnap.id}.lock`);
        const freshLock = path.join(snapsRoot, `${freshSnap.id}.lock`);
        const foreignLock = path.join(snapsRoot, 'not-a-snapshot.lock');
        const validLookingLockFile = path.join(snapsRoot, `${fileSnap.id}.lock`);

        await mkdir(staleLock, { recursive: true });
        await mkdir(freshLock, { recursive: true });
        await mkdir(foreignLock, { recursive: true });
        await writeFile(validLookingLockFile, 'not a directory', 'utf8');
        await utimes(staleLock, new Date(0), new Date(0));
        await utimes(foreignLock, new Date(0), new Date(0));

        const cleanupLocks = (overlayStore as any).cleanupMaterializeLockWorkspaces?.bind(overlayStore);
        expect(typeof cleanupLocks).toBe('function');
        await cleanupLocks(snapsRoot, Date.now(), 60_000);

        expect(existsSync(staleLock)).toBe(false);
        expect(existsSync(freshLock)).toBe(true);
        expect(existsSync(foreignLock)).toBe(true);
        expect(existsSync(validLookingLockFile)).toBe(true);

        await rm(freshLock, { recursive: true, force: true });
        await rm(foreignLock, { recursive: true, force: true });
        await rm(validLookingLockFile, { force: true });
    });

    test('workspace fingerprint changes when untracked files beyond content-hash cap change', async () => {
        const dir = path.join(process.cwd(), `.tmp-untracked-cap-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        try {
            await mkdir(dir, { recursive: true });
            for (let i = 0; i < 1001; i++) {
                await writeFile(path.join(dir, `${String(i).padStart(4, '0')}.txt`), `initial ${i}\n`, 'utf8');
            }
            const before = overlayStore.createSnapshot(false).baseFingerprint;
            const overflowPath = path.join(dir, '1000.txt');
            await writeFile(overflowPath, 'changed overflow file\n', 'utf8');
            await utimes(overflowPath, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
            const after = overlayStore.createSnapshot(false).baseFingerprint;
            expect(after).not.toBe(before);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 30000);

    test('runs shell-style quoted commands and records receipts', async () => {
        const snap = overlayStore.createSnapshot(false);
        const result = await overlayStore.runChecks(snap.id, ['bash -lc "exit 0"'], 30);

        expect(result.ok).toBe(true);
        expect(result.commands[0]).toMatchObject({
            command: 'bash -lc "exit 0"',
            ok: true,
            exitCode: 0,
            timedOut: false,
        });
    });

    test('caps noisy command output while preserving failure receipts', async () => {
        const snap = overlayStore.createSnapshot(false);
        const result = await overlayStore.runChecks(snap.id, ['yes'], 1);

        expect(result.ok).toBe(false);
        expect(result.output).toContain('[output truncated at');
        expect(Buffer.byteLength(result.output, 'utf8')).toBeLessThan(1024 * 1024 + 128);
        expect(result.commands[0]).toMatchObject({ command: 'yes', ok: false, timedOut: true });
    }, 5000);

    test('timeout kills shell descendant processes', async () => {
        const marker = path.join(tmpdir(), `sci-runchecks-leak-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        try {
            await rm(marker, { force: true });
            const snap = overlayStore.createSnapshot(false);
            const command = `bash -lc "sh -c 'sleep 2; echo leaked > ${JSON.stringify(marker)}' & wait"`;
            const result = await overlayStore.runChecks(snap.id, [command], 1);
            expect(result.ok).toBe(false);
            expect(result.commands[0].timedOut).toBe(true);
            await Bun.sleep(2500);
            expect(existsSync(marker)).toBe(false);
        } finally {
            await rm(marker, { force: true });
        }
    }, 8000);
});
