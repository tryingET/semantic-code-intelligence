import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7015;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP tools/call', () => {
    let server: HTTPServer;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('POST /api/v1/tools/call executes get_snapshot', async () => {
        const res = await fetch(`${base}/api/v1/tools/call`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'get_snapshot', arguments: { preferExisting: true } }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.result).toBeDefined();
    });
});
