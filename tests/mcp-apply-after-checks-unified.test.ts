import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { createCodeAnalyzer } from '../src/core/index.js';

function unwrap(result: any): any {
    try {
        const txt = result?.content?.[0]?.text;
        return txt ? JSON.parse(txt) : result;
    } catch {
        return result;
    }
}

describe('MCP apply_after_checks with unified diff (applied=true)', () => {
    let mcp: MCPAdapter;
    const targetRel = 'tests/fixtures/example.ts';
    const targetAbs = path.join(process.cwd(), targetRel);
    const marker = '// mcp unified apply_after_checks second marker';

    beforeAll(async () => {
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        const analyzer = await createCodeAnalyzer({ workspaceRoot: process.cwd() });
        await (analyzer as any).initialize?.();
        mcp = new MCPAdapter(analyzer, { surface: 'registry' });
    });

    afterAll(async () => {
        delete process.env.ALLOW_SNAPSHOT_APPLY;
    });

    test('modifies existing file and reverts it', async () => {
        const before = await fs.readFile(targetAbs, 'utf8');
        const patch = [
            `diff --git a/${targetRel} b/${targetRel}`,
            `--- a/${targetRel}`,
            `+++ b/${targetRel}`,
            '@@ -5,3 +5,4 @@',
            ' export class TestClass {',
            '     // mcp unified apply_after_checks test',
            `+    ${marker}`,
            '     private value: number = 0;',
            '',
        ].join('\n');

        const res = await mcp.handleToolCall('apply_after_checks', {
            patch,
            commands: ['true'],
            timeoutSec: 60,
        });
        const out = unwrap(res);
        expect(out).toBeDefined();
        expect(out.ok).toBe(true);
        expect(out.applied).toBe(true);
        const snapId = String(out.snapshot || '');
        expect(snapId.length).toBeGreaterThan(0);
        // Verify file content changed
        const afterApply = await fs.readFile(targetAbs, 'utf8');
        expect(afterApply).toContain(marker);
        expect(afterApply).not.toEqual(before);

        // Revert
        const rev = await mcp.handleToolCall('apply_snapshot', { snapshot: snapId, reverse: true });
        const revOut = unwrap(rev);
        if (typeof revOut === 'object' && revOut !== null && 'ok' in revOut) {
            expect(revOut.ok).toBe(true);
        }
        const afterRevert = await fs.readFile(targetAbs, 'utf8');
        expect(afterRevert).toEqual(before);
    }, 30000);
});
