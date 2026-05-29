import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7017;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

async function callToolRaw(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    return { status: res.status, body: await res.json() };
}

bindDescribe('HTTP tools: learning pipeline legacy boundary', () => {
    let server: HTTPServer;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('pipeline registry tools are not exposed through the Alpha HTTP tools/call membrane', async () => {
        const calls = [
            ['list_pipelines', {}],
            ['run_pipeline', { id: 'pattern_feedback_cycle' }],
            ['list_pipeline_runs', { id: 'pattern_feedback_cycle', limit: 5 }],
        ] as const;
        for (const [name, args] of calls) {
            const result = await callToolRaw(base, name, args);
            expect(result.status, `${name} should be rejected`).toBe(400);
            expect(result.body.success).toBe(false);
            expect(result.body.error.message).toContain('not available');
        }
    });
});
