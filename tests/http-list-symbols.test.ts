import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7017;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

async function callToolRaw(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    return { status: res.status, body: await res.json() };
}

bindDescribe('HTTP tools: list_symbols legacy boundary', () => {
    let server: HTTPServer;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        process.env.LIST_SYMBOLS_AST = '1';
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.LIST_SYMBOLS_AST;
    });

    test('list_symbols is registered but not exposed through the Alpha HTTP tools/call membrane', async () => {
        for (const file of ['tests/fixtures/example.ts', 'file://workspace/tests/fixtures/example.ts']) {
            const result = await callToolRaw(base, 'list_symbols', { file });
            expect(result.status).toBe(400);
            expect(result.body.success).toBe(false);
            expect(result.body.error.message).toContain('not available');
        }
    });
});
