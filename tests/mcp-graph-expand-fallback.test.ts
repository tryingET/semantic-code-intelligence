import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { LayerManager } from '../src/core/layer-manager.js';
import { SharedServices } from '../src/core/services/index.js';
import { CodeAnalyzer } from '../src/core/unified-analyzer.js';
import { createTestConfig } from './test-helpers';

async function parse(res: any) {
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
    });
});
