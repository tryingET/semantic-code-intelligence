import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { canBindTcp } from './helpers/bind-utils';
import { initMcpHttpSession, mcpHttpHeaders } from './helpers/mcp-http';

const patchPlanningMarker = '<!-- alpha patch-planning parity snapshot-only marker -->';
const patchPlanningTarget = 'docs/project/alpha-mvp-contract.md';
const patchPlanningDiff = `diff --git a/${patchPlanningTarget} b/${patchPlanningTarget}
--- a/${patchPlanningTarget}
+++ b/${patchPlanningTarget}
@@ -9,1 +9,2 @@
 # Alpha MVP contract — harnessed LLM coding sessions
+${patchPlanningMarker}
`;

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandomPort(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function parseMcpBody(res: Response) {
    if (!res.body) return {};
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
        for (let i = 0; i < 6; i++) {
            const { value, done } = await reader.read();
            if (value) text += decoder.decode(value, { stream: !done });
            try {
                return JSON.parse(text);
            } catch {}
            const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith('data: '));
            if (line) {
                try {
                    return JSON.parse(line.replace(/^data:\s*/, ''));
                } catch {}
                return {};
            }
            if (done) break;
        }
    } finally {
        await reader.cancel();
    }
    return {};
}

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('Alpha MVP MCP HTTP protocol', () => {
    const host = '127.0.0.1';
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    let port: number;
    let base: string;
    let sessionId: string;
    let server: ReturnType<typeof spawn> | null = null;

    beforeAll(async () => {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            port = pickRandomPort(8300, 8999);
            base = `http://${host}:${port}/mcp`;
            server = spawn(bun, ['run', 'src/servers/mcp-http.ts'], {
                env: {
                    ...process.env,
                    MCP_HTTP_HOST: host,
                    MCP_HTTP_PORT: String(port),
                    HTTP_API_PORT: String(port + 9),
                },
            });
            await wait(500);
            try {
                sessionId = await initMcpHttpSession(base, { name: 'alpha-mvp-test', version: '1.0.0' });
                return;
            } catch (error) {
                lastError = error;
                server.kill('SIGTERM');
                server = null;
            }
        }
        throw lastError ?? new Error('Failed to start MCP HTTP server');
    });

    afterAll(async () => {
        server?.kill('SIGTERM');
    });

    async function toolsCall(id: number, name: string, args: Record<string, unknown>) {
        const res = await fetch(base, {
            method: 'POST',
            headers: mcpHttpHeaders(sessionId),
            body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
        });
        return { status: res.status, body: await parseMcpBody(res) };
    }

    async function toolsList(id: number) {
        const res = await fetch(base, {
            method: 'POST',
            headers: mcpHttpHeaders(sessionId),
            body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }),
        });
        return { status: res.status, body: await parseMcpBody(res) };
    }

    test('tools/list advertises the Alpha MVP tool surface', async () => {
        const { status, body } = await toolsList(2);

        expect(status).toBe(200);
        const tools = body?.result?.tools || [];
        const toolNames = new Set(tools.map((tool: any) => tool.name));
        for (const name of [
            'get_snapshot',
            'read_file',
            'text_search',
            'symbol_search',
            'ast_query',
            'find_definition',
            'find_references',
            'graph_expand',
            'propose_patch',
            'run_checks',
        ]) {
            expect(toolNames.has(name), `${name} should be discoverable through MCP HTTP tools/list`).toBe(true);
        }

        const readFile = tools.find((tool: any) => tool.name === 'read_file');
        expect(readFile?.inputSchema?.required).toContain('path');
        expect(readFile?.inputSchema?.properties?.path?.type).toBe('string');
    });

    test('read_file succeeds through JSON-RPC tools/call', async () => {
        const { status, body } = await toolsCall(2, 'read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
        });

        expect(status).toBe(200);
        const text = body?.result?.content?.[0]?.text;
        expect(text).toBeDefined();
        const parsed = JSON.parse(text);
        expect(parsed.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(parsed.range).toEqual({ startLine: 1, endLine: 8 });
        expect(parsed.content).toContain('Alpha MVP contract');
    });

    test('read_file workspace escape returns structured MCP error result', async () => {
        const { status, body } = await toolsCall(3, 'read_file', { path: '../AGENTS.md' });

        expect(status).toBe(200);
        const errorText = body?.error?.message || body?.result?.content?.[0]?.text || '';
        expect(String(errorText)).toContain('workspace');
    });

    test('navigation cluster succeeds through JSON-RPC tools/call', async () => {
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
        let id = 10;
        for (const [name, args] of calls) {
            const { status, body } = await toolsCall(id++, name, args);
            expect(status, `${name} should return HTTP 200`).toBe(200);
            expect(body.error, `${name} should not produce a JSON-RPC error`).toBeUndefined();
            const text = body?.result?.content?.[0]?.text;
            expect(text, `${name} should return text content`).toBeDefined();
            results.set(name, JSON.parse(text));
        }

        expect(results.get('text_search')?.count).toBeGreaterThan(0);
        expect(results.get('text_search')?.results?.length).toBeLessThanOrEqual(5);
        expect(results.get('symbol_search')?.symbols?.[0]?.name).toBe('handleReadFile');
        expect(results.get('find_definition')?.count).toBeGreaterThan(0);
        expect(results.get('find_references')?.count).toBeGreaterThan(0);
        expect(Array.isArray(results.get('ast_query')?.results)).toBe(true);
        expect(results.get('graph_expand')?.schemaVersion).toBe(2);
        expect(results.get('graph_expand')?.neighbors).toBeDefined();
    });

    test('patch-planning cluster succeeds through JSON-RPC tools/call without mutating workspace', async () => {
        const before = await Bun.file(patchPlanningTarget).text();
        expect(before).not.toContain(patchPlanningMarker);

        const snapshotCall = await toolsCall(30, 'get_snapshot', { preferExisting: false });
        expect(snapshotCall.status).toBe(200);
        const snapshot = JSON.parse(snapshotCall.body?.result?.content?.[0]?.text || '{}');
        const snapshotId = snapshot.id || snapshot.snapshot;
        expect(snapshotId).toBeDefined();

        const proposedCall = await toolsCall(31, 'propose_patch', { snapshot: snapshotId, patch: patchPlanningDiff });
        expect(proposedCall.status).toBe(200);
        expect(proposedCall.body.error).toBeUndefined();
        const proposed = JSON.parse(proposedCall.body?.result?.content?.[0]?.text || '{}');
        expect(proposed.accepted).toBe(true);
        expect(proposed.snapshot).toBe(snapshotId);

        const checkedCall = await toolsCall(32, 'run_checks', { snapshot: snapshotId, commands: ['true'], timeoutSec: 30 });
        expect(checkedCall.status).toBe(200);
        expect(checkedCall.body.error).toBeUndefined();
        const checked = JSON.parse(checkedCall.body?.result?.content?.[0]?.text || '{}');
        expect(checked.ok).toBe(true);
        expect(checked.snapshot).toBe(snapshotId);

        const after = await Bun.file(patchPlanningTarget).text();
        expect(after).toBe(before);
        expect(after).not.toContain(patchPlanningMarker);
    }, 30000);
});
