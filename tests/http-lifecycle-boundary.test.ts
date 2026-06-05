import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../src/core/overlay-store';
import { HTTPServer } from '../src/servers/http';

const host = '127.0.0.1';

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

function unwrap(result: any): any {
    try {
        const txt = result?.content?.[0]?.text;
        return txt ? JSON.parse(txt) : result;
    } catch {
        return result;
    }
}

test('HTTP server stop closes active connections so a new server lifecycle owns pipeline requests', async () => {
    const port = 0;
    let base = '';
    const oldPort = process.env.HTTP_API_PORT;
    const oldApply = process.env.ALLOW_SNAPSHOT_APPLY;
    const testId = `http-lifecycle-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const tempFilePath = path.join(process.cwd(), `tests/fixtures/temp-${testId}.ts`);
    const tempFileRel = `tests/fixtures/temp-${testId}.ts`;
    const before = ['export class LifecycleBoundary {', '    value = 1;', '}', ''].join('\n');
    let server: HTTPServer | null = null;

    try {
        overlayStore.clearAll();
        await fs.writeFile(tempFilePath, before, 'utf8');
        process.env.HTTP_API_PORT = String(port);
        process.env.ALLOW_SNAPSHOT_APPLY = '1';

        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
        base = `http://${host}:${(server as any).server?.port}`;
        const patch = [
            `diff --git a/${tempFileRel} b/${tempFileRel}`,
            `--- a/${tempFileRel}`,
            `+++ b/${tempFileRel}`,
            '@@ -1,2 +1,3 @@',
            ' export class LifecycleBoundary {',
            '+    // lifecycle marker',
            '     value = 1;',
            '',
        ].join('\n');
        const out = unwrap(await callTool(base, 'safe_write', { patch, apply: true, commands: ['true'] }));
        expect(out.applied).toBe(true);
        await fs.writeFile(tempFilePath, before, 'utf8');
        await server.stop();
        server = null;

        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
        base = `http://${host}:${(server as any).server?.port}`;
        const id = `lifecycle_pipeline_${Date.now()}`;
        const res = await fetch(`${base}/api/v1/pipelines`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                id,
                name: 'Lifecycle Pipeline',
                components: ['pattern_learning'],
                trigger: 'manual',
                enabled: true,
            }),
        });
        const body = await res.json();
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data?.id).toBe(id);
    } finally {
        await server?.stop().catch(() => undefined);
        await fs.unlink(tempFilePath).catch(() => undefined);
        if (oldPort === undefined) delete process.env.HTTP_API_PORT;
        else process.env.HTTP_API_PORT = oldPort;
        if (oldApply === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
        else process.env.ALLOW_SNAPSHOT_APPLY = oldApply;
    }
}, 30000);
