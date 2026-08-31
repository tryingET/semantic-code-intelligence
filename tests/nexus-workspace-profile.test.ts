import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig } from './test-helpers.js';

const RENAME_TARGET = 'tests/fixtures/nexus-workspace-profile-runtime.ts';
const RENAME_INITIAL = 'export const oldNameNexus = 1;\nconsole.log(oldNameNexus);\n';

function parse(result: any): any {
    const text = result?.content?.[0]?.text;
    return typeof text === 'string' ? JSON.parse(text) : null;
}

describe('Pi Composite NEXUS v1 producer profile', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;
    let workspace: any;

    beforeAll(async () => {
        await writeFile(RENAME_TARGET, RENAME_INITIAL, 'utf8');
        const config = createTestConfig({ workspaceRoot: process.cwd() });
        const shared = new SharedServices(config);
        await shared.initialize();
        const layers = new LayerManager(config, shared.eventBus);
        await layers.initialize();
        analyzer = new CodeAnalyzer(layers, shared, config, shared.eventBus);
        await analyzer.initialize();
        mcp = new MCPAdapter(analyzer, { surface: 'registry' });
        workspace = parse(await mcp.handleValidatedToolCall('get_snapshot', { nexus: true })).workspace;
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
        await rm(RENAME_TARGET, { force: true });
    });

    test('handshake returns one opaque workspace and exact initial snapshot reference', async () => {
        const handshake = parse(await mcp.handleValidatedToolCall('get_snapshot', { nexus: true }));
        expect(handshake.workspace).toEqual(workspace);
        expect(handshake.workspace.workspaceId).toMatch(/^wsp_[0-9a-f]{32}$/);
        expect(handshake.snapshotRef).toMatchObject({
            schema: 'semantic-code-intelligence.snapshot_ref.v1',
            workspaceId: workspace.workspaceId,
            revision: 0,
        });
        expect(JSON.stringify(handshake.workspace)).not.toContain(process.cwd());
    });

    test('rejects a target-repo-relative-looking path in the wrong bound workspace before semantic recovery', async () => {
        const rejected = await mcp.handleValidatedToolCall('explore_symbol_impact', {
            symbol: 'OpenDeckRuntime',
            file: 'runtime/opendeck-ai-intent-console/definitely-missing.ts',
            workspace,
        });
        expect(rejected.isError).toBe(true);
        expect(rejected.error?.data?.reason).toBe('workspace_path_unresolved');
        expect(JSON.stringify(rejected)).not.toContain(process.cwd());
    });

    test('preserves workspace and state across explore to locate recovery/confirmation', async () => {
        const explored = parse(
            await mcp.handleValidatedToolCall('explore_symbol_impact', {
                symbol: 'locateConfirmDefinition',
                file: 'src/core/workflows/symbol-workflow.ts',
                workspace,
                mode: 'compact',
            })
        );
        expect(explored.workspace).toEqual(workspace);
        expect(explored.state).toMatchObject({
            schema: 'semantic-code-intelligence.workspace_state_ref.v1',
            workspaceId: workspace.workspaceId,
        });
        expect(explored.status).toBe('confirmed');
        expect(explored.definition.pathRef).toMatchObject({
            schema: 'semantic-code-intelligence.workspace_path_ref.v1',
            workspaceId: workspace.workspaceId,
            path: 'src/core/workflows/symbol-workflow.ts',
        });

        const located = parse(
            await mcp.handleValidatedToolCall('locate_confirm_definition', {
                symbol: 'locateConfirmDefinition',
                file: 'src/core/workflows/symbol-workflow.ts',
                workspace,
                state: explored.state,
            })
        );
        expect(located.ok).toBe(true);
        expect(located.workspace).toEqual(workspace);
        expect(located.state).toEqual(explored.state);
        expect(located.definitions[0].pathRef).toMatchObject({
            workspaceId: workspace.workspaceId,
            path: 'src/core/workflows/symbol-workflow.ts',
        });
    }, 30_000);

    test('returns exact snapshot/check lineage for patch preview', async () => {
        const patch = [
            'diff --git a/tests/fixtures/example.ts b/tests/fixtures/example.ts',
            '--- a/tests/fixtures/example.ts',
            '+++ b/tests/fixtures/example.ts',
            '@@ -4,3 +4,3 @@',
            ' ',
            '-export class TestClass {',
            '+export class TestClassNexusPatch {',
            '     // mcp unified apply_after_checks test',
            '',
        ].join('\n');
        const result = parse(
            await mcp.handleValidatedToolCall('patch_checks_in_snapshot', {
                patch,
                commands: ['true'],
                workspace,
            })
        );
        expect(result.ok).toBe(true);
        expect(result.workspace).toEqual(workspace);
        expect(result.snapshotRef).toMatchObject({ workspaceId: workspace.workspaceId, revision: 1 });
        expect(result.checks.receipt).toMatchObject({
            workspaceId: workspace.workspaceId,
            revision: result.snapshotRef.revision,
            ok: true,
        });
    }, 30_000);

    test('returns exact preview lineage for rename and structural doors without working-tree writes', async () => {
        const renamed = parse(
            await mcp.handleValidatedToolCall('rename_safely', {
                oldName: 'locateConfirmDefinition',
                newName: 'locateConfirmDefinitionNexusPreview',
                file: 'src/core/workflows/symbol-workflow.ts',
                runChecks: false,
                workspace,
            })
        );
        expect(renamed.ok).toBe(false);
        expect(renamed.reason).toBe('plan_failed');
        expect(renamed.workspace).toEqual(workspace);
        expect(renamed.snapshotRef).toMatchObject({ workspaceId: workspace.workspaceId, revision: 0 });

        const structural = parse(
            await mcp.handleValidatedToolCall('structural_patch_checks', {
                language: 'ts',
                pattern: 'const $A = $B',
                rewrite: 'let $A = $B',
                paths: [RENAME_TARGET],
                commands: ['true'],
                apply: false,
                workspace,
            })
        );
        expect(structural.ok).toBe(true);
        expect(structural.workspace).toEqual(workspace);
        expect(structural.snapshotRef).toMatchObject({ workspaceId: workspace.workspaceId, revision: 1 });
        expect(structural.applied).toBe(false);
    }, 60_000);
});
