import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig, toFileUri } from './test-helpers';

async function parseContent(res: any): Promise<any> {
    const txt = res?.content?.[0]?.text;
    if (!txt) return null;
    try {
        return JSON.parse(txt);
    } catch {
        return txt;
    }
}

describe('Dogfooding MCP workflows (fast)', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;

    const testFile = toFileUri('tests/fixtures/example.ts');

    beforeAll(async () => {
        const config = createTestConfig({ workspaceRoot: process.cwd() });
        const shared = new SharedServices(config);
        await shared.initialize();
        const lm = new LayerManager(config, shared.eventBus);
        await lm.initialize();
        analyzer = new CodeAnalyzer(lm, shared, config, shared.eventBus);
        await analyzer.initialize();
        mcp = new MCPAdapter(analyzer, { surface: 'registry' });
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('explore_codebase conceptual=false and conceptual=true', async () => {
        const off = await mcp.handleToolCall('explore_codebase', {
            symbol: 'TestClass',
            file: testFile,
            conceptual: false,
        });
        const offParsed = await parseContent(off);
        expect(offParsed).toBeDefined();
        expect(offParsed.symbol).toBeDefined();

        const on = await mcp.handleToolCall('explore_codebase', {
            symbol: 'TestClass',
            file: testFile,
            conceptual: true,
        });
        const onParsed = await parseContent(on);
        expect(onParsed).toBeDefined();
        expect(onParsed.symbol).toBeDefined();
    }, 30000);

    test('plan_rename rejects when the test harness has no AST-safe rename evidence', async () => {
        const plan = await mcp.handleToolCall('plan_rename', {
            oldName: 'TestFunction',
            newName: 'TestFunctionX',
            file: testFile,
            dryRun: true,
        });
        const planParsed = await parseContent(plan);
        expect(plan.isError).toBe(true);
        expect(plan.error?.code).toBe('RENAME_ERROR');
        expect(String(plan.error?.message || planParsed)).toContain('AST-validated rename targets');
    }, 30000);

    test('graph_expand via MCP (file + symbol)', async () => {
        // file-based imports/exports/callees
        const fileRes = await mcp.handleToolCall('graph_expand', {
            file: 'tests/fixtures/example.ts',
            edges: ['imports', 'exports', 'callees'],
            limit: 20,
        });
        const fileParsed = await parseContent(fileRes);
        expect(fileParsed).toBeDefined();
        expect(fileParsed.neighbors).toBeDefined();
        expect(fileParsed.neighbors.imports).toBeDefined();
        expect(fileParsed.neighbors.exports).toBeDefined();

        // symbol-based callers (best-effort via grep+AST)
        const symRes = await mcp.handleToolCall('graph_expand', {
            symbol: 'TestFunction',
            edges: ['callers'],
            limit: 20,
        });
        const symParsed = await parseContent(symRes);
        expect(symParsed).toBeDefined();
        expect(symParsed.neighbors).toBeDefined();
        expect(symParsed.neighbors.callers).toBeDefined();
    }, 30000);

    test('stage small patch (no checks)', async () => {
        const snap = await mcp.handleToolCall('get_snapshot', { preferExisting: true });
        const snapParsed = await parseContent(snap);
        const snapshotId = snapParsed?.id || snapParsed?.snapshot || snapParsed;
        expect(snapshotId).toBeDefined();

        const patch = [
            '*** Begin Patch',
            '*** Update File: tests/fixtures/example.ts',
            '@@',
            ' export class TestClass {',
            '     // mcp unified apply_after_checks test',
            '+    // dogfood: noop comment for stage-only',
            '     private value: number = 0;',
            '*** End Patch',
            '',
        ].join('\n');
        const stage = await mcp.handleToolCall('propose_patch', { snapshot: snapshotId, patch });
        const stageParsed = await parseContent(stage);
        expect(stageParsed).toBeDefined();
        expect(stageParsed.accepted).toBe(true);
    }, 30000);
});
