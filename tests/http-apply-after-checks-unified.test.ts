import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { overlayStore } from '../src/core/overlay-store';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const host = '127.0.0.1';
const port = 7020;
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

function unwrap(result: any): any {
    try {
        const txt = result?.content?.[0]?.text;
        return txt ? JSON.parse(txt) : result;
    } catch {
        return result;
    }
}

bindDescribe('safe_write with unified diff (applied=true)', () => {
    let server: HTTPServer;
    const base = `http://${host}:${port}`;
    // Use a unique temp file to avoid conflicts with parallel tests
    const testId = `http-unified-${Date.now()}`;
    const tempFilePath = path.join(process.cwd(), `tests/fixtures/temp-${testId}.ts`);
    const tempFileRel = `tests/fixtures/temp-${testId}.ts`;

    beforeAll(async () => {
        // Clear overlay store to ensure test isolation
        overlayStore.clearAll();
        // Create a clean temp file for this test
        const templateContent = `/**
 * Temp fixture for http-apply-after-checks-unified test
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
        delete process.env.ALLOW_SNAPSHOT_APPLY;
    });

    test('applies unified diff and then reverts it', async () => {
        const marker = '// unified safe_write test';
        const before = await fs.readFile(tempFilePath, 'utf8');
        // Proper unified diff against working tree
        const patch = [
            `diff --git a/${tempFileRel} b/${tempFileRel}`,
            `--- a/${tempFileRel}`,
            `+++ b/${tempFileRel}`,
            '@@ -5,2 +5,3 @@',
            ' export class TestClass {',
            `+    ${marker}`,
            '     private value: number = 0;',
            '',
        ].join('\n');

        // Stage -> checks -> apply
        const res = await callTool(base, 'safe_write', {
            patch,
            apply: true,
            commands: ['true'],
            timeoutSec: 60,
        });
        const out = unwrap(res);
        expect(out).toBeDefined();
        expect(out.checks?.ok).toBe(true);
        expect(out.applied).toBe(true);
        const snapId = String(out.snapshot || '');
        expect(snapId.length).toBeGreaterThan(0);

        // Verify file was changed on disk
        const afterApply = await fs.readFile(tempFilePath, 'utf8');
        expect(afterApply).toContain(marker);
        expect(afterApply).not.toEqual(before);

        await fs.writeFile(tempFilePath, before, 'utf8');
        const afterRestore = await fs.readFile(tempFilePath, 'utf8');
        expect(afterRestore).toEqual(before);
    }, 30000);
});
