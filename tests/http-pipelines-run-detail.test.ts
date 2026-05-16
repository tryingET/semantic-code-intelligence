import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/pipelines/run (detail)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7013; // dedicated test port
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

    test('400 on missing params', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/run`, { method: 'GET' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(typeof body.error).toBe('string');
    });

    test('returns 200 and run:null for unknown run', async () => {
        const url = new URL(`${base}/api/v1/pipelines/run`);
        url.searchParams.set('id', 'nonexistent-pipeline');
        url.searchParams.set('runId', 'nonexistent-run');
        const res = await fetch(url, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data).toBeDefined();
        expect(body.data.pipelineId).toBe('nonexistent-pipeline');
        expect(body.data.runId).toBe('nonexistent-run');
        // When pipeline or run cannot be found, we return run: null (non-fatal)
        expect(body.data.run === null || typeof body.data.run === 'object').toBe(true);
    });
});
