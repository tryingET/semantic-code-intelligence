import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import {
    WORKSPACE_BOUNDARY_MESSAGE,
    WORKSPACE_BOUNDARY_REASON,
    WORKSPACE_BOUNDARY_REMEDIATION,
} from '../src/core/errors.js';
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

    test('definition calls expose bounded workspace errors without changing contained or no-definition outcomes', async () => {
        const containedFiles = ['tests/fixtures/example.ts', join(process.cwd(), 'tests/fixtures/example.ts')];
        for (const containedFile of containedFiles) {
            const direct = await mcp.handleValidatedToolCall('find_definition', {
                symbol: 'TestClass',
                file: containedFile,
            });
            expect(direct.isError).toBe(false);
            expect(await parse(direct)).toMatchObject({ count: 1, definitions: [{ name: 'TestClass' }] });

            const located = await mcp.handleValidatedToolCall('locate_confirm_definition', {
                symbol: 'TestClass',
                file: containedFile,
            });
            expect(located.isError).toBe(false);
            expect(await parse(located)).toMatchObject({ ok: true, definitions: [{ name: 'TestClass' }] });
        }

        const missingDirect = await mcp.handleValidatedToolCall('find_definition', {
            symbol: 'MissingForAk4862',
            file: 'tests/fixtures/example.ts',
        });
        expect(missingDirect.isError).toBe(false);
        expect(await parse(missingDirect)).toMatchObject({ count: 0, definitions: [] });

        const missingLocate = await mcp.handleValidatedToolCall('locate_confirm_definition', {
            symbol: 'MissingForAk4862',
            file: 'tests/fixtures/example.ts',
        });
        expect(missingLocate.isError).toBe(false);
        expect(await parse(missingLocate)).toMatchObject({ ok: false, definitions: [] });

        const outsidePath = join(process.cwd(), '..', 'ak4862-outside.ts');
        for (const tool of ['find_definition', 'locate_confirm_definition']) {
            const rejected = await mcp.handleValidatedToolCall(tool, {
                symbol: 'TestClass',
                file: outsidePath,
            });
            expect(rejected.isError).toBe(true);
            expect(rejected.content?.[0]?.text).toBe(WORKSPACE_BOUNDARY_MESSAGE);
            expect(rejected.error).toMatchObject({
                code: 'InvalidParams',
                message: WORKSPACE_BOUNDARY_MESSAGE,
                data: {
                    reason: WORKSPACE_BOUNDARY_REASON,
                    remediation: WORKSPACE_BOUNDARY_REMEDIATION,
                },
            });
            const serialized = JSON.stringify(rejected);
            expect(serialized).not.toContain(outsidePath);
            expect(serialized).not.toContain(process.cwd());
            expect(serialized).not.toContain('stack');
            expect(serialized).not.toContain('cause');
        }
    }, 30000);

    test('explore_symbol_impact: compact, standard, and debug preserve MCP parity', async () => {
        const results = new Map<string, any>();
        const impactFile = toFileUri('src/adapters/mcp-adapter.ts');
        for (const mode of ['compact', 'standard', 'debug']) {
            const res = await mcp.handleToolCall('explore_symbol_impact', {
                symbol: 'handleToolCall',
                file: impactFile,
                precise: true,
                depth: 1,
                limit: 10,
                mode,
            });
            const obj = await parse(res);
            expect(obj).toMatchObject({ workflow: 'explore_symbol_impact', ok: true, status: 'confirmed' });
            results.set(mode, obj);
        }

        expect(results.get('compact').details).toBe('mode: standard');
        expect(results.get('standard').details).toMatchObject({
            schemaVersion: 2,
            mode: 'standard',
            evidence: { graph: { observedImpact: true, usableImpact: true } },
        });
        expect(results.get('standard').details).not.toHaveProperty('counts');
        expect(results.get('standard').details).not.toHaveProperty('diagnostics');
        expect(results.get('debug').details.mode).toBe('debug');
        expect(results.get('debug').details.diagnostics.subcalls).toHaveLength(3);
        expect(results.get('debug').definition).toEqual(results.get('standard').definition);
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
        const patch = [
            '*** Begin Patch',
            '*** Update File: tests/fixtures/example.ts',
            '@@',
            ' export class TestClass {',
            '     // mcp unified apply_after_checks test',
            '+    // ga',
            '     private value: number = 0;',
            '*** End Patch',
            '',
        ].join('\n');
        const res = await mcp.handleToolCall('patch_checks_in_snapshot', { patch, commands: ['true'] });
        const obj = await parse(res);
        expect(obj.workflow).toBe('patch_checks_in_snapshot');
        expect(typeof obj.ok).toBe('boolean');
        expect(obj.snapshot).toBeTruthy();
        expect(obj.stage).toBeTruthy();
        expect(obj.checks).toBeTruthy();
    }, 30000);
});
