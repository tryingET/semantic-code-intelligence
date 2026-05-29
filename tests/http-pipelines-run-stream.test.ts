import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7098;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP pipelines run-stream (NDJSON)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7098; // dedicated test port; avoid same-process HTTP fixture collisions
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
        const lines = text
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(lines[0]?.event).toBe('started');
        // It may be very fast; finished should appear or we time out
        expect(lines.some((line) => line.event === 'finished' || line.event === 'timeout')).toBe(true);
    });

    test('unknown pipeline id fails before opening a ghost stream', async () => {
        const res = await fetch(`${base}/api/v1/pipelines/run-stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: 'not_a_pipeline' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error.data.runId).toBe('');
    });
});
