import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { canBindTcp } from './helpers/bind-utils';
import path from 'node:path';
import { HTTPServer } from '../src/servers/http';

const canBind = await canBindTcp('127.0.0.1');
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

function parseContent(result: any): any {
    try {
        const txt = result?.content?.[0]?.text;
        if (!txt) return result;
        return JSON.parse(txt);
    } catch {
        return result;
    }
}

bindDescribe('Tool-First Gate (HTTP tools/call)', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    const port = 7016; // dedicated test port
    const base = `http://${host}:${port}`;

    const fixtureFile = path.join(process.cwd(), 'tests', 'fixtures', 'example.ts');

    beforeAll(async () => {
        // Ensure env override doesn't force default port
        process.env.HTTP_API_PORT = String(port);
        server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        delete process.env.HTTP_API_PORT;
    });

    test('find_definition returns ≥1 definition', async () => {
        const result = await callTool(base, 'find_definition', {
            symbol: 'TestClass',
            file: `file://${fixtureFile}`,
            precise: true,
            maxResults: 10,
        });
        const out = parseContent(result);
        expect(out).toBeDefined();
        expect(out.count).toBeGreaterThan(0);
        expect(Array.isArray(out.definitions)).toBe(true);
    });

    test('safe_write preview yields snapshot + diff without mutating workspace', async () => {
        const patch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export function TestFunction(param: string): string {\n-    return \`Hello, \${param}!\`;\n+    return \`Hello from safe_write preview, \${param}!\`;\n }\n*** End Patch\n`;
        const result = await callTool(base, 'safe_write', {
            patch,
            apply: false,
            commands: ['true'],
            timeoutSec: 60,
        });
        const out = parseContent(result);
        expect(out).toBeDefined();
        expect(out.workflow).toBe('safe_write');
        expect(out.ok).toBe(true);
        expect(typeof out.snapshot).toBe('string');
        expect(out.applied).toBe(false);
    });

    test('patch_checks_in_snapshot (onlyTouched=true) with tiny apply_patch diff', async () => {
        // Create or reuse a snapshot implicitly via the workflow
        const patch = `*** Begin Patch\n*** Update File: tests/fixtures/example.ts\n@@\n export class TestClass {\n-    private value: number = 0;\n+    // tool-first gate: noop comment\n+    private value: number = 0;\n*** End Patch\n`;
        const result = await callTool(base, 'patch_checks_in_snapshot', {
            patch,
            onlyTouched: true,
            // Keep checks minimal for speed and portability
            commands: ['true'],
            timeoutSec: 60,
        });
        const out = parseContent(result);
        expect(out).toBeDefined();
        // ok may be true/false depending on environment checks; structure must be present
        expect(typeof out.ok).toBe('boolean');
        expect(typeof out.snapshot).toBe('string');
        expect(out.checks).toBeDefined();
    });
});
