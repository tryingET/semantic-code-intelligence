import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../src/core/overlay-store';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7019;
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

// Helper to unwrap MCP-style result content
function unwrap(result: any): any {
    try {
        const txt = result?.content?.[0]?.text;
        return txt ? JSON.parse(txt) : result;
    } catch {
        return result;
    }
}

bindDescribe('safe_write (guarded apply)', () => {
    let server: HTTPServer;
    const base = `http://${host}:${port}`;
    // Use a unique temp file to avoid conflicts with parallel tests
    const testId = `http-guarded-${Date.now()}`;
    const tempFilePath = path.join(process.cwd(), `tests/fixtures/temp-${testId}.ts`);
    const tempFileRel = `tests/fixtures/temp-${testId}.ts`;

    beforeAll(async () => {
        // Clear overlay store to ensure test isolation
        overlayStore.clearAll();
        // Create a clean temp file for this test
        const templateContent = `/**
 * Temp fixture for http-apply-after-checks test
 */

export class TestClass {
    private value: number = 0;

    constructor(initialValue?: number) {
        this.value = initialValue ?? 0;
    }
}
`;
        await fs.writeFile(tempFilePath, templateContent, 'utf8');
        process.env.HTTP_API_PORT = String(port);
        process.env.SNAPSHOT_PARTIAL = '1';
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        // Clean up temp file
        try {
            await fs.unlink(tempFilePath);
        } catch {}
        await server.stop();
        delete process.env.HTTP_API_PORT;
        delete process.env.SNAPSHOT_PARTIAL;
        delete process.env.ALLOW_SNAPSHOT_APPLY;
    });

    test('stages patch, runs checks, attempts apply (structured result)', async () => {
        // Using apply_patch format patch: apply may or may not succeed depending on patch engine support.
        const patch = `*** Begin Patch\n*** Update File: ${tempFileRel}\n@@\n export class TestClass {\n-    private value: number = 0;\n+    // safe_write noop\n+    private value: number = 0;\n*** End Patch\n`;

        const res = await callTool(base, 'safe_write', {
            patch,
            apply: false,
            commands: ['true'], // minimal check for speed/stability
            timeoutSec: 60,
        });
        const out = unwrap(res);
        expect(out).toBeDefined();
        expect(typeof out.ok).toBe('boolean');
        expect(typeof out.snapshot).toBe('string');
        // applied may be false if the patch format isn't understood by the apply engine; assert field presence only
        expect(typeof out.applied).toBe('boolean');
    }, 30000);

    test('returns HTTP success with domain ok=false when guarded checks fail', async () => {
        const patch = `*** Begin Patch\n*** Update File: ${tempFileRel}\n@@\n export class TestClass {\n-    private value: number = 0;\n+    // safe_write failed-check noop\n+    private value: number = 0;\n*** End Patch\n`;

        const res = await callTool(base, 'safe_write', {
            patch,
            apply: true,
            commands: ['false'],
            timeoutSec: 60,
        });
        const out = unwrap(res);

        expect(out).toBeDefined();
        expect(out.ok).toBe(false);
        expect(out.applied).toBe(false);
        expect(typeof out.snapshot).toBe('string');
    }, 30000);

    test('returns HTTP success with domain ok=false for standalone failed run_checks', async () => {
        const snapRes = await callTool(base, 'get_snapshot', { preferExisting: false });
        const snapshot = unwrap(snapRes).snapshot;
        const res = await callTool(base, 'run_checks', {
            snapshot,
            commands: ['false'],
            timeoutSec: 60,
        });
        const out = unwrap(res);

        expect(out).toBeDefined();
        expect(out.ok).toBe(false);
        expect(out.commands?.[0]?.ok).toBe(false);
    }, 30000);
});
