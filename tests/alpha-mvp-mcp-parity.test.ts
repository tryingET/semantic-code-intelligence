import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { LayerManager } from '../src/core/layer-manager';
import { SharedServices } from '../src/core/services';
import { CodeAnalyzer } from '../src/core/unified-analyzer';
import { createTestConfig } from './test-helpers';

async function parseContent(res: any): Promise<any> {
    const txt = res?.content?.[0]?.text;
    expect(txt).toBeDefined();
    try {
        return JSON.parse(txt);
    } catch {
        return txt;
    }
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
            await mcp.handleToolCall('text_search', { query: 'handleReadFile', path: `${process.cwd()}/src`, maxResults: 5 })
        );
        const symbolSearch = await parseContent(
            await mcp.handleToolCall('symbol_search', {
                query: 'handleReadFile',
                maxResults: 5,
                fileHint: 'src/adapters/mcp-adapter.ts',
            })
        );
        const definition = await parseContent(
            await mcp.handleToolCall('find_definition', {
                symbol: 'handleReadFile',
                file: 'src/adapters/mcp-adapter.ts',
                precise: true,
                maxResults: 5,
            })
        );
        const references = await parseContent(
            await mcp.handleToolCall('find_references', {
                symbol: 'handleReadFile',
                file: 'src/adapters/mcp-adapter.ts',
                includeDeclaration: true,
                maxResults: 5,
            })
        );
        const ast = await parseContent(
            await mcp.handleToolCall('ast_query', {
                language: 'typescript',
                query: '(program) @root',
                paths: ['src/adapters/mcp-adapter.ts'],
                limit: 5,
            })
        );
        const graph = await parseContent(
            await mcp.handleToolCall('graph_expand', {
                file: 'src/adapters/mcp-adapter.ts',
                edges: ['imports', 'exports'],
                depth: 1,
                limit: 5,
            })
        );

        expect(textSearch.count).toBeGreaterThan(0);
        expect(textSearch.results.length).toBeLessThanOrEqual(5);
        expect(symbolSearch.symbols?.[0]?.name).toBe('handleReadFile');
        expect(definition.count).toBeGreaterThan(0);
        expect(references.count).toBeGreaterThan(0);
        expect(Array.isArray(ast.results)).toBe(true);
        expect(graph.schemaVersion).toBe(2);
        expect(graph.neighbors).toBeDefined();
    });
});
