import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig } from './test-helpers';

type ToolResult = { content?: Array<{ text?: string }>; isError?: boolean };

type GraphNeighbor = { name?: string; caller?: string; text?: string };

async function parse(res: ToolResult) {
    const txt = res?.content?.[0]?.text;
    try {
        return JSON.parse(txt || 'null');
    } catch {
        return null;
    }
}

describe('MCP graph_expand Rust and Go support', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;

    beforeAll(async () => {
        const config = createTestConfig();
        const shared = new SharedServices(config);
        await shared.initialize();
        const lm = new LayerManager(config, shared.eventBus);
        await lm.initialize();
        analyzer = new CodeAnalyzer(lm, shared, config, shared.eventBus);
        await analyzer.initialize();
        mcp = new MCPAdapter(analyzer);
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('Rust file+symbol expansion returns syntactic graph evidence with explicit limitations', async () => {
        const res = await mcp.handleToolCall('graph_expand', {
            file: 'tests/fixtures/graph/rust/sample.rs',
            symbol: 'render',
            edges: ['imports', 'exports', 'callers', 'callees'],
            limit: 30,
        });
        const obj = await parse(res);

        expect(res.isError).toBe(false);
        expect(obj.impactSummary?.languageSupport).toEqual({
            language: 'rust',
            support: 'tree_sitter_best_effort',
            supportedEdges: ['imports', 'exports', 'callers', 'callees'],
        });
        expect(obj.impactSummary?.backend).toBe('tree_sitter');
        expect(obj.impactSummary?.counts?.imports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.exports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.callees).toBeGreaterThan(0);
        expect(obj.neighbors.imports.map((item: GraphNeighbor) => item.text).join('\n')).toContain('use std::collections::HashMap');
        expect(obj.neighbors.exports.map((item: GraphNeighbor) => item.text)).toEqual(expect.arrayContaining(['Widget', 'Mode', 'Renderable', 'render']));
        expect(obj.neighbors.exports.map((item: GraphNeighbor) => item.text)).not.toContain('helper');
        expect(obj.neighbors.callees.map((item: GraphNeighbor) => item.name)).toEqual(expect.arrayContaining(['helper', 'draw', 'println']));
        expect(obj.impactSummary?.limitations.join('\n')).toContain('rust: tree-sitter graph evidence is syntactic');
    });

    test('Go file+symbol expansion returns syntactic graph evidence with explicit limitations', async () => {
        const res = await mcp.handleToolCall('graph_expand', {
            file: 'tests/fixtures/graph/go/sample.go',
            symbol: 'Render',
            edges: ['imports', 'exports', 'callers', 'callees'],
            limit: 30,
        });
        const obj = await parse(res);

        expect(res.isError).toBe(false);
        expect(obj.impactSummary?.languageSupport).toEqual({
            language: 'go',
            support: 'tree_sitter_best_effort',
            supportedEdges: ['imports', 'exports', 'callers', 'callees'],
        });
        expect(obj.impactSummary?.backend).toBe('tree_sitter');
        expect(obj.impactSummary?.counts?.imports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.exports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.callees).toBeGreaterThan(0);
        expect(obj.neighbors.imports.map((item: GraphNeighbor) => item.text).join('\n')).toContain('"fmt"');
        expect(obj.neighbors.exports.map((item: GraphNeighbor) => item.text)).toEqual(expect.arrayContaining(['Widget', 'Render', 'Draw']));
        expect(obj.neighbors.exports.map((item: GraphNeighbor) => item.text)).not.toContain('helper');
        expect(obj.neighbors.callees.map((item: GraphNeighbor) => item.name)).toEqual(expect.arrayContaining(['helper', 'Draw', 'Println', 'TrimSpace']));
        expect(obj.impactSummary?.limitations.join('\n')).toContain('go: tree-sitter graph evidence is syntactic');
    });

    test('Rust and Go caller-controlled symbols remain literal and do not widen missing scopes', async () => {
        for (const [file, injectedSymbol] of [
            ['tests/fixtures/graph/rust/sample.rs', 'render")\n(call_expression function: (identifier) @call.func (#eq? @call.func "helper'],
            ['tests/fixtures/graph/go/sample.go', 'Render")\n(call_expression function: (identifier) @call.func (#eq? @call.func "helper'],
        ] as const) {
            const res = await mcp.handleToolCall('graph_expand', {
                file,
                symbol: injectedSymbol,
                edges: ['callers', 'callees'],
                limit: 30,
            });
            const obj = await parse(res);
            const rendered = JSON.stringify(res);

            expect(res.isError).toBe(false);
            expect(obj.neighbors.callees).toEqual([]);
            expect(obj.neighbors.callers).toEqual([]);
            expect(obj.impactSummary?.hasImpactEvidence).toBe(false);
            expect(obj.impactSummary?.limitations.join('\n')).toContain('requested symbol not found in file');
            expect(rendered).not.toContain('(#eq? @call.func');
        }
    });
});
