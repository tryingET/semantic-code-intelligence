import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7021;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

async function waitFor<T>(fn: () => Promise<T>, predicate: (t: T) => boolean, timeoutMs: number): Promise<T> {
    const start = Date.now();
    let last: T;
    while (Date.now() - start < timeoutMs) {
        last = await fn();
        if (predicate(last)) return last;
        await new Promise((r) => setTimeout(r, 100));
    }
    return last!;
}

bindDescribe('HTTP scheduled pipelines (PIPELINES_ENABLE=1)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7021; // dedicated test port
    const base = `http://${host}:${port}`;

    const prevEnable = process.env.PIPELINES_ENABLE;

    beforeAll(async () => {
        process.env.PIPELINES_ENABLE = '1';
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_API_PORT;
        if (prevEnable == null) delete process.env.PIPELINES_ENABLE;
        else process.env.PIPELINES_ENABLE = prevEnable;
    });

    async function registerPipeline(payload: any) {
        const res = await fetch(`${base}/api/v1/pipelines`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        return body.data;
    }

    async function status(id: string) {
        const url = new URL(`${base}/api/v1/pipelines/status`);
        url.searchParams.set('id', id);
        const res = await fetch(url, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        return body.data;
    }

    async function runs(id: string, limit: number = 10) {
        const url = new URL(`${base}/api/v1/pipelines/runs`);
        url.searchParams.set('id', id);
        url.searchParams.set('limit', String(limit));
        const res = await fetch(url, { method: 'GET' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        return body.data?.runs || [];
    }

    test('scheduled @every runs and is persisted in pipeline_runs', async () => {
        const id = `dev_every_${Date.now()}`;
        await registerPipeline({
            id,
            name: 'Dev Every Test',
            description: 'integration test scheduled pipeline',
            components: ['noop'],
            trigger: 'scheduled',
            schedule: '@every 1s',
            enabled: true,
        });

        const list = await waitFor(
            () => runs(id, 5),
            (arr) => Array.isArray(arr) && arr.length > 0,
            10000
        );
        expect(Array.isArray(list)).toBe(true);
        expect(list.length).toBeGreaterThan(0);
        expect(list[0].pipeline_id).toBe(id);
        expect(list[0].status).toBe('success');

        const st = await status(id);
        expect(st.id).toBe(id);
        expect(st.trigger).toBe('scheduled');
        expect(st.schedule).toBe('@every 1s');
        expect(typeof st.lastRunAt === 'number' || st.lastRunAt === null).toBe(true);
        expect(typeof st.nextRunAt === 'number' || st.nextRunAt === null).toBe(true);
    }, 12000);

    test('parses cron variants and reports unsupported schedules explicitly', async () => {
        const cronEvery2 = `dev_cron_every2_${Date.now()}`;
        await registerPipeline({
            id: cronEvery2,
            name: 'Dev Cron Every 2 Min',
            components: ['noop'],
            trigger: 'scheduled',
            schedule: '*/2 * * * *',
            enabled: true,
        });
        const stEvery2 = await status(cronEvery2);
        expect(typeof stEvery2.nextRunAt).toBe('number');
        expect(stEvery2.scheduleNote == null || stEvery2.scheduleNote === null).toBe(true);

        const bad = `dev_bad_cron_${Date.now()}`;
        await registerPipeline({
            id: bad,
            name: 'Dev Bad Cron',
            components: ['noop'],
            trigger: 'scheduled',
            schedule: '0 0 1 * *',
            enabled: true,
        });
        const stBad = await status(bad);
        expect(stBad.nextRunAt).toBe(null);
        expect(stBad.scheduleNote).toBe('unsupported_schedule');
    });
});
