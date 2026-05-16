import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { canBindTcp } from './helpers/bind-utils';
import { initMcpHttpSession, mcpHttpHeaders } from './helpers/mcp-http';
import { HTTPAdapter } from '../src/adapters/http-adapter.js';
import { LSPAdapter } from '../src/adapters/lsp-adapter.js';
import { HTTPServer } from '../src/servers/http';

function wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function pickRandomPort(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

describe('Error envelope parity (edge cases)', () => {
    test('HTTPAdapter: invalid JSON maps to InvalidParams details', async () => {
        const adapter = new HTTPAdapter({} as any, { enableCors: false, enableOpenAPI: false });
        const res = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: mcpHttpHeaders(),
            body: 'invalid json',
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(false);
        expect(body.details?.code).toBe('InvalidParams');
    });

    test('HTTPAdapter: missing params maps to InvalidParams details', async () => {
        const adapter = new HTTPAdapter({} as any, { enableCors: false, enableOpenAPI: false });
        const res = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: mcpHttpHeaders(),
            body: '{}',
        });

        expect(res.status).toBe(400);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(false);
        expect(body.details?.code).toBe('InvalidParams');
        expect(String(body.details?.message || '')).toContain('Missing required parameter');
    });

    test('HTTPAdapter: unknown route maps to UnknownTool details', async () => {
        const adapter = new HTTPAdapter({} as any, { enableCors: false, enableOpenAPI: false });
        const res = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/nope',
            headers: mcpHttpHeaders(),
            body: '{}',
        });

        expect(res.status).toBe(404);
        const body = JSON.parse(res.body);
        expect(body.success).toBe(false);
        expect(body.details?.code).toBe('UnknownTool');
    });

    test('LSPAdapter: null params maps to InvalidParams (-32602)', async () => {
        const adapter = new LSPAdapter({
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async () => ({ data: [] }),
            findDefinitionAsync: async () => ({ data: [] }),
            findReferencesAsync: async () => ({ data: [] }),
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
        } as any);

        try {
            // @ts-expect-error - intentionally invalid
            await adapter.handleDefinition(null);
            throw new Error('Expected LSP error');
        } catch (err: any) {
            expect(err?.code).toBe(-32602);
        }
    });

    bindDescribe('HTTPServer tools/call edge cases', () => {
        let server: HTTPServer;
        const host = '127.0.0.1';
        let port: number;
        let base: string;

        beforeAll(async () => {
            let lastError: unknown = null;
            for (let attempt = 0; attempt < 8; attempt++) {
                port = pickRandomPort(7100, 7999);
                base = `http://${host}:${port}`;
                server = new HTTPServer({ host, port, workspaceRoot: process.cwd(), enableOpenAPI: false });
                try {
                    await server.start();
                    return;
                } catch (err) {
                    lastError = err;
                    try {
                        await server.stop();
                    } catch {}
                    const msg = String(err);
                    if (msg.includes('EADDRINUSE') || msg.includes('in use')) {
                        continue;
                    }
                    throw err;
                }
            }
            throw lastError ?? new Error('Failed to bind HTTP server after retries');
        });

        afterAll(async () => {
            await server.stop();
        });

        test('invalid JSON maps to InvalidParams', async () => {
            const res = await fetch(`${base}/api/v1/tools/call`, {
                method: 'POST',
                headers: mcpHttpHeaders(),
                body: 'invalid json',
            });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.error?.code).toBe('InvalidParams');
        });

        test('missing tool name maps to InvalidParams', async () => {
            const res = await fetch(`${base}/api/v1/tools/call`, {
                method: 'POST',
                headers: mcpHttpHeaders(),
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.error?.code).toBe('InvalidParams');
        });

        test('unknown tool maps to UnknownTool (404)', async () => {
            const res = await fetch(`${base}/api/v1/tools/call`, {
                method: 'POST',
                headers: mcpHttpHeaders(),
                body: JSON.stringify({ name: 'no_such_tool', arguments: {} }),
            });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.error?.code).toBe('UnknownTool');
        });
    });
    bindDescribe('MCP HTTP error envelopes', () => {
        const host = '127.0.0.1';
        let port: number;
        let base: string;
        const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
        let server: ReturnType<typeof spawn> | null = null;

        async function parseMcpBody(res: Response) {
            if (!res.body) return {};
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let text = '';
            try {
                for (let i = 0; i < 4; i++) {
                    const { value, done } = await reader.read();
                    if (value) text += decoder.decode(value, { stream: !done });
                    try {
                        return JSON.parse(text);
                    } catch {}
                    const line = text.split(/\r?\n/).find((l) => l.startsWith('data: '));
                    if (line) {
                        try {
                            return JSON.parse(line.replace(/^data:\s*/, ''));
                        } catch {}
                        return {};
                    }
                    if (done) break;
                }
            } finally {
                await reader.cancel();
            }
            return {};
        }

        beforeAll(async () => {
            let lastError: unknown = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                port = pickRandomPort(8100, 8999);
                base = `http://${host}:${port}/mcp`;
                server = spawn(bun, ['run', 'src/servers/mcp-http.ts'], {
                    env: {
                        ...process.env,
                        MCP_HTTP_HOST: host,
                        MCP_HTTP_PORT: String(port),
                        HTTP_API_PORT: String(port + 9),
                    },
                });
                await wait(500);
                try {
                    const resp = await fetch(base, {
                        method: 'POST',
                        headers: mcpHttpHeaders(),
                        body: JSON.stringify({
                            jsonrpc: '2.0',
                            id: 0,
                            method: 'initialize',
                            params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ping', version: '1.0.0' } },
                        }),
                    });
                    if (resp.status < 500) {
                        return;
                    }
                } catch (err) {
                    lastError = err;
                }
                if (server) {
                    server.kill('SIGTERM');
                    server = null;
                }
            }
            throw lastError ?? new Error('Failed to start MCP HTTP server after retries');
        });

        afterAll(async () => {
            if (server) {
                server.kill('SIGTERM');
            }
        });

        async function initSession(): Promise<string> {
            return await initMcpHttpSession(base);
        }

        test('invalid JSON maps to InvalidParams (-32602)', async () => {
            const res = await fetch(base, {
                method: 'POST',
                headers: mcpHttpHeaders(),
                body: 'invalid json',
            });
            expect(res.status).toBe(400);
            expect(String(res.headers.get('content-type') || '')).toContain('application/json');
            const body = await parseMcpBody(res);
            expect(body.error?.code).toBe(-32602);
            expect(String(body.error?.message || '')).toContain('Invalid JSON');
        });

        test('missing JSON-RPC params maps to InvalidParams (-32602)', async () => {
            const sid = await initSession();

            const res = await fetch(base, {
                method: 'POST',
                headers: mcpHttpHeaders(String(sid)),
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 6,
                    method: 'tools/call',
                }),
            });
            expect(res.status).toBe(200);
            expect(String(res.headers.get('content-type') || '')).toContain('text/event-stream');
            const body = await parseMcpBody(res);
            expect(body.error?.code).toBe(-32602);
            expect(String(body.error?.message || '')).toContain('Missing required parameters');
        });

        test('missing params maps to InvalidParams (-32602)', async () => {
            const sid = await initSession();

            const res = await fetch(base, {
                method: 'POST',
                headers: mcpHttpHeaders(String(sid)),
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/call',
                    params: { name: 'find_definition', arguments: {} },
                }),
            });
            expect(res.status).toBe(200);
            expect(String(res.headers.get('content-type') || '')).toContain('text/event-stream');
            const body = await parseMcpBody(res);
            expect(body.error?.code).toBe(-32602);
            expect(String(body.error?.message || '')).toContain('Missing required parameters');
        });

        test('unknown tool maps to MethodNotFound (-32601)', async () => {
            const sid = await initSession();

            const res = await fetch(base, {
                method: 'POST',
                headers: mcpHttpHeaders(String(sid)),
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 4,
                    method: 'tools/call',
                    params: { name: 'no_such_tool', arguments: {} },
                }),
            });
            expect(res.status).toBe(200);
            expect(String(res.headers.get('content-type') || '')).toContain('text/event-stream');
            const body = await parseMcpBody(res);
            expect(body.error?.code).toBe(-32601);
            expect(String(body.error?.message || '')).toContain('Unknown tool');
        });

        test('missing session maps to JSON-RPC error envelope', async () => {
            const res = await fetch(base, {
                method: 'POST',
                headers: mcpHttpHeaders(),
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 5,
                    method: 'tools/call',
                    params: { name: 'find_definition', arguments: {} },
                }),
            });
            expect(res.status).toBe(400);
            const body = await parseMcpBody(res);
            expect(body.error?.code).toBe(-32000);
            expect(String(body.error?.message || '')).toContain('No valid session ID');
        });

        test('missing session on GET maps to JSON-RPC error envelope', async () => {
            const res = await fetch(base, {
                method: 'GET',
                headers: mcpHttpHeaders(),
            });
            expect(res.status).toBe(400);
            const body = await parseMcpBody(res);
            expect(body.error?.code).toBe(-32000);
            expect(String(body.error?.message || '')).toContain('No valid session ID');
        });
    });

});
