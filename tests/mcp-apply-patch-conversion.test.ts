import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { createDefaultCoreConfig } from '../src/adapters/utils';
import { createCodeAnalyzer } from '../src/core/index';
import { overlayStore } from '../src/core/overlay-store';

async function parseContent(res: any): Promise<any> {
    try {
        const txt = res?.content?.[0]?.text;
        return JSON.parse(txt);
    } catch {
        return res;
    }
}

test('propose_patch accepts apply_patch and produces unified overlay.diff', async () => {
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot: process.cwd() });
    await analyzer.initialize();
    const mcp = new MCPAdapter(analyzer);

    // Create snapshot
    const snapRes = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
    const snapOut = await parseContent(snapRes);
    const snapshot = snapOut?.snapshot || snapOut?.id;
    expect(typeof snapshot).toBe('string');

    // Minimal apply_patch that updates tests/fixtures/example.ts
    const applyPatch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export class TestClass {\n-    private value: number = 0;\n+    /* converted */ private value: number = 0;\n*** End Patch\n`;

    const prop = await mcp.handleToolCall('propose_patch', { snapshot, patch: applyPatch });
    const propOut = await parseContent(prop);
    expect(propOut.accepted).toBe(true);
    expect(propOut.snapshot).toBe(snapshot);

    // Materialize snapshot and read overlay.diff
    const ensure = (overlayStore as any).ensureMaterialized?.bind(overlayStore);
    const dir = ensure ? await ensure(snapshot) : path.join('.ontology', 'snapshots', snapshot);
    const diffPath = path.join(dir, 'overlay.diff');
    const diff = await fs.readFile(diffPath, 'utf8');
    expect(diff).toContain('diff --git a/tests/fixtures/example.ts b/tests/fixtures/example.ts');
    expect(diff).toContain('--- a/tests/fixtures/example.ts');
    expect(diff).toContain('+++ b/tests/fixtures/example.ts');
    expect(diff).toContain('@@');
    expect(diff).toContain('/* converted */ private value: number = 0;');
});
