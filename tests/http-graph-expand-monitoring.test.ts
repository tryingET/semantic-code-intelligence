import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7024;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /api/v1/graph-expand monitoring counter', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7024; // dedicated test port
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

    test('increments graph_expand_fallback counter and returns stable success shape', async () => {
        // Baseline monitoring read
        const m0 = await fetch(`${base}/api/v1/monitoring`).then((r) => r.json());
        const baseline = Number(m0?.data?.toolCounts?.graph_expand_fallback || 0);
        const baselineNote = Number(m0?.data?.toolCounts?.graph_expand_note || 0);

        // Trigger fallback reliably using an unsupported file type (README.md exists in repo)
        const res = await fetch(`${base}/api/v1/graph-expand`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                file: 'README.md',
                edges: ['imports', 'exports', 'callers', 'callees'],
                depth: 1,
                limit: 10,
            }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data).toBeDefined();
        expect(body.data.neighbors).toBeDefined();
        // Success shape stability: neighbors object with expected arrays
        const n = body.data.neighbors;
        expect(Array.isArray(n.imports)).toBe(true);
        expect(Array.isArray(n.exports)).toBe(true);
        expect(Array.isArray(n.callers)).toBe(true);
        expect(Array.isArray(n.callees)).toBe(true);

        // Post-call monitoring read
        const m1 = await fetch(`${base}/api/v1/monitoring`).then((r) => r.json());
        const after = Number(m1?.data?.toolCounts?.graph_expand_fallback || 0);
        const afterNote = Number(m1?.data?.toolCounts?.graph_expand_note || 0);
        expect(after).toBeGreaterThanOrEqual(baseline + 1);
        expect(afterNote).toBeGreaterThanOrEqual(baselineNote + 1);
    });
});
