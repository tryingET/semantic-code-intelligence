import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { LayerManager } from '../src/core/layer-manager';
import { SharedServices } from '../src/core/services';
import { CodeAnalyzer } from '../src/core/unified-analyzer';
import { createTestConfig } from './test-helpers';

const hasAstGrep = spawnSync('bash', ['-lc', 'command -v ast-grep >/dev/null 2>&1'], { stdio: 'ignore' }).status === 0;
const structuralTest = hasAstGrep ? test : test.skip;

const patchPlanningMarker = '<!-- alpha patch-planning parity snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
`;
const alphaPerCallBudgetMs = 15_000;

async function parseContent(res: any): Promise<any> {
    const txt = res?.content?.[0]?.text;
    expect(txt).toBeDefined();
    try {
        return JSON.parse(txt);
    } catch {
        return txt;
    }
}

async function callWithAlphaBudget(mcp: MCPAdapter, name: string, args: Record<string, unknown>): Promise<any> {
    const started = Date.now();
    const result = await mcp.handleToolCall(name, args);
    const elapsedMs = Date.now() - started;
    expect(elapsedMs, `${name} exceeded Alpha per-call budget`).toBeLessThanOrEqual(alphaPerCallBudgetMs);
    return result;
}

describe('Alpha MVP direct MCP parity', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;

    beforeAll(async () => {
        const config = createTestConfig({ workspaceRoot: process.cwd() });
        const shared = new SharedServices(config);
        await shared.initialize();
        const layerManager = new LayerManager(config, shared.eventBus);
        await layerManager.initialize();
        analyzer = new CodeAnalyzer(layerManager, shared, config, shared.eventBus);
        await analyzer.initialize();
        mcp = new MCPAdapter(analyzer);
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('get_snapshot and read_file work through direct MCPAdapter calls', async () => {
        const snapshotRes = await mcp.handleToolCall('get_snapshot', { preferExisting: true });
        const snapshot = await parseContent(snapshotRes);
        expect(snapshot.id || snapshot.snapshot).toBeDefined();

        const readRes = await mcp.handleToolCall('read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
            snapshot: snapshot.id || snapshot.snapshot,
        });
        const read = await parseContent(readRes);

        expect(read.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(read.range).toEqual({ startLine: 1, endLine: 8 });
        expect(read.content).toContain('Alpha MVP contract');
        expect(read.truncated).toBe(false);
    });

    test('read_file returns structured MCP error for workspace escape', async () => {
        const readRes = await mcp.handleToolCall('read_file', { path: '../AGENTS.md' });

        expect(readRes.isError).toBe(true);
        expect(readRes.content?.[0]?.text).toContain('workspace');
    });

    test('navigation cluster works through direct MCPAdapter calls', async () => {
        const textSearch = await parseContent(
            await callWithAlphaBudget(mcp, 'text_search', { query: 'handleToolCall', path: `${process.cwd()}/src`, maxResults: 5 })
        );
        const symbolSearch = await parseContent(
            await callWithAlphaBudget(mcp, 'symbol_search', {
                query: 'handleToolCall',
                maxResults: 5,
                fileHint: 'src/adapters/mcp-adapter.ts',
            })
        );
        const definition = await parseContent(
            await callWithAlphaBudget(mcp, 'find_definition', {
                symbol: 'handleToolCall',
                file: 'src/adapters/mcp-adapter.ts',
                precise: true,
                maxResults: 5,
            })
        );
        const references = await parseContent(
            await callWithAlphaBudget(mcp, 'find_references', {
                symbol: 'handleToolCall',
                file: 'src/adapters/mcp-adapter.ts',
                includeDeclaration: true,
                maxResults: 5,
            })
        );
        const ast = await parseContent(
            await callWithAlphaBudget(mcp, 'ast_query', {
                language: 'typescript',
                query: '(program) @root',
                paths: ['src/adapters/mcp-adapter.ts'],
                limit: 5,
            })
        );
        const graph = await parseContent(
            await callWithAlphaBudget(mcp, 'graph_expand', {
                file: 'src/adapters/mcp-adapter.ts',
                edges: ['imports', 'exports'],
                depth: 1,
                limit: 5,
            })
        );

        expect(textSearch.count).toBeGreaterThan(0);
        expect(textSearch.results.length).toBeLessThanOrEqual(5);
        expect(symbolSearch.symbols?.[0]?.name).toBe('handleToolCall');
        expect(definition.count).toBeGreaterThan(0);
        expect(references.count).toBeGreaterThan(0);
        expect(Array.isArray(ast.results)).toBe(true);
        expect(graph.schemaVersion).toBe(2);
        expect(graph.neighbors).toBeDefined();
    }, 30000);

    structuralTest('structural_search works through direct MCPAdapter calls', async () => {
        const search = await parseContent(
            await mcp.handleToolCall('structural_search', {
                language: 'typescript',
                pattern: 'mcp.handleToolCall($NAME, $ARGS)',
                paths: ['tests/alpha-mvp-mcp-parity.test.ts'],
                maxResults: 5,
            })
        );

        expect(search.workflow).toBe('structural_search');
        expect(search.ok).toBe(true);
        expect(search.backend).toBe('ast-grep');
        expect(search.paths).toEqual(['tests/alpha-mvp-mcp-parity.test.ts']);
        expect(search.matches.length).toBeGreaterThan(0);
        expect(search.matches.length).toBeLessThanOrEqual(5);
        expect(search.limits.timeoutMs).toBeGreaterThan(0);
    }, 30000);

    test('patch-planning cluster stages a diff and runs checks without mutating workspace', async () => {
        const before = await Bun.file(patchPlanningTarget).text();
        expect(before).not.toContain(patchPlanningMarker);

        const snapshot = await parseContent(await mcp.handleToolCall('get_snapshot', { preferExisting: false }));
        const snapshotId = snapshot.id || snapshot.snapshot;
        expect(snapshotId).toBeDefined();

        const proposed = await parseContent(await mcp.handleToolCall('propose_patch', { snapshot: snapshotId, patch: patchPlanningDiff }));
        expect(proposed.accepted).toBe(true);
        expect(proposed.snapshot).toBe(snapshotId);

        const checked = await parseContent(
            await mcp.handleToolCall('run_checks', { snapshot: snapshotId, commands: ['true'], timeoutSec: 30 })
        );
        expect(checked.ok).toBe(true);
        expect(checked.snapshot).toBe(snapshotId);

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 30000);
});
