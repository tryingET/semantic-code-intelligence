import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig, toFileUri } from './test-helpers';

async function parse(res: any) {
    const txt = res?.content?.[0]?.text;
    try {
        return JSON.parse(txt);
    } catch {
        return null;
    }
}

describe('MCP workflows GA shapes', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;
    const file = toFileUri('tests/fixtures/example.ts');

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

    test('locate_confirm_definition: predictable shape', async () => {
        const res = await mcp.handleToolCall('locate_confirm_definition', { symbol: 'TestClass', file });
        const obj = await parse(res);
        expect(obj.workflow).toBe('locate_confirm_definition');
        expect(typeof obj.ok).toBe('boolean');
        expect(Array.isArray(obj.attempts)).toBe(true);
        expect(Array.isArray(obj.definitions)).toBe(true);
    }, 30000);

    test('rename_safely (runChecks=false): predictable shape', async () => {
        const res = await mcp.handleToolCall('rename_safely', {
            oldName: 'TestFunction',
            newName: 'TestFunctionXX',
            file,
            runChecks: false,
        });
        const obj = await parse(res);
        expect(obj.workflow).toBe('rename_safely');
        expect(obj.snapshot).toBeTruthy();
        expect(typeof obj.ok).toBe('boolean');
        expect(Array.isArray(obj.next_actions)).toBe(true);
    }, 30000);

    test('patch_checks_in_snapshot: predictable shape (no-op cmd)', async () => {
        const patch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export class TestClass {\n-    private value: number = 0;\n+    private value: number = 0; // ga\n*** End Patch\n`;
        const res = await mcp.handleToolCall('patch_checks_in_snapshot', { patch, commands: ['true'] });
        const obj = await parse(res);
        expect(obj.workflow).toBe('patch_checks_in_snapshot');
        expect(typeof obj.ok).toBe('boolean');
        expect(obj.snapshot).toBeTruthy();
        expect(obj.stage).toBeTruthy();
        expect(obj.checks).toBeTruthy();
    }, 30000);
});
