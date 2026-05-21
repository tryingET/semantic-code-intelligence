import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
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
