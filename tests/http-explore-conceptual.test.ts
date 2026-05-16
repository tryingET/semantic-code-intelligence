import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import path from 'node:path';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/explore with conceptual flag', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7013; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        process.env.HTTP_PORT = String(port);
        // Do not force augmentation here; we only verify success shape
        delete process.env.L4_AUGMENT_EXPLORE;
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_PORT;
    });

    test('returns 200 and data structure', async () => {
        const fixturesDir = path.join(process.cwd(), 'tests', 'fixtures');
        const fileUri = `file://${fixturesDir}`;

        const res = await fetch(`${base}/api/v1/explore`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                identifier: 'TestClass',
                uri: fileUri,
                includeDeclaration: true,
                maxResults: 10,
                conceptual: true,
            }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data).toBeDefined();
        expect(Array.isArray(body.data.definitions)).toBe(true);
        expect(Array.isArray(body.data.references)).toBe(true);
    });
});
