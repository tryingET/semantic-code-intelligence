import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/graph-expand fallback', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7012; // dedicated test port
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

    test('malformed JSON request fails closed as caller error', async () => {
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{',
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(body.error?.message).toBe('Invalid JSON');
    });

    test('returns 200 and structure for file even if parser unavailable', async () => {
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ file: 'src/servers/http.ts', edges: ['imports', 'exports'], depth: 1, limit: 50 }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data).toBeDefined();
        expect(body.data.neighbors).toBeDefined();
        expect(body.data.neighbors.imports).toBeDefined();
        expect(body.data.neighbors.exports).toBeDefined();
    });

    test('returns 200 and structure for symbol fallback', async () => {
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ symbol: 'HTTPServer', edges: ['imports', 'exports'], depth: 1, limit: 20 }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data).toBeDefined();
        expect(body.data.neighbors).toBeDefined();
    });

    test('nonexistent file fails closed instead of returning empty fallback evidence', async () => {
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                file: 'this/does/not/exist.ts',
                edges: ['imports', 'exports', 'callers', 'callees'],
                depth: 1,
                limit: 10,
            }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(body.error?.message).toContain('does not exist');
        expect(JSON.stringify(body)).not.toContain('impactSummary');
    });

    test('invalid symbol returns success with neighbors object (non-fatal)', async () => {
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                symbol: 'DefinitelyNotASymbol',
                edges: ['imports', 'exports', 'callers', 'callees'],
                depth: 1,
                limit: 5,
            }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data).toBeDefined();
        expect(body.data.neighbors).toBeDefined();
        // Edges arrays should exist; may be empty depending on fallback path
        expect(body.data.neighbors).toHaveProperty('imports');
        expect(body.data.neighbors).toHaveProperty('exports');
        expect(body.data.neighbors).toHaveProperty('callers');
        expect(body.data.neighbors).toHaveProperty('callees');
    });
});
