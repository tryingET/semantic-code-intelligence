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

    test('persists dry-run apply status across snapshot reloads', async () => {
        const snap = overlayStore.createSnapshot(false);
        const patch = `diff --git a/${targetRel} b/${targetRel}\n--- a/${targetRel}\n+++ b/${targetRel}\n@@ -5,2 +5,3 @@\n export class TestClass {\n+${marker}\n     private value: number = 0;\n`;
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

    test('partial snapshot checks preserve staged deletions during build/test directory refill', async () => {
        const root = await fs.mkdtemp(path.join(tmpdir(), 'sci-overlay-partial-delete-'));
        const previous = process.env.SNAPSHOT_PARTIAL;
        try {
            process.env.SNAPSHOT_PARTIAL = '1';
            await fs.mkdir(path.join(root, 'src'), { recursive: true });
            await fs.writeFile(path.join(root, 'package.json'), '{"type":"module","scripts":{"build":"test ! -e src/foo.ts"}}\n', 'utf8');
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
            await fs.writeFile(path.join(root, 'package.json'), '{"type":"module","scripts":{"typecheck":"true","build":"test ! -e src/foo.ts"}}\n', 'utf8');
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
            expect(existsSync(path.join(process.cwd(), '.ontology', 'snapshots', snap.id, '.materialized'))).toBe(false);
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
