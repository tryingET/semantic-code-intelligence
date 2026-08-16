import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { ALPHA_MVP_TOOL_NAMES, assertAlphaMvpToolAllowed } from '../src/core/tools/alpha-surface';
import { ToolRegistry } from '../src/core/tools/registry';
import { assertHttpToolAllowed, defaultHttpToolNames } from '../src/core/workflows/http-tool-policy';
import { listMcpTools } from '../src/mcp/tool-list';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7022;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

const patchPlanningMarker = '<!-- alpha patch-planning parity snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -7,6 +7,7 @@ type: "reference"
 ---
${' '}
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
${' '}
 ## User and job
${' '}
`;

const hasAstGrep = spawnSync('bash', ['-lc', 'command -v ast-grep >/dev/null 2>&1'], { stdio: 'ignore' }).status === 0;
const structuralTest = hasAstGrep ? test : test.skip;

const alphaMvpTools = [...ALPHA_MVP_TOOL_NAMES];

const nonAlphaToolNames = [
    'workflow_safe_rename',
    'plan_rename',
    'apply_rename',
    'rename_symbol',
    'get_completions',
    'generate_tests',
    'cache_controls',
    'list_pipelines',
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

    test('registry listing cannot mutate process-wide tool specs', () => {
        const listed = ToolRegistry.list();
        const originalName = listed[0].name;
        listed[0].name = 'mutated_tool_name';
        listed[0].inputSchema.properties = { mutated: true };

        const fresh = ToolRegistry.list()[0];
        expect(fresh.name).toBe(originalName);
        expect(fresh.inputSchema.properties).not.toEqual({ mutated: true });
    });

    test('Alpha MVP docs list every runtime-exposed tool', () => {
        for (const file of ['docs/project/product-posture.md', 'docs/project/alpha-mvp-contract.md']) {
            const text = readFileSync(file, 'utf8');
            for (const name of alphaMvpTools) {
                expect(text.includes(`\`${name}\``), `${file} should document ${name}`).toBe(true);
            }
        }
    });

    test('Alpha MVP tool-name export is immutable', () => {
        expect(Object.isFrozen(ALPHA_MVP_TOOL_NAMES)).toBe(true);
        expect(() => (ALPHA_MVP_TOOL_NAMES as string[]).push('mutated_tool')).toThrow();
        expect(ALPHA_MVP_TOOL_NAMES).not.toContain('mutated_tool');
    });

    test('MCP and HTTP use the same Alpha MVP exposure membrane', () => {
        const mcpNames = listMcpTools()
            .map((tool) => tool.name)
            .sort();
        const httpNames = [...defaultHttpToolNames()].sort();
        const expected = [...alphaMvpTools].sort();

        expect(mcpNames).toEqual(expected);
        expect(httpNames).toEqual(expected);
        for (const name of nonAlphaToolNames) {
            expect(mcpNames).not.toContain(name);
            expect(httpNames).not.toContain(name);
        }
    });

    test('Alpha helper allowlist narrows the membrane instead of widening it', () => {
        expect(() => assertAlphaMvpToolAllowed('no_such_tool', {}, { allowedToolNames: ['no_such_tool'] })).toThrow(
            /Unknown tool/
        );
        expect(() => assertAlphaMvpToolAllowed('plan_rename', {}, { allowedToolNames: ['plan_rename'] })).toThrow(
            /not available/
        );
        expect(() =>
            assertAlphaMvpToolAllowed('read_file', { path: 'README.md' }, { allowedToolNames: ['read_file'] })
        ).not.toThrow();
        expect(() =>
            assertAlphaMvpToolAllowed('text_search', { query: 'alpha' }, { allowedToolNames: ['read_file'] })
        ).toThrow(/not available/);
    });

    test('HTTP adapter allowlist narrows the Alpha membrane instead of widening it', () => {
        expect(() =>
            assertHttpToolAllowed(
                'plan_rename',
                {},
                { surface: 'HTTP adapter surface', allowedToolNames: ['plan_rename'] }
            )
        ).toThrow(/not available/);
        expect(() =>
            assertHttpToolAllowed(
                'list_files',
                {},
                { surface: 'HTTP adapter surface', allowedToolNames: ['list_files'] }
            )
        ).toThrow(/not available/);
        expect(() =>
            assertHttpToolAllowed(
                'read_file',
                { path: 'README.md' },
                { surface: 'HTTP adapter surface', allowedToolNames: ['read_file'] }
            )
        ).not.toThrow();
        expect(() =>
            assertHttpToolAllowed(
                'text_search',
                { query: 'alpha' },
                { surface: 'HTTP adapter surface', allowedToolNames: ['read_file'] }
            )
        ).toThrow(/not available/);
    });

    test('navigation operations advertise bounded input caps or scope hints', () => {
        const specs = new Map(ToolRegistry.list().map((tool) => [tool.name, tool]));

        expect(specs.get('text_search')?.inputSchema?.properties?.maxResults?.type).toBe('number');
        expect(specs.get('text_search')?.inputSchema?.properties?.path?.type).toBe('string');
        expect(specs.get('symbol_search')?.inputSchema?.properties?.maxResults?.type).toBe('number');
        expect(specs.get('symbol_search')?.inputSchema?.properties?.fileHint?.type).toBe('string');
        expect(specs.get('find_definition')?.inputSchema?.properties?.file?.type).toBe('string');
        expect(specs.get('find_definition')?.inputSchema?.properties?.maxResults?.maximum).toBe(1000);
        expect(specs.get('find_definition')?.inputSchema?.anyOf).toEqual([
            { required: ['symbol'] },
            { required: ['file', 'position'] },
        ]);
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
        expect(specs.get('patch_checks_in_snapshot')?.inputSchema?.properties?.onlyTouched?.type).toBe('boolean');
        expect(specs.get('explore_symbol_impact')?.category).toBe('workflow');
        expect(specs.get('explore_symbol_impact')?.inputSchema?.properties?.mode?.enum).toEqual([
            'compact',
            'standard',
            'debug',
        ]);
        expect(specs.get('explore_symbol_impact')?.inputSchema?.properties?.maxFiles?.maximum).toBe(25);
        expect(specs.get('explore_symbol_impact')?.inputSchema?.properties?.maxNextReads?.maximum).toBe(10);
        expect(specs.get('explore_symbol_impact')?.inputSchema?.properties?.symbol?.maxLength).toBe(256);
        expect(specs.get('explore_symbol_impact')?.description).toContain('compact returns only the decision packet');
        expect(specs.get('explore_symbol_impact')?.description).toContain('24 KiB');
        expect(specs.get('explore_symbol_impact')?.description).toContain('No unrestricted backend dumps');
        expect(specs.get('explore_symbol_impact')?.inputSchema?.properties?.mode?.description).toContain(
            'standard: normalized bounded evidence'
        );
        expect(specs.get('locate_confirm_definition')?.category).toBe('workflow');
    });
});

bindDescribe('Alpha MVP HTTP tools/call contract', () => {
    let server: HTTPServer;
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

    test('HTTP tools/call rejects registered non-Alpha tools', async () => {
        for (const name of nonAlphaToolNames) {
            const { status, body } = await callTool(base, name, {});
            expect(status, `${name} should be rejected`).toBe(400);
            expect(body.success, `${name} should fail`).toBe(false);
            expect(body.error.message, `${name} should report Alpha membrane`).toContain('not available');
        }
    });

    test('navigation cluster returns bounded structured results', async () => {
        const calls = [
            ['text_search', { query: 'handleToolCall', path: 'src', maxResults: 5 }],
            ['symbol_search', { query: 'handleToolCall', maxResults: 5, fileHint: 'src/adapters/mcp-adapter.ts' }],
            [
                'find_definition',
                { symbol: 'handleToolCall', file: 'src/adapters/mcp-adapter.ts', precise: true, maxResults: 5 },
            ],
            [
                'find_references',
                {
                    symbol: 'handleToolCall',
                    file: 'src/adapters/mcp-adapter.ts',
                    includeDeclaration: true,
                    maxResults: 5,
                },
            ],
            [
                'ast_query',
                { language: 'typescript', query: '(program) @root', paths: ['src/adapters/mcp-adapter.ts'], limit: 5 },
            ],
            [
                'graph_expand',
                { file: 'src/adapters/mcp-adapter.ts', edges: ['imports', 'exports'], depth: 1, limit: 5 },
            ],
        ] as const;

        const results = new Map<string, any>();
        for (const [name, args] of calls) {
            const { status, body } = await callTool(base, name, args);
            expect(status, `${name} should return HTTP 200`).toBe(200);
            expect(body.success, `${name} should succeed`).toBe(true);
            results.set(name, body.result);
        }

        expect(results.get('text_search')?.query).toBe('handleToolCall');
        expect(typeof results.get('text_search')?.capped).toBe('boolean');
        expect(results.get('text_search')?.count).toBeGreaterThan(0);
        expect(results.get('text_search')?.results?.length).toBeLessThanOrEqual(5);
        expect(results.get('symbol_search')?.symbols?.[0]?.name).toBe('handleToolCall');
        expect(results.get('find_definition')?.symbol).toBe('handleToolCall');
        expect(typeof results.get('find_definition')?.fallback).toBe('boolean');
        expect(results.get('find_definition')?.count).toBeGreaterThan(0);
        expect(results.get('find_references')?.symbol).toBe('handleToolCall');
        expect(typeof results.get('find_references')?.fallback).toBe('boolean');
        expect(results.get('find_references')?.count).toBeGreaterThan(0);
        expect(results.get('ast_query')?.language).toBe('typescript');
        expect(results.get('ast_query')?.query).toBe('(program) @root');
        expect(results.get('ast_query')?.parserStatus).toBeDefined();
        expect(Array.isArray(results.get('ast_query')?.results)).toBe(true);
        expect(results.get('graph_expand')?.schemaVersion).toBe(2);
        expect(results.get('graph_expand')?.neighbors).toBeDefined();
    }, 30000);

    test('explore_symbol_impact preserves progressive mode differences through HTTP tools/call', async () => {
        const results = new Map<string, any>();
        for (const mode of ['compact', 'standard', 'debug']) {
            const { status, body } = await callTool(base, 'explore_symbol_impact', {
                symbol: 'handleToolCall',
                file: 'src/adapters/mcp-adapter.ts',
                precise: true,
                depth: 1,
                limit: 10,
                mode,
            });
            expect(status, `${mode} should return HTTP 200`).toBe(200);
            expect(body.success, `${mode} should succeed`).toBe(true);
            expect(body.result).toMatchObject({
                schemaVersion: 1,
                workflow: 'explore_symbol_impact',
                ok: true,
                status: 'confirmed',
            });
            results.set(mode, body.result);
        }

        expect(results.get('compact').details).toBe('mode: standard');
        expect(results.get('standard').details).toMatchObject({ mode: 'standard' });
        expect(results.get('standard').details).not.toHaveProperty('diagnostics');
        expect(results.get('debug').details).toMatchObject({ mode: 'debug' });
        expect(results.get('debug').details.diagnostics.subcalls).toHaveLength(3);
        expect(results.get('debug').definition).toEqual(results.get('compact').definition);
    }, 30000);

    test('text_search caps individual result text while preserving match metadata', async () => {
        const dir = '.tmp-alpha-text-search-bound';
        const file = `${dir}/huge.txt`;
        await rm(dir, { recursive: true, force: true });
        await mkdir(dir, { recursive: true });
        try {
            await Bun.write(file, `${'A'.repeat(5000)}NEEDLE${'B'.repeat(5000)}`);
            const { status, body } = await callTool(base, 'text_search', {
                query: 'NEEDLE',
                path: dir,
                maxResults: 1,
            });
            expect(status).toBe(200);
            expect(body.success).toBe(true);
            expect(body.result.query).toBe('NEEDLE');
            expect(body.result.capped).toBe(true);
            expect(body.result.capReason).toBe('maxResults');
            expect(body.result.results).toHaveLength(1);
            expect(body.result.results[0].text.length).toBeLessThanOrEqual(4096);
            expect(body.result.results[0]).toMatchObject({
                line: 1,
                column: 5001,
                columnInText: 2049,
                textTruncated: true,
                omittedPrefixChars: 2952,
                originalTextChars: 10006,
            });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    }, 30000);

    structuralTest(
        'structural_search succeeds through HTTP tools/call',
        async () => {
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
        },
        30000
    );

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

        const checked = await callTool(base, 'run_checks', {
            snapshot: snapshotId,
            commands: ['true'],
            timeoutSec: 30,
        });
        expect(checked.status).toBe(200);
        expect(checked.body.success).toBe(true);
        expect(checked.body.result.ok).toBe(true);
        expect(checked.body.result.snapshot).toBe(snapshotId);

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 30000);
});
