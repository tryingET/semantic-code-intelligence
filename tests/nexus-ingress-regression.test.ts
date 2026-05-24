import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HTTPAdapter } from '../src/adapters/http-adapter';
import { ToolWorkflowRouter } from '../src/core/workflows/tool-workflow-router';
import { HTTPServer } from '../src/servers/http';
import { canBindTcp } from './helpers/bind-utils';

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

function pickRandomPort(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

bindDescribe('Nexus HTTP ingress regressions', () => {
    let server: HTTPServer;
    const host = '127.0.0.1';
    let base = '';
    let workspace = '';

    beforeAll(async () => {
        workspace = mkdtempSync(join(tmpdir(), 'sci-nexus-http-'));
        writeFileSync(join(workspace, 'target.ts'), 'function WorkspaceOnlyNexus() { return 1; }\n');
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 8; attempt++) {
            const port = pickRandomPort(7200, 7999);
            base = `http://${host}:${port}`;
            server = new HTTPServer({ host, port, workspaceRoot: workspace, enableOpenAPI: false });
            try {
                await server.start();
                return;
            } catch (error) {
                lastError = error;
                try {
                    await server.stop();
                } catch {}
            }
        }
        throw lastError ?? new Error('Failed to bind HTTP test server');
    });

    afterAll(async () => {
        await server.stop();
        rmSync(workspace, { recursive: true, force: true });
    });

    test('rejects non-loopback browser origins before tool dispatch', async () => {
        const res = await fetch(`${base}/api/v1/tools/call`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
            body: JSON.stringify({ name: 'get_snapshot', arguments: {} }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
        expect(body.error?.message).toContain('origin');
    });

    test('rejects non-loopback browser origins before adapter fallback routes', async () => {
        const res = await fetch(`${base}/api/v1/definition`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
            body: JSON.stringify({ identifier: 'WorkspaceOnlyNexus', file: 'target.ts' }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
    });

    test('enforces bounded JSON request bodies before parsing', async () => {
        const previous = process.env.SCI_HTTP_MAX_JSON_BODY_BYTES;
        process.env.SCI_HTTP_MAX_JSON_BODY_BYTES = '32';
        try {
            const res = await fetch(`${base}/api/v1/tools/call`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'get_snapshot', arguments: { blob: 'x'.repeat(80) } }),
            });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.error?.message).toContain('maximum size');
        } finally {
            if (previous === undefined) delete process.env.SCI_HTTP_MAX_JSON_BODY_BYTES;
            else process.env.SCI_HTTP_MAX_JSON_BODY_BYTES = previous;
        }
    });

    test('direct HTTP ast-query uses configured workspace root rather than process cwd', async () => {
        const res = await fetch(`${base}/api/v1/ast-query`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                language: 'typescript',
                query: '(function_declaration name: (identifier) @name)',
                paths: ['target.ts'],
                limit: 10,
            }),
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.count).toBeGreaterThan(0);
        expect(JSON.stringify(body.data)).toContain('WorkspaceOnlyNexus');
    });
});

describe('Nexus workflow boundary regressions', () => {
    test('build_symbol_map rejects file inputs outside the configured workspace', async () => {
        const workspace = mkdtempSync(join(tmpdir(), 'sci-nexus-router-ws-'));
        const outside = mkdtempSync(join(tmpdir(), 'sci-nexus-router-outside-'));
        try {
            const outsideFile = join(outside, 'outside.ts');
            writeFileSync(outsideFile, 'export const SecretOutside = 1;\n');
            const routerCore = {
                config: { workspaceRoot: workspace },
                buildSymbolMap: async () => {
                    throw new Error('core analyzer should not receive outside file');
                },
            } as unknown as ConstructorParameters<typeof ToolWorkflowRouter>[0];
            const router = new ToolWorkflowRouter(routerCore);

            await expect(
                router.execute('build_symbol_map', { symbol: 'SecretOutside', file: outsideFile })
            ).rejects.toThrow('workspace');
        } finally {
            rmSync(workspace, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('HTTP response cache varies on definition request semantics', async () => {
        let calls = 0;
        const file = resolve(process.cwd(), 'package.json');
        const uri = pathToFileURL(file).href;
        const adapterCore = {
            config: { workspaceRoot: process.cwd() },
            findDefinition: async (request: { uri: string; maxResults: number }) => {
                calls += 1;
                return {
                    data: [
                        {
                            uri: request.uri,
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                            kind: 'function',
                            name: `max:${request.maxResults}`,
                        },
                    ],
                    performance: {},
                    requestId: `req-${calls}`,
                    timestamp: Date.now(),
                    cacheHit: false,
                };
            },
        } as unknown as ConstructorParameters<typeof HTTPAdapter>[0];
        const adapter = new HTTPAdapter(adapterCore, { enableCors: false, maxResults: 100 });

        const first = await adapter.handleRequest({
            method: 'POST',
            url: 'http://localhost/api/v1/definition',
            headers: {},
            body: JSON.stringify({ identifier: 'x', file: uri, maxResults: 1 }),
        });
        const second = await adapter.handleRequest({
            method: 'POST',
            url: 'http://localhost/api/v1/definition',
            headers: {},
            body: JSON.stringify({ identifier: 'x', file: uri, maxResults: 2 }),
        });

        expect(first.headers['X-Cache']).not.toBe('HIT');
        expect(second.headers['X-Cache']).not.toBe('HIT');
        expect(calls).toBe(2);
        expect(JSON.parse(second.body).data[0].name).toBe('max:2');
    });
});
