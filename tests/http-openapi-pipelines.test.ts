import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP OpenAPI includes pipelines endpoints', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7015; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: true });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_API_PORT;
    });

    test('paths present', async () => {
        const res = await fetch(`${base}/openapi.json`);
        expect(res.status).toBe(200);
        const spec = await res.json();
        const paths = spec?.paths || {};
        expect(paths['/api/v1/pipelines/status']).toBeDefined();
        expect(paths['/api/v1/pipelines/runs']).toBeDefined();
        expect(paths['/api/v1/pipelines/run']).toBeDefined();
        expect(paths['/api/v1/pipelines']).toBeDefined();
    });
});
