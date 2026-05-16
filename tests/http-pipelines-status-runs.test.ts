import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP pipelines status & runs', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7014; // dedicated test port
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

    test('status: 400 on missing id', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/status`, { method: 'GET' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
    });

    test('status: 200 with ok:false for unknown id (non-fatal)', async () => {
        const url = new URL(`${base}/api/v1/pipelines/status`);
        url.searchParams.set('id', 'not_a_pipeline');
        const res = await fetch(url, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(typeof body.data).toBe('object');
    });

    test('status: includes nextRunAt for scheduled pipelines', async () => {
        const url = new URL(`${base}/api/v1/pipelines/status`);
        url.searchParams.set('id', 'daily_insights');
        const res = await fetch(url, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data?.id).toBe('daily_insights');
        expect(body.data?.schedule).toBeTruthy();
        expect(typeof body.data?.nextRunAt === 'number' || body.data?.nextRunAt === null).toBe(true);
        expect(typeof body.data?.lastRunAt === 'number' || body.data?.lastRunAt === null).toBe(true);
    });

    test('runs: 400 on missing id', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/runs`, { method: 'GET' });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
    });

    test('runs: 200 with [] for unknown id', async () => {
        const url = new URL(`${base}/api/v1/pipelines/runs`);
        url.searchParams.set('id', 'not_a_pipeline');
        url.searchParams.set('limit', '5');
        const res = await fetch(url, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data?.runs)).toBe(true);
    });
});
