import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/pipelines (register)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7020; // dedicated test port
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

    test('400 on missing required fields', async () => {
        const res = await fetch(`${base}/api/v1/pipelines`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
    });

    test('200 on register and retrievable via GET /pipelines/{id}', async () => {
        const id = `dev_test_pipeline_${Date.now()}`;
        const req = {
            id,
            name: 'Dev Test Pipeline',
            description: 'Registered by tests',
            components: ['pattern_learning', 'feedback_loop'],
            trigger: 'manual',
            enabled: true,
        };
        const res = await fetch(`${base}/api/v1/pipelines`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(req),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data?.id).toBe(id);

        const res2 = await fetch(`${base}/api/v1/pipelines/${encodeURIComponent(id)}`);
        expect(res2.status).toBe(200);
        const body2 = await res2.json();
        expect(body2.success).toBe(true);
        expect(body2.data?.id).toBe(id);
        expect(body2.data?.name).toBe('Dev Test Pipeline');
    });

    test('400 on invalid component instead of registering a successful no-op pipeline', async () => {
        const res = await fetch(`${base}/api/v1/pipelines`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id: `bad_component_${Date.now()}`,
                name: 'Bad Component Pipeline',
                components: ['definitely_not_a_component'],
                trigger: 'manual',
            }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error.message).toContain('Invalid pipeline component');
    });
});
