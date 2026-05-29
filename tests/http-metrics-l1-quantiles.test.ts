import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7011;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('HTTP /metrics JSON includes L1 quantiles', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7011; // avoid collision with other metrics test
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('returns L1 layer quantile fields when L1 is present', async () => {
        const res = await fetch(`${base}/metrics?format=json`);
        expect(res.status).toBeGreaterThanOrEqual(200);
        expect(res.status).toBeLessThan(500);
        const body = await res.json();
        // Only assert when L1 is available (real or mock)
        if (body?.l1?.layer) {
            const layer = body.l1.layer as Record<string, unknown>;
            expect(typeof layer.searches).toBe('number');
            // New quantile fields should exist as numbers (may be 0 with no samples yet)
            expect(typeof layer.lastResponseTime).toBe('number');
            expect(typeof layer.p50ResponseTime).toBe('number');
            expect(typeof layer.p95ResponseTime).toBe('number');
            expect(typeof layer.p99ResponseTime).toBe('number');
        }
    });
});
