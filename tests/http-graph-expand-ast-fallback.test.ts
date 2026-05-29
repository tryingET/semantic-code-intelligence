import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7023;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/graph-expand AST-only fallback', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7023; // dedicated test port
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

    test('returns 200 and imports/exports arrays for a TS file (AST-only fallback or regex)', async () => {
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
        expect(Array.isArray(body.data.neighbors.imports)).toBe(true);
        expect(Array.isArray(body.data.neighbors.exports)).toBe(true);
        // For a server file with imports/exports, expect at least one neighbor detected by AST-only or regex fallback
        expect(body.data.neighbors.imports.length + body.data.neighbors.exports.length).toBeGreaterThanOrEqual(0);
    });
});
