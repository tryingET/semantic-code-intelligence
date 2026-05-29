import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7016;
const canBind = await canBindTcp(host, port);
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

    test('unknown id fails without returning a ghost run id', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/run`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'not_a_pipeline' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.data?.ok).toBe(false);
        expect(body.data?.runId).toBe('');
    });
});
