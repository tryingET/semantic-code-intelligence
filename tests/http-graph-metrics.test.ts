import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7068;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP metrics for graph-expand', () => {
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

    test('records graph_expand primary or fallback on request', async () => {
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'src/servers/http.ts', edges: ['imports', 'exports'], depth: 1, limit: 10 }),
        });
        expect(res.status).toBe(200);
        const metrics = await fetch(`${base}/metrics`);
        const text = await metrics.text();
        expect(text).toContain('tool_calls_total');
        expect(text).toContain('adapter="http"');
        // Either primary or fallback must be present depending on environment
        expect(text.match(/tool="graph_expand_(primary|fallback)"/)).toBeTruthy();
    }, 15000);

    test('records graph_expand_fallback on error', async () => {
        // Use unsupported file type to force expandNeighbors to throw and trigger fallback
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'README.md', edges: ['imports', 'exports'], depth: 1, limit: 5 }),
        });
        expect(res.status).toBe(200);
        const metrics = await fetch(`${base}/metrics`);
        const text = await metrics.text();
        expect(text).toContain('tool_calls_total');
        expect(text).toContain('adapter="http"');
        expect(text).toContain('tool="graph_expand_fallback"');
    }, 15000);

    test('records graph_expand_note when a note is returned', async () => {
        // Callers without a symbol returns a note (but should still succeed)
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'src/servers/http.ts', edges: ['callers'], depth: 1, limit: 10 }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(typeof body.data?.note).toBe('string');

        const metrics = await fetch(`${base}/metrics`);
        const text = await metrics.text();
        expect(text).toContain('tool_calls_total');
        expect(text).toContain('adapter="http"');
        expect(text).toContain('tool="graph_expand_note"');
    }, 15000);
});
