import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ToolRegistry } from '../src/core/tools/registry';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

const alphaMvpTools = [
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
});
