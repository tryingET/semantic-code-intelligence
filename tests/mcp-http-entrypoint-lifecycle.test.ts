import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function repoModuleUrl(path: string): string {
    return pathToFileURL(`${process.cwd()}/${path}`).href;
}

function uniquePort(offset: number): number {
    return 18_000 + ((process.pid + offset) % 20_000);
}

describe('MCP HTTP entrypoint and session lifecycle', () => {
    test('importing the MCP HTTP module does not bind the configured port', () => {
        const port = uniquePort(17);
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            import net from 'node:net';
            process.env.MCP_HTTP_HOST = '127.0.0.1';
            process.env.MCP_HTTP_PORT = '${port}';
            await import(${JSON.stringify(moduleUrl)});
            const server = net.createServer();
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(${port}, '127.0.0.1', resolve);
            });
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 10_000,
        });

        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).not.toContain('EADDRINUSE');
    });

    test('start resolves host and port at call time after import', () => {
        const port = uniquePort(23);
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            const mod = await import(${JSON.stringify(moduleUrl)});
            process.env.MCP_HTTP_HOST = '127.0.0.1';
            process.env.MCP_HTTP_PORT = '${port}';
            const server = mod.startMcpHttpServer();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const health = await fetch('http://127.0.0.1:${port}/health');
            if (!health.ok) throw new Error('health failed: ' + health.status);
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 15_000,
        });

        expect(result.status).toBe(0);
    });

    test('start accepts port 0 for an ephemeral bind', () => {
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            const mod = await import(${JSON.stringify(moduleUrl)});
            const server = mod.startMcpHttpServer({ host: '127.0.0.1', port: 0 });
            await new Promise((resolve) => setTimeout(resolve, 150));
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            if (!port || port === 7001) throw new Error('ephemeral port was not honored: ' + port);
            const health = await fetch('http://127.0.0.1:' + port + '/health');
            if (!health.ok) throw new Error('health failed: ' + health.status);
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 15_000,
        });

        expect(result.status).toBe(0);
    });

    test('start rejects concurrent in-process servers to avoid shared lifecycle state corruption', () => {
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            const mod = await import(${JSON.stringify(moduleUrl)});
            const server = mod.startMcpHttpServer({ host: '127.0.0.1', port: 0 });
            await new Promise((resolve) => setTimeout(resolve, 150));
            try {
                mod.startMcpHttpServer({ host: '127.0.0.1', port: 0 });
                throw new Error('second start unexpectedly succeeded');
            } catch (error) {
                if (!String(error?.message || error).includes('already running')) throw error;
            }
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 15_000,
        });

        expect(result.status).toBe(0);
    });

    test('explicit non-loopback bind host drives default CORS policy', () => {
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            const mod = await import(${JSON.stringify(moduleUrl)});
            delete process.env.MCP_HTTP_CORS_ORIGIN;
            const server = mod.startMcpHttpServer({ host: '0.0.0.0', port: 0 });
            await new Promise((resolve) => setTimeout(resolve, 150));
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            const preflight = await fetch('http://127.0.0.1:' + port + '/mcp', {
                method: 'OPTIONS',
                headers: {
                    origin: 'http://localhost:7001',
                    'access-control-request-method': 'POST',
                    'access-control-request-headers': 'content-type,mcp-session-id,mcp-protocol-version'
                }
            });
            if (preflight.headers.get('access-control-allow-origin')) {
                throw new Error('CORS unexpectedly allowed loopback origin for externally bound host');
            }
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 15_000,
        });

        expect(result.status).toBe(0);
    });

    test('expired MCP HTTP sessions are disposable without client DELETE', () => {
        const port = uniquePort(29);
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            process.env.MCP_HTTP_HOST = '127.0.0.1';
            process.env.MCP_HTTP_PORT = '${port}';
            process.env.MCP_HTTP_SESSION_TTL_MS = '1';
            process.env.MCP_HTTP_SESSION_SWEEP_INTERVAL_MS = '1000';
            const mod = await import(${JSON.stringify(moduleUrl)});
            const server = mod.startMcpHttpServer();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const init = await fetch('http://127.0.0.1:${port}/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'lifecycle-test', version: '1.0.0' }
                    }
                })
            });
            if (!init.ok) throw new Error('initialize failed: ' + init.status + ' ' + await init.text());
            if (mod.mcpHttpSessionCount() < 1) throw new Error('session was not tracked');
            await mod.disposeExpiredMcpHttpSessions(Date.now() + 10_000);
            if (mod.mcpHttpSessionCount() !== 0) throw new Error('expired session was not disposed');
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 20_000,
        });

        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
    });

    test('server close disposes active MCP HTTP sessions', () => {
        const port = uniquePort(31);
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            process.env.MCP_HTTP_HOST = '127.0.0.1';
            process.env.MCP_HTTP_PORT = '${port}';
            const mod = await import(${JSON.stringify(moduleUrl)});
            const server = mod.startMcpHttpServer();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const init = await fetch('http://127.0.0.1:${port}/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'close-test', version: '1.0.0' }
                    }
                })
            });
            if (!init.ok) throw new Error('initialize failed: ' + init.status + ' ' + await init.text());
            if (mod.mcpHttpSessionCount() !== 1) throw new Error('session was not tracked before close');
            await new Promise((resolve) => server.close(resolve));
            if (mod.mcpHttpSessionCount() !== 0) throw new Error('server close did not dispose sessions');
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 20_000,
        });

        expect(result.status).toBe(0);
    });

    test('active event streams are not expired by the TTL sweeper', () => {
        const port = uniquePort(37);
        const moduleUrl = repoModuleUrl('src/servers/mcp-http.ts');
        const script = `
            process.env.MCP_HTTP_HOST = '127.0.0.1';
            process.env.MCP_HTTP_PORT = '${port}';
            process.env.MCP_HTTP_SESSION_TTL_MS = '1';
            process.env.MCP_HTTP_SESSION_SWEEP_INTERVAL_MS = '1000';
            const mod = await import(${JSON.stringify(moduleUrl)});
            const server = mod.startMcpHttpServer();
            await new Promise((resolve) => setTimeout(resolve, 150));
            const init = await fetch('http://127.0.0.1:${port}/mcp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {},
                        clientInfo: { name: 'stream-test', version: '1.0.0' }
                    }
                })
            });
            const sessionId = init.headers.get('mcp-session-id');
            if (!sessionId) throw new Error('missing session id');
            const controller = new AbortController();
            const stream = fetch('http://127.0.0.1:${port}/mcp-events', {
                headers: { 'mcp-session-id': sessionId },
                signal: controller.signal,
            }).catch((error) => {
                if (error?.name !== 'AbortError') throw error;
            });
            await new Promise((resolve) => setTimeout(resolve, 150));
            await mod.disposeExpiredMcpHttpSessions(Date.now() + 10_000);
            if (mod.mcpHttpSessionCount() !== 1) throw new Error('active session expired');
            controller.abort();
            await stream;
            await new Promise((resolve) => setTimeout(resolve, 50));
            await new Promise((resolve) => server.close(resolve));
        `;

        const result = spawnSync(process.execPath, ['--eval', script], {
            cwd: process.cwd(),
            encoding: 'utf8',
            timeout: 20_000,
        });

        expect(result.status).toBe(0);
    });
});
