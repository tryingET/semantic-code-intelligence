import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { ToolRegistry } from '../src/core/tools/registry';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

const patchPlanningMarker = '<!-- alpha patch-planning parity snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
`;

const hasAstGrep = spawnSync('bash', ['-lc', 'command -v ast-grep >/dev/null 2>&1'], { stdio: 'ignore' }).status === 0;
const structuralTest = hasAstGrep ? test : test.skip;

const alphaMvpTools = [
    'get_snapshot',
    'read_file',
    'text_search',
    'symbol_search',
    'ast_query',
    'find_definition',
    'find_references',
    'graph_expand',
    'recommend_checks',
    'propose_patch',
    'run_checks',
    'structural_search',
    'structural_patch_checks',
    'safe_write',
];

async function callTool(base: string, name: string, args: Record<string, unknown>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    return { status: res.status, body: await res.json() };
}

describe('Alpha MVP tool contract', () => {
    test('registry exposes every Phase 1 harnessed-LLM operation', () => {
        const toolNames = new Set(ToolRegistry.list().map((tool) => tool.name));
        for (const name of alphaMvpTools) {
            expect(toolNames.has(name), `${name} should be registered`).toBe(true);
        }
    });

    test('navigation operations advertise bounded input caps or scope hints', () => {
        const specs = new Map(ToolRegistry.list().map((tool) => [tool.name, tool]));

        expect(specs.get('text_search')?.inputSchema?.properties?.maxResults?.type).toBe('number');
        expect(specs.get('text_search')?.inputSchema?.properties?.path?.type).toBe('string');
        expect(specs.get('symbol_search')?.inputSchema?.properties?.maxResults?.type).toBe('number');
        expect(specs.get('symbol_search')?.inputSchema?.properties?.fileHint?.type).toBe('string');
        expect(specs.get('find_definition')?.inputSchema?.properties?.file?.type).toBe('string');
        expect(specs.get('find_references')?.inputSchema?.properties?.includeDeclaration?.type).toBe('boolean');
        expect(specs.get('ast_query')?.inputSchema?.properties?.limit?.type).toBe('number');
        expect(specs.get('graph_expand')?.inputSchema?.properties?.limit?.type).toBe('number');
        expect(specs.get('recommend_checks')?.inputSchema?.properties?.files?.type).toBe('array');
        expect(specs.get('recommend_checks')?.inputSchema?.properties?.mode?.enum).toContain('broader');
        expect(specs.get('structural_search')?.inputSchema?.properties?.maxResults?.type).toBe('number');
        expect(specs.get('structural_search')?.inputSchema?.properties?.timeoutMs?.type).toBe('number');
        expect(specs.get('structural_search')?.inputSchema?.properties?.maxBuffer?.type).toBe('number');
        expect(specs.get('structural_patch_checks')?.inputSchema?.properties?.apply?.type).toBe('boolean');
        expect(specs.get('structural_patch_checks')?.inputSchema?.properties?.timeoutMs?.type).toBe('number');
        expect(specs.get('structural_patch_checks')?.inputSchema?.properties?.maxBuffer?.type).toBe('number');
        expect(specs.get('safe_write')?.inputSchema?.properties?.apply?.type).toBe('boolean');
        expect(specs.get('safe_write')?.inputSchema?.properties?.brief?.type).toBe('boolean');
        expect(specs.get('safe_write')?.inputSchema?.properties?.recommendChecks?.type).toBe('boolean');
        expect(specs.get('safe_write')?.inputSchema?.properties?.impactSummary?.type).toBe('object');
        expect(specs.get('patch_checks_in_snapshot')?.inputSchema?.properties?.recommendChecks?.type).toBe('boolean');
        expect(specs.get('patch_checks_in_snapshot')?.inputSchema?.properties?.impactSummary?.type).toBe('object');
    });
});

bindDescribe('Alpha MVP HTTP tools/call contract', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7022;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('read_file returns bounded file content and range metadata', async () => {
        const { status, body } = await callTool(base, 'read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.result.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(body.result.range).toEqual({ startLine: 1, endLine: 8 });
        expect(body.result.content).toContain('Alpha MVP contract');
        expect(body.result.truncated).toBe(false);
    });

    test('read_file rejects workspace escape paths', async () => {
        const { status, body } = await callTool(base, 'read_file', { path: '../AGENTS.md' });

        expect(status).toBe(400);
        expect(body.success).toBe(false);
        expect(body.error.message).toContain('workspace');
    });

    test('navigation cluster returns bounded structured results', async () => {
        const calls = [
            ['text_search', { query: 'handleReadFile', path: 'src', maxResults: 5 }],
            ['symbol_search', { query: 'handleReadFile', maxResults: 5, fileHint: 'src/adapters/mcp-adapter.ts' }],
            ['find_definition', { symbol: 'handleReadFile', file: 'src/adapters/mcp-adapter.ts', precise: true, maxResults: 5 }],
            [
                'find_references',
                { symbol: 'handleReadFile', file: 'src/adapters/mcp-adapter.ts', includeDeclaration: true, maxResults: 5 },
            ],
            [
                'ast_query',
                { language: 'typescript', query: '(program) @root', paths: ['src/adapters/mcp-adapter.ts'], limit: 5 },
            ],
            ['graph_expand', { file: 'src/adapters/mcp-adapter.ts', edges: ['imports', 'exports'], depth: 1, limit: 5 }],
        ] as const;

        const results = new Map<string, any>();
        for (const [name, args] of calls) {
            const { status, body } = await callTool(base, name, args);
            expect(status, `${name} should return HTTP 200`).toBe(200);
            expect(body.success, `${name} should succeed`).toBe(true);
            results.set(name, body.result);
        }

        expect(results.get('text_search')?.count).toBeGreaterThan(0);
        expect(results.get('text_search')?.results?.length).toBeLessThanOrEqual(5);
        expect(results.get('symbol_search')?.symbols?.[0]?.name).toBe('handleReadFile');
        expect(results.get('find_definition')?.count).toBeGreaterThan(0);
        expect(results.get('find_references')?.count).toBeGreaterThan(0);
        expect(Array.isArray(results.get('ast_query')?.results)).toBe(true);
        expect(results.get('graph_expand')?.schemaVersion).toBe(2);
        expect(results.get('graph_expand')?.neighbors).toBeDefined();
    }, 30000);

    structuralTest('structural_search succeeds through HTTP tools/call', async () => {
        const { status, body } = await callTool(base, 'structural_search', {
            language: 'typescript',
            pattern: 'callTool($BASE, $NAME, $ARGS)',
            paths: ['tests/alpha-mvp-tool-contract.test.ts'],
            maxResults: 5,
        });

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.result.workflow).toBe('structural_search');
        expect(body.result.ok).toBe(true);
        expect(body.result.backend).toBe('ast-grep');
        expect(body.result.paths).toEqual(['tests/alpha-mvp-tool-contract.test.ts']);
        expect(body.result.matches.length).toBeGreaterThan(0);
        expect(body.result.matches.length).toBeLessThanOrEqual(5);
        expect(body.result.limits.timeoutMs).toBeGreaterThan(0);
    }, 30000);

    test('patch-planning cluster stages a diff and runs checks without mutating workspace', async () => {
        const before = await Bun.file(patchPlanningTarget).text();
        expect(before).not.toContain(patchPlanningMarker);

        const snapshot = await callTool(base, 'get_snapshot', { preferExisting: false });
        expect(snapshot.status).toBe(200);
        const snapshotId = snapshot.body.result.snapshot || snapshot.body.result.id;
        expect(snapshotId).toBeDefined();

        const proposed = await callTool(base, 'propose_patch', { snapshot: snapshotId, patch: patchPlanningDiff });
        expect(proposed.status).toBe(200);
        expect(proposed.body.success).toBe(true);
        expect(proposed.body.result.accepted).toBe(true);
        expect(proposed.body.result.snapshot).toBe(snapshotId);

        const checked = await callTool(base, 'run_checks', { snapshot: snapshotId, commands: ['true'], timeoutSec: 30 });
        expect(checked.status).toBe(200);
        expect(checked.body.success).toBe(true);
        expect(checked.body.result.ok).toBe(true);
        expect(checked.body.result.snapshot).toBe(snapshotId);

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 30000);
});
