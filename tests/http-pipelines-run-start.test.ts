import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/pipelines/run (start)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7016; // dedicated test port
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

    test('400 on missing id', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
    });

    test('200 with runId even for unknown id (non-fatal)', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'not_a_pipeline' }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(typeof body.data?.runId).toBe('string');
        expect(typeof body.data?.ok).toBe('boolean');
    });
});
