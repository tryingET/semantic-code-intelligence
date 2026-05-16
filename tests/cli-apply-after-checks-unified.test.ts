import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CLIAdapter } from '../src/adapters/cli-adapter.js';
import { createCodeAnalyzer } from '../src/core/index.js';
import { overlayStore } from '../src/core/overlay-store.js';

function parseJsonMaybe(s: string): any {
    try {
        return JSON.parse(s);
    } catch {
        return {};
    }
}

describe('CLIAdapter propose_patch + run_checks + apply (unified diff)', () => {
    let cli: CLIAdapter;
    // Use a unique temp file to avoid conflicts with parallel tests
    const testId = `cli-unified-${Date.now()}`;
    const targetRel = `tests/fixtures/temp-${testId}.ts`;
    const targetAbs = path.join(process.cwd(), targetRel);
    const marker = '// cli unified apply_after_checks test';

    beforeAll(async () => {
        // Clear overlay store to ensure test isolation
        overlayStore.clearAll();
        // Create a clean temp file for this test
        const templateContent = `/**
 * Temp fixture for cli-apply-after-checks-unified test
 */

export class TestClass {
    private value: number = 0;

    constructor(initialValue?: number) {
        this.value = initialValue ?? 0;
    }
}
`;
        await fs.writeFile(targetAbs, templateContent, 'utf8');
        const analyzer = await createCodeAnalyzer({ workspaceRoot: process.cwd() });
        await (analyzer as any).initialize?.();
        cli = new CLIAdapter(analyzer);
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
    });

    afterAll(async () => {
        // Clean up temp file
        try {
            await fs.unlink(targetAbs);
        } catch {}
        delete process.env.ALLOW_SNAPSHOT_APPLY;
    });

    test('stages unified diff, runs checks and applies to working tree', async () => {
        const before = await fs.readFile(targetAbs, 'utf8');
        const patch = `diff --git a/${targetRel} b/${targetRel}\n--- a/${targetRel}\n+++ b/${targetRel}\n@@ -5,2 +5,3 @@\n export class TestClass {\n+    ${marker}\n     private value: number = 0;\n`;

        // Stage via CLI adapter
        const staged = await cli.handleProposePatch(patch, { json: true, runChecks: false });
        const stagedOut = parseJsonMaybe(String(staged));
        const snapId = String(stagedOut?.snapshot || '');
        expect(stagedOut.accepted).toBe(true);
        expect(snapId.length).toBeGreaterThan(0);

        // Run trivial checks
        const chkStr = await cli.handleRunChecks({ snapshot: snapId, commands: ['true'], json: true });
        const chk = parseJsonMaybe(String(chkStr));
        expect(chk.ok).toBe(true);

        // Apply to working tree using overlay store (CLI has no apply tool)
        const app = await overlayStore.applyToWorkingTree(snapId, { check: false, reverse: false });
        expect(app.ok).toBe(true);
        const afterApply = await fs.readFile(targetAbs, 'utf8');
        expect(afterApply).toContain(marker);
        expect(afterApply).not.toEqual(before);

        // Revert for cleanliness
        const rev = await overlayStore.applyToWorkingTree(snapId, { check: false, reverse: true });
        expect(rev.ok).toBe(true);
        const afterRevert = await fs.readFile(targetAbs, 'utf8');
        expect(afterRevert).toEqual(before);
    }, 30000);
});
