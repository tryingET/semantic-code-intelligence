import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7067;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

async function callTool(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    const body = await res.json();
    return { status: res.status, body };
}

bindDescribe('HTTP metrics', () => {
    let server: HTTPServer;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_API_PORT;
    });

    test('tool_calls_total increments after text_search', async () => {
        const { status, body } = await callTool(base, 'text_search', {
            query: 'function',
            kind: 'word',
            maxResults: 5,
            caseInsensitive: true,
        });
        expect(status).toBe(200);
        expect(body.success).toBe(true);

        const m = await fetch(`${base}/metrics`);
        expect(m.status).toBe(200);
        const text = await m.text();
        // Minimal assertion: adapter=http, tool=text_search and result=success present in a counter line
        expect(text).toContain('tool_calls_total');
        expect(text).toContain('adapter="http"');
        expect(text).toContain('tool="text_search"');
        expect(text).toContain('result="success"');
    }, 15000);
});
