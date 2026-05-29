import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7017;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

async function callTool(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    return body.result;
}

bindDescribe('HTTP tools: text_search', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7017; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        // Ensure env override doesn't redirect the server to a fixed default port
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        // Clean up the env override set for this test
        delete process.env.HTTP_API_PORT;
    });

    test('text_search returns results within a reasonable budget', async () => {
        const start = Date.now();
        const result = await callTool(base, 'text_search', {
            query: 'function',
            kind: 'word',
            maxResults: 10,
            caseInsensitive: true,
        });
        const elapsed = Date.now() - start;
        // Shape and basic assertions
        expect(result).toBeDefined();
        expect(typeof result.count).toBe('number');
        expect(Array.isArray(result.results)).toBe(true);
        expect(result.count).toBeGreaterThan(0);
        expect(result.results.length).toBeGreaterThan(0);
        // Allow a generous ceiling in CI; target is <200ms p95, but keep tests stable
        expect(elapsed).toBeLessThan(2500);
    }, 15000);

    test('text_search rejects empty query with structured error', async () => {
        const res = await fetch(`${base}/api/v1/tools/call`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'text_search', arguments: { query: '' } }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(typeof body.error?.message).toBe('string');
    });
});
