import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /metrics JSON includes layerManager performance', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7012;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('JSON metrics has layerManager with performance object', async () => {
        const res = await fetch(`${base}/metrics?format=json`);
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(500);
        const body = await res.json();
        expect(body.layerManager).toBeDefined();
        expect(body.layerManager.performance).toBeDefined();
    });
});
