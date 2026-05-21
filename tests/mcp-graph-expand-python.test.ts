import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig } from './test-helpers';

type ToolResult = { content?: Array<{ text?: string }>; isError?: boolean };
type GraphNeighbor = { text?: string; name?: string };

const fixtureDir = join(process.cwd(), '.test-results', 'python-graph-fixtures');
const fixturePath = join(fixtureDir, 'sample.py');

async function parse(res: ToolResult) {
    const txt = res?.content?.[0]?.text;
    try {
        return JSON.parse(txt || 'null');
    } catch {
        return null;
    }
}

describe('MCP graph_expand Python exports', () => {
    let analyzer: CodeAnalyzer;
    let mcp: MCPAdapter;

    beforeAll(async () => {
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            fixturePath,
            [
                'import os',
                'from pathlib import Path',
                '',
                'PUBLIC_CONST = 1',
                '_PRIVATE_CONST = 2',
                '',
                'class Widget:',
                '    def method(self):',
                '        return helper()',
                '',
                'def render():',
                '    def inner():',
                '        return 1',
                '    return helper()',
                '',
                'def _private_helper():',
                '    return 0',
                '',
                'def helper():',
                '    return 1',
                '',
            ].join('\n')
        );

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
        rmSync(fixtureDir, { recursive: true, force: true });
    });

    test('Python file expansion returns top-level public syntactic exports and explicit limitations', async () => {
        const res = await mcp.handleToolCall('graph_expand', {
            file: '.test-results/python-graph-fixtures/sample.py',
            symbol: 'render',
            edges: ['imports', 'exports', 'callees'],
            limit: 30,
        });
        const obj = await parse(res);

        expect(res.isError).toBe(false);
        expect(obj.impactSummary?.languageSupport).toEqual({
            language: 'python',
            support: 'tree_sitter_best_effort',
            supportedEdges: ['imports', 'exports', 'callers', 'callees'],
        });
        expect(obj.impactSummary?.backend).toBe('tree_sitter');
        expect(obj.impactSummary?.counts?.exports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.imports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.callees).toBeGreaterThan(0);

        const exports = obj.neighbors.exports.map((item: GraphNeighbor) => item.text);
        expect(exports).toEqual(expect.arrayContaining(['PUBLIC_CONST', 'Widget', 'render', 'helper']));
        expect(exports).not.toContain('_PRIVATE_CONST');
        expect(exports).not.toContain('_private_helper');
        expect(exports).not.toContain('inner');
        expect(exports).not.toContain('method');
        expect(obj.neighbors.callees.map((item: GraphNeighbor) => item.name)).toContain('helper');
        expect(obj.impactSummary?.limitations.join('\n')).toContain('python: export evidence is syntactic module-level public definitions/assignments');
    });
});
