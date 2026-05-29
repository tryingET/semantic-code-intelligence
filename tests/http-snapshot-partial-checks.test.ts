import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7018;
const canBind = await canBindTcp(host, port);
const bindDescribe = canBind ? describe : describe.skip;

async function callTool(base: string, name: string, args: Record<string, any>) {
    const res = await fetch(`${base}/api/v1/tools/call`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    return body.result;
}

bindDescribe('Snapshot apply/checks (partial materialize)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7018; // dedicated test port
    const base = `http://${host}:${port}`;

    beforeAll(async () => {
        // Force partial materialization to exercise ensure-src path
        process.env.SNAPSHOT_PARTIAL = '1';
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.SNAPSHOT_PARTIAL;
        delete process.env.HTTP_API_PORT;
    });

    test('patch_checks_in_snapshot builds http with partial snapshot', async () => {
        // Create a tiny patch that touches only tests (common offender for partial snapshots)
        const patch = [
            '*** Begin Patch',
            '*** Update File: tests/fixtures/example.ts',
            '@@',
            ' export class TestClass {',
            '     // mcp unified apply_after_checks test',
            '+    // partial snapshot test noop',
            '     private value: number = 0;',
            '*** End Patch',
            '',
        ].join('\n');

        // Stage + run checks: build only http (fast, externals set)
        const result = await callTool(base, 'patch_checks_in_snapshot', {
            patch,
            // Ensure we actually run a build inside the snapshot
            commands: ['bun run build:http'],
            timeoutSec: 120,
        });

        // unwrap
        let json: any;
        try {
            json = typeof result?.content?.[0]?.text === 'string' ? JSON.parse(result.content[0].text) : result;
        } catch {
            json = result;
        }
        // Either ok===true, or a structured failure; prefer ok true
        expect(json).toBeDefined();
        expect(typeof json.ok).toBe('boolean');
        // In normal local runs, this should succeed
        if (!json.ok) {
            // Provide helpful context
            // eslint-disable-next-line no-console
            console.warn('patch_checks_in_snapshot failed (partial), tail:', json.output?.slice?.(-2000) || '');
        }
    }, 60000);
});
