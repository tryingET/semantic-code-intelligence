import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
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
});
