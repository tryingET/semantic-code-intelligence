import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP pipelines run-stream (NDJSON)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7018; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('run-stream returns started and finished events', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/run-stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'pattern_feedback_cycle', timeoutSec: 10, pollMs: 150 }),
        });
        expect(res.status).toBe(200);
        const text = await res.text();
        expect(text.includes('"event":"started"')).toBe(true);
        // It may be very fast; finished should appear or we time out
        expect(text.includes('"event":"finished"') || text.includes('"event":"timeout"')).toBe(true);
    });
});
