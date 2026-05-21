import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
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
});
