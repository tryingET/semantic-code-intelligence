import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig } from './test-helpers';

type GraphNeighbor = { name?: string; caller?: string };
type GraphEvidence = { edge?: string; status?: string };
type ToolResult = { content?: Array<{ text?: string }> };

async function parse(res: ToolResult) {
    const txt = res?.content?.[0]?.text;
    try {
        return JSON.parse(txt);
    } catch {
        return null;
    }
}

describe('MCP graph_expand hardening', () => {
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

    test('fallback returns empty neighbors for invalid file', async () => {
        const res = await mcp.handleToolCall('graph_expand', {
            file: 'this/does/not/exist.ts',
            edges: ['imports', 'exports', 'callers', 'callees'],
        });
        const obj = await parse(res);
        expect(obj.neighbors).toBeDefined();
        expect(Array.isArray(obj.neighbors.imports)).toBe(true);
        expect(Array.isArray(obj.neighbors.exports)).toBe(true);
        expect(Array.isArray(obj.neighbors.callers)).toBe(true);
        expect(Array.isArray(obj.neighbors.callees)).toBe(true);
        expect(obj.impactSummary?.backend).toBe('fallback');
        expect(obj.impactSummary?.freshness).toBe('unknown');
        expect(obj.impactSummary?.provenance?.backend).toBe('fallback');
        expect(obj.impactSummary?.provenance?.indexPath).toBeNull();
    });

    test('impact summary exposes tree-sitter provenance for supported file seeds', async () => {
        const res = await mcp.handleToolCall('graph_expand', {
            file: 'src/core/code-graph.ts',
            edges: ['imports'],
        });
        const obj = await parse(res);
        expect(obj.impactSummary?.backend).toBe('tree_sitter');
        expect(obj.impactSummary?.freshness).toBe('current');
        expect(obj.impactSummary?.discoveryBackend).toBeNull();
        expect(obj.impactSummary?.provenance?.backend).toBe('tree_sitter');
        expect(obj.impactSummary?.provenance?.metadataSource).toBeNull();
    });

    test('file+symbol graph expansion treats symbols as literals and does not widen missing scopes to file-wide callees', async () => {
        const fixture = `.tmp-graph-symbol-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`;
        writeFileSync(
            fixture,
            [
                'export function target() { return helper(); }',
                'export function helper() { return 1; }',
                'export function caller() { return target(); }',
                '',
            ].join('\n')
        );
        try {
            const valid = await parse(
                await mcp.handleToolCall('graph_expand', {
                    file: fixture,
                    symbol: 'target',
                    edges: ['callers', 'callees'],
                    limit: 20,
                })
            );
            expect(valid.neighbors.callees.map((item: GraphNeighbor) => item.name)).toEqual(['helper']);
            expect(valid.neighbors.callers.map((item: GraphNeighbor) => item.caller)).toEqual(['caller']);
            expect(valid.impactSummary?.hasImpactEvidence).toBe(true);

            const injectedSymbol = 'target")\n(call_expression function: (identifier) @f (#eq? @f "helper';
            const injectedResult = await mcp.handleToolCall('graph_expand', {
                file: fixture,
                symbol: injectedSymbol,
                edges: ['callers', 'callees'],
                limit: 20,
            });
            const injected = await parse(injectedResult);
            const rendered = JSON.stringify(injectedResult);

            expect(injectedResult.isError).toBe(false);
            expect(injected.neighbors.callees).toEqual([]);
            expect(injected.neighbors.callers).toEqual([]);
            expect(injected.impactSummary?.counts?.callees).toBe(0);
            expect(injected.impactSummary?.counts?.callers).toBe(0);
            expect(injected.impactSummary?.hasImpactEvidence).toBe(false);
            expect(
                injected.impactSummary?.evidence.find((item: GraphEvidence) => item.edge === 'callees')?.status
            ).toBe('limited');
            expect(injected.impactSummary?.limitations.join('\n')).toContain('requested symbol not found in file');
            expect(rendered).not.toContain('(#eq? @f');
        } finally {
            rmSync(fixture, { force: true });
        }
    }, 30000);
});
