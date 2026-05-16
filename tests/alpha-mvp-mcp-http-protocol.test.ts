import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { canBindTcp } from './helpers/bind-utils';
import { initMcpHttpSession, mcpHttpHeaders } from './helpers/mcp-http';

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickRandomPort(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function parseMcpBody(res: Response) {
    if (!res.body) return {};
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
        for (let i = 0; i < 6; i++) {
            const { value, done } = await reader.read();
            if (value) text += decoder.decode(value, { stream: !done });
            try {
                return JSON.parse(text);
            } catch {}
            const line = text.split(/\r?\n/).find((candidate) => candidate.startsWith('data: '));
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

const canBind = await canBindTcp('127.0.0.1');
const bindDescribe = canBind ? describe : describe.skip;

bindDescribe('Alpha MVP MCP HTTP protocol', () => {
    const host = '127.0.0.1';
    const bun = process.env.BUN_PATH || `${process.env.HOME}/.bun/bin/bun`;
    let port: number;
    let base: string;
    let sessionId: string;
    let server: ReturnType<typeof spawn> | null = null;

    beforeAll(async () => {
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            port = pickRandomPort(8300, 8999);
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
                sessionId = await initMcpHttpSession(base, { name: 'alpha-mvp-test', version: '1.0.0' });
                return;
            } catch (error) {
                lastError = error;
                server.kill('SIGTERM');
                server = null;
            }
        }
        throw lastError ?? new Error('Failed to start MCP HTTP server');
    });

    afterAll(async () => {
        server?.kill('SIGTERM');
    });

    async function toolsCall(id: number, name: string, args: Record<string, unknown>) {
        const res = await fetch(base, {
            method: 'POST',
            headers: mcpHttpHeaders(sessionId),
            body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
        });
        return { status: res.status, body: await parseMcpBody(res) };
    }

    test('read_file succeeds through JSON-RPC tools/call', async () => {
        const { status, body } = await toolsCall(2, 'read_file', {
            path: 'docs/project/alpha-mvp-contract.md',
            range: { startLine: 1, endLine: 8 },
        });

        expect(status).toBe(200);
        const text = body?.result?.content?.[0]?.text;
        expect(text).toBeDefined();
        const parsed = JSON.parse(text);
        expect(parsed.path).toBe('docs/project/alpha-mvp-contract.md');
        expect(parsed.range).toEqual({ startLine: 1, endLine: 8 });
        expect(parsed.content).toContain('Alpha MVP contract');
    });

    test('read_file workspace escape returns structured MCP error result', async () => {
        const { status, body } = await toolsCall(3, 'read_file', { path: '../AGENTS.md' });

        expect(status).toBe(200);
        const errorText = body?.error?.message || body?.result?.content?.[0]?.text || '';
        expect(String(errorText)).toContain('workspace');
    });
});
