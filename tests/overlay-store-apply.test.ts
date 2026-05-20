import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { overlayStore } from '../src/core/overlay-store.js';

describe('OverlayStore applyToWorkingTree with unified diff', () => {
    const targetRel = 'tests/fixtures/example.ts';
    const targetAbs = path.join(process.cwd(), targetRel);
    const marker = '// overlay unified add';

    beforeAll(async () => {});

    afterAll(async () => {});

    test('adds new file and reverts via reverse apply', async () => {
        const before = await fs.readFile(targetAbs, 'utf8');
        const snap = overlayStore.createSnapshot(false);
        const patch = `diff --git a/${targetRel} b/${targetRel}\n--- a/${targetRel}\n+++ b/${targetRel}\n@@ -5,2 +5,3 @@\n export class TestClass {\n+${marker}\n     private value: number = 0;\n`;
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

    test('does not mark failed materialization current or create escaped paths', async () => {
        const outsideDir = path.join(tmpdir(), `sci-overlay-escape-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        const snap = overlayStore.createSnapshot(false);
        const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
        (snap as any).diffs.push(
            `diff --git a/../../${path.basename(outsideDir)}/file.txt b/../../${path.basename(outsideDir)}/file.txt\n--- a/../../${path.basename(outsideDir)}/file.txt\n+++ b/../../${path.basename(outsideDir)}/file.txt\n@@ -1 +1 @@\n-old\n+new\n`
        );
        try {
            await expect(ensure(snap.id)).rejects.toThrow('workspace');
            expect(existsSync(path.join(process.cwd(), '.ontology', 'snapshots', snap.id, '.materialized'))).toBe(false);
            expect(existsSync(outsideDir)).toBe(false);
        } finally {
            rmSync(outsideDir, { recursive: true, force: true });
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
            expect(existsSync(path.join(process.cwd(), '.ontology', 'snapshots', snap.id, '.materialized'))).toBe(false);
        } finally {
            rmSync(abs, { force: true });
        }
    }, 30000);
});
