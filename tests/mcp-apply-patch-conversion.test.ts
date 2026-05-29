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

    // Minimal apply_patch that updates tests/fixtures/example.ts using current fixture context.
    const applyPatch = [
        '*** Begin Patch',
        '*** Update File: tests/fixtures/example.ts',
        '@@',
        ' export class TestClass {',
        '     // mcp unified apply_after_checks test',
        '-    private value: number = 0;',
        '+    /* converted */ private value: number = 0;',
        ' ',
        '     constructor(initialValue?: number) {',
        '*** End Patch',
        '',
    ].join('\n');

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
    expect(diff).toContain('@@ -5,5 +5,5 @@');
    expect(diff).toContain('/* converted */ private value: number = 0;');
});

test('propose_patch rejects stale apply_patch hunks before accepting invalid overlay diffs', async () => {
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot: process.cwd() });
    await analyzer.initialize();
    const mcp = new MCPAdapter(analyzer);

    const snapRes = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
    const snapOut = await parseContent(snapRes);
    const snapshot = snapOut?.snapshot || snapOut?.id;
    const stalePatch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export class TestClass {\n-    private missingValue: number = 0;\n+    /* stale */ private missingValue: number = 0;\n*** End Patch\n`;

    const prop = await mcp.handleToolCall('propose_patch', { snapshot, patch: stalePatch });
    const propOut = await parseContent(prop);

    expect(prop.isError).toBe(true);
    expect(propOut.accepted).toBe(false);
    expect(propOut.reason).toBe('invalid_patch');
    expect(String(propOut.message || '')).toContain('apply_patch hunk did not match');
    await analyzer.dispose?.();
});

test('propose_patch rejects sparse apply_patch hunks when changed lines are ambiguous', async () => {
    const fixture = path.join(process.cwd(), 'tests/fixtures/temp-ambiguous-apply-patch.ts');
    await fs.writeFile(fixture, ['export const repeated = 1;', 'export const repeated = 1;', ''].join('\n'), 'utf8');
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot: process.cwd() });
    await analyzer.initialize();
    try {
        const mcp = new MCPAdapter(analyzer);
        const snapRes = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
        const snapOut = await parseContent(snapRes);
        const snapshot = snapOut?.snapshot || snapOut?.id;
        const ambiguousPatch = `*** Begin Patch\n*** Update File: tests/fixtures/temp-ambiguous-apply-patch.ts\n@@\n missing context\n-export const repeated = 1;\n+export const repeated = 2;\n*** End Patch\n`;

        const prop = await mcp.handleToolCall('propose_patch', { snapshot, patch: ambiguousPatch });
        const propOut = await parseContent(prop);

        expect(prop.isError).toBe(true);
        expect(propOut.accepted).toBe(false);
        expect(propOut.reason).toBe('invalid_patch');
        expect(String(propOut.message || '')).toContain('apply_patch hunk is ambiguous');
    } finally {
        await analyzer.dispose?.();
        await fs.rm(fixture, { force: true });
    }
});

test('propose_patch rejects full-context apply_patch hunks when old context is ambiguous', async () => {
    const fixture = path.join(process.cwd(), 'tests/fixtures/temp-ambiguous-full-context-apply-patch.ts');
    await fs.writeFile(
        fixture,
        ['function duplicate() {', '  return 1;', '}', 'function duplicate() {', '  return 1;', '}', ''].join('\n'),
        'utf8'
    );
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot: process.cwd() });
    await analyzer.initialize();
    try {
        const mcp = new MCPAdapter(analyzer);
        const snapRes = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
        const snapOut = await parseContent(snapRes);
        const snapshot = snapOut?.snapshot || snapOut?.id;
        const ambiguousPatch = `*** Begin Patch\n*** Update File: tests/fixtures/temp-ambiguous-full-context-apply-patch.ts\n@@\n function duplicate() {\n-  return 1;\n+  return 2;\n}\n*** End Patch\n`;

        const prop = await mcp.handleToolCall('propose_patch', { snapshot, patch: ambiguousPatch });
        const propOut = await parseContent(prop);

        expect(prop.isError).toBe(true);
        expect(propOut.accepted).toBe(false);
        expect(propOut.reason).toBe('invalid_patch');
        expect(String(propOut.message || '')).toContain('apply_patch hunk is ambiguous');
    } finally {
        await analyzer.dispose?.();
        await fs.rm(fixture, { force: true });
    }
});
