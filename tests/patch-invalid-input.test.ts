import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

async function callTool(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    // Accept either 200 (normalized result) or 400 (normalized error)
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
    return await res.json();
}

bindDescribe('Patch workflow rejects non-diff input early', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7018;
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
    });

    test('patch_checks_in_snapshot returns invalid_patch on plain text', async () => {
        const plain = "console.log('hello world');\n";
        const resp = await callTool(base, 'patch_checks_in_snapshot', { patch: plain, timeoutSec: 30 });
        if (resp.success === true) {
            const txt = resp.result?.content?.[0]?.text ?? '';
            const obj = (() => {
                try {
                    return JSON.parse(txt);
                } catch {
                    return {};
                }
            })();
            expect(obj.ok).toBe(false);
            expect(obj.reason).toBe('invalid_patch');
        } else {
            // HTTP adapter returned normalized error
            expect(resp.success).toBe(false);
            const msg = String(resp.error?.message || '');
            expect(msg.toLowerCase()).toContain('invalid_patch');
        }
    });
});
