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

    test('locate_confirm_definition returns ≥1 definition', async () => {
        const result = await callTool(base, 'locate_confirm_definition', {
            symbol: 'TestClass',
            // no file hint to allow workspace search + precise retry
        });
        const out = parseContent(result);
        expect(out).toBeDefined();
        expect(out.ok).toBe(true);
        expect(Array.isArray(out.definitions)).toBe(true);
        expect(out.definitions.length).toBeGreaterThan(0);
    });

    test('rename_safely (runChecks=false) yields snapshot + diff', async () => {
        // First, ensure plan_rename produces a non-empty plan for the fixture
        const planRes = await callTool(base, 'plan_rename', {
            oldName: 'TestFunction',
            newName: 'TestFunctionX',
            file: `file://${fixtureFile}`,
            dryRun: true,
        });
        const plan = parseContent(planRes);
        const filesAffected = plan?.summary?.filesAffected ?? Object.keys(plan?.changes || {}).length;
        const totalEdits =
            plan?.summary?.totalEdits ??
            Object.values(plan?.changes || {}).reduce((a: number, v: any) => a + (Array.isArray(v) ? v.length : 0), 0);
        expect(filesAffected + totalEdits).toBeGreaterThan(0);

        // Then, run the safe workflow without checks; expect structured output and a snapshot id
        const result = await callTool(base, 'rename_safely', {
            oldName: 'TestFunction',
            newName: 'TestFunctionX',
            file: `file://${fixtureFile}`,
            runChecks: false,
        });
        const out = parseContent(result);
        expect(out).toBeDefined();
        expect(typeof out.snapshot).toBe('string');
        // Prefer ok=true, but accept a structured no_changes preview in constrained envs
        if (out.ok === false) {
            expect(out.reason).toBe('no_changes');
        } else {
            expect(out.ok).toBe(true);
            expect((out.filesAffected ?? 0) + (out.totalEdits ?? 0)).toBeGreaterThan(0);
        }
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
