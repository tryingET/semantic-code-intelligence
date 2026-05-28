#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { canBindTcp } from './helpers/bind-utils';

function wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function pickRandomPort(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const canBind = await canBindTcp('127.0.0.1');
const bindTest = canBind ? test : test.skip;

bindTest('MCP HTTP initialize returns 200 and sets session id', async () => {
    const host = '127.0.0.1';
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5; attempt++) {
        const port = pickRandomPort(7091, 7999);
        const env = {
            ...process.env,
            MCP_HTTP_HOST: host,
            MCP_HTTP_PORT: String(port),
            HTTP_API_PORT: String(port + 9),
        };
        const server = spawn(
            process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`,
            ['run', 'src/servers/mcp-http.ts'],
            { env }
        );

        try {
            await wait(500);
            const resp = await fetch(`http://${host}:${port}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'test', version: '1.0.0' },
                    },
                }),
            });

            if (resp.status < 500) {
                expect(resp.status).toBe(200);
                expect(String(resp.headers.get('content-type') || '')).toContain('application/json');
                const sid = resp.headers.get('Mcp-Session-Id');
                expect(sid).not.toBeNull();
                server.kill('SIGTERM');
                return;
            }
        } catch (err) {
            lastError = err;
        } finally {
            server.kill('SIGTERM');
        }
    }

    throw lastError ?? new Error('Failed to start MCP HTTP server after retries');
});

bindTest('MCP HTTP CORS preflight allows MCP protocol version header', async () => {
    const host = '127.0.0.1';
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5; attempt++) {
        const port = pickRandomPort(7091, 7999);
        const env = {
            ...process.env,
            MCP_HTTP_HOST: host,
            MCP_HTTP_PORT: String(port),
            HTTP_API_PORT: String(port + 9),
        };
        const server = spawn(
            process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`,
            ['run', 'src/servers/mcp-http.ts'],
            { env }
        );

        try {
            await wait(500);
            const resp = await fetch(`http://${host}:${port}/mcp`, {
                method: 'OPTIONS',
                headers: {
                    origin: 'http://localhost:3000',
                    'access-control-request-method': 'POST',
                    'access-control-request-headers': 'content-type,mcp-session-id,mcp-protocol-version',
                },
            });

            if (resp.status < 500) {
                expect(resp.status).toBe(204);
                const allowed = String(resp.headers.get('access-control-allow-headers') || '').toLowerCase();
                expect(allowed).toContain('content-type');
                expect(allowed).toContain('mcp-session-id');
                expect(allowed).toContain('mcp-protocol-version');
                server.kill('SIGTERM');
                return;
            }
        } catch (err) {
            lastError = err;
        } finally {
            server.kill('SIGTERM');
        }
    }

    throw lastError ?? new Error('Failed to start MCP HTTP server after retries');
});

bindTest('MCP HTTP failed initialize does not expose a poisoned session id', async () => {
    const host = '127.0.0.1';
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 5; attempt++) {
        const port = pickRandomPort(7091, 7999);
        const env = {
            ...process.env,
            MCP_HTTP_HOST: host,
            MCP_HTTP_PORT: String(port),
            HTTP_API_PORT: String(port + 9),
        };
        const server = spawn(
            process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`,
            ['run', 'src/servers/mcp-http.ts'],
            { env }
        );

        try {
            await wait(500);
            const resp = await fetch(`http://${host}:${port}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
            });

            if (resp.status < 500) {
                expect(resp.status).toBe(400);
                expect(resp.headers.get('Mcp-Session-Id')).toBeNull();
                server.kill('SIGTERM');
                return;
            }
        } catch (err) {
            lastError = err;
        } finally {
            server.kill('SIGTERM');
        }
    }

    throw lastError ?? new Error('Failed to start MCP HTTP server after retries');
});
