import { beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MCPAdapter } from '../src/adapters/mcp-adapter.js';
import { ToolRegistry } from '../src/core/tools/registry.js';

type ToolResult = { content?: Array<{ text?: string }>; isError?: boolean };
type GraphNeighbor = { capture?: string; text?: string; name?: string; caller?: string };

const fixtureDir = join(process.cwd(), '.test-results', 'graph-capability-contract');
const tsFixture = join(fixtureDir, 'typescript-contract.ts');

function parse(res: ToolResult) {
    return JSON.parse(res?.content?.[0]?.text || '{}');
}

function texts(items: GraphNeighbor[]) {
    return items.map((item) => item.text);
}

function names(items: GraphNeighbor[]) {
    return items.map((item) => item.name);
}

describe('graph_expand executable capability contract', () => {
    let mcp: MCPAdapter;

    beforeAll(() => {
        mkdirSync(fixtureDir, { recursive: true });
        writeFileSync(
            tsFixture,
            [
                "import def, { a as b, c } from './module';",
                'export function exportedFunction() { return 1; }',
                'export const x = 1, y = 2;',
                'export default 42;',
                "export { exportedFunction as renamedFunction } from './module';",
                'export const contractTarget = () => {',
                '    return contractHelper();',
                '};',
                'export function contractHelper() { return 1; }',
                'export function contractCaller() { return contractTarget(); }',
                'export function outsideScope() { return outsideHelper(); }',
                'export function outsideHelper() { return 2; }',
                '',
            ].join('\n')
        );
        mcp = new MCPAdapter({
            buildSymbolMap: async ({ identifier }: { identifier?: string }) => ({
                declarations: identifier === 'contractTarget' ? [{ uri: pathToFileURL(tsFixture).href }] : [],
            }),
        } as any);
    });

    afterAll(() => {
        rmSync(fixtureDir, { recursive: true, force: true });
    });

    test('support matrix claims are backed by positive and negative TypeScript edge fixtures', async () => {
        const obj = parse(
            await mcp.handleToolCall('graph_expand', {
                file: '.test-results/graph-capability-contract/typescript-contract.ts',
                symbol: 'contractTarget',
                edges: ['imports', 'exports', 'callers', 'callees'],
                limit: 50,
            })
        );

        expect(obj.impactSummary?.languageSupport).toEqual({
            language: 'typescript',
            support: 'tree_sitter_best_effort',
            supportedEdges: ['imports', 'exports', 'callers', 'callees'],
        });
        expect(obj.impactSummary?.backend).toBe('tree_sitter');
        expect(obj.impactSummary?.counts?.imports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.exports).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.callers).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.callees).toBeGreaterThan(0);

        expect(texts(obj.neighbors.imports)).toEqual(expect.arrayContaining(['def', 'a', 'b', 'c', "'./module'"]));
        expect(texts(obj.neighbors.exports)).toEqual(
            expect.arrayContaining(['exportedFunction', 'x', 'y', '42', 'renamedFunction', 'contractTarget'])
        );
        expect(names(obj.neighbors.callees)).toEqual(['contractHelper']);
        expect(names(obj.neighbors.callees)).not.toContain('outsideHelper');
        expect(obj.neighbors.callers.map((item: GraphNeighbor) => item.caller)).toEqual(['contractCaller']);
    });

    test('symbol-only seeds default to caller/callee evidence instead of unavailable import/export edges', async () => {
        const obj = parse(
            await mcp.handleToolCall('graph_expand', {
                symbol: 'contractTarget',
                limit: 50,
            })
        );

        expect(obj.impactSummary?.seed).toEqual({ kind: 'symbol', value: 'contractTarget' });
        expect(obj.impactSummary?.requestedEdges).toEqual(['callers', 'callees']);
        expect(obj.impactSummary?.counts?.callers).toBeGreaterThan(0);
        expect(obj.impactSummary?.counts?.callees).toBeGreaterThan(0);
        expect(obj.impactSummary?.limitations.join('\n')).not.toContain('imports/exports: provide file');
    });

    test('missing file seeds are invalid input, not successful empty fallback evidence', async () => {
        const res = await mcp.handleToolCall('graph_expand', {
            file: '.test-results/graph-capability-contract/does-not-exist.ts',
            edges: ['imports', 'exports'],
            limit: 10,
        });

        expect(res.isError).toBe(true);
        expect(JSON.stringify(res)).toContain('does not exist');
    });

    test('depth greater than one is explicit one-hop limited evidence', async () => {
        const obj = parse(
            await mcp.handleToolCall('graph_expand', {
                file: '.test-results/graph-capability-contract/typescript-contract.ts',
                edges: ['imports'],
                depth: 2,
                limit: 10,
            })
        );

        expect(obj.impactSummary?.limitations).toContain(
            'depth: recursive graph expansion is not implemented; returned evidence is one-hop best effort'
        );
        expect(obj.impactSummary?.counts?.imports).toBeGreaterThan(0);
    });

    test('tool schema does not advertise a single false edge default and labels depth as one-hop reserved', () => {
        const graphSpec = ToolRegistry.list().find((tool) => tool.name === 'graph_expand');
        expect(graphSpec?.inputSchema?.properties?.edges?.default).toBeUndefined();
        expect(graphSpec?.inputSchema?.properties?.edges?.description).toContain('file seeds');
        expect(graphSpec?.inputSchema?.properties?.edges?.description).toContain('symbol-only seeds');
        expect(graphSpec?.inputSchema?.properties?.depth?.description).toContain('one-hop evidence');
    });
});
