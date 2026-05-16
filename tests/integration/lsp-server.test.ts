import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { testPaths } from '../test-helpers';

describe('LSP Server Integration Tests', () => {
    let serverProcess: ChildProcess;
    let serverReady = false;

    beforeAll(async () => {
        // Start the LSP server
        const serverPath = testPaths.serverJs();
        serverProcess = spawn('bun', ['run', serverPath, '--stdio'], {
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Wait for server to be ready
        await new Promise<void>((resolve) => {
            serverProcess.stdout?.on('data', (data) => {
                const message = data.toString();
                if (message.includes('Initialized') || message.includes('ready')) {
                    serverReady = true;
                    resolve();
                }
            });

            // Timeout after 5 seconds
            setTimeout(() => {
                serverReady = true;
                resolve();
            }, 5000);
        });
    });

    afterAll(() => {
        if (serverProcess) {
            serverProcess.kill();
        }
    });

    test('Server responds to initialize request', async () => {
        const initRequest = {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                processId: null,
                rootUri: 'file:///test',
                capabilities: {},
            },
        };

        const response = await sendRequest(serverProcess, initRequest);
        expect(response).toHaveProperty('result');
        expect(response.result).toHaveProperty('capabilities');
    });

    test('Server handles hover request', async () => {
        const hoverRequest = {
            jsonrpc: '2.0',
            id: 2,
            method: 'textDocument/hover',
            params: {
                textDocument: { uri: 'file:///test/file.ts' },
                position: { line: 0, character: 0 },
            },
        };

        const response = await sendRequest(serverProcess, hoverRequest);
        expect(response).toBeDefined();
    });

    test('Server handles definition request', async () => {
        const defRequest = {
            jsonrpc: '2.0',
            id: 3,
            method: 'textDocument/definition',
            params: {
                textDocument: { uri: 'file:///test/file.ts' },
                position: { line: 0, character: 0 },
            },
        };

        const response = await sendRequest(serverProcess, defRequest);
        expect(response).toBeDefined();
    });

    test('Server handles custom ontology requests', async () => {
        const statsRequest = {
            jsonrpc: '2.0',
            id: 4,
            method: 'ontology/getStatistics',
            params: {},
        };

        const response = await sendRequest(serverProcess, statsRequest);
        expect(response).toBeDefined();
    });

    test('Server handles concept graph request', async () => {
        const graphRequest = {
            jsonrpc: '2.0',
            id: 5,
            method: 'ontology/getConceptGraph',
            params: {},
        };

        const response = await sendRequest(serverProcess, graphRequest);
        expect(response).toBeDefined();
    });

    test('Server handles workspace/executeCommand: ontology.explore', async () => {
        const execRequest = {
            jsonrpc: '2.0',
            id: 6,
            method: 'workspace/executeCommand',
            params: {
                command: 'ontology.explore',
                arguments: [{ identifier: 'HTTPServer', uri: 'file:///test/file.ts', maxResults: 5 }],
            },
        };

        const response = await sendRequest(serverProcess, execRequest);
        expect(response).toBeDefined();
        // Should either return result or a soft error payload; both are acceptable for this smoke test
        expect(response.result || response.error).toBeDefined();
    });
});

async function sendRequest(proc: ChildProcess, request: any, timeoutMs = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
        const content = JSON.stringify(request);
        const message = `Content-Length: ${Buffer.byteLength(content, 'utf8')}\r\n\r\n${content}`;

        const onError = (err: any) => {
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
        };

        let buffer = '';
        const onData = (chunk: Buffer) => {
            buffer += chunk.toString('utf8');

            while (true) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1) return; // need full headers
                const headerPart = buffer.slice(0, headerEnd);
                const lengthMatch = headerPart.match(/Content-Length:\s*(\d+)/i);
                const contentLength = lengthMatch ? parseInt(lengthMatch[1], 10) : NaN;
                if (!contentLength) return;
                const totalNeeded = headerEnd + 4 + contentLength;
                if (buffer.length < totalNeeded) return; // wait for full body

                const jsonStr = buffer.slice(headerEnd + 4, totalNeeded);
                buffer = buffer.slice(totalNeeded);

                try {
                    const parsed = JSON.parse(jsonStr);
                    if (parsed && parsed.id === request.id) {
                        cleanup();
                        resolve(parsed);
                        return;
                    }
                    // else ignore notifications/other responses
                } catch {
                    // ignore parse error and continue
                }
            }
        };

        const cleanup = () => {
            clearTimeout(timer);
            proc.stdout?.off('data', onData);
            proc.stderr?.off('data', onStderr);
            proc.off('error', onError);
        };

        const onStderr = (_: Buffer) => {
            /* ignore diagnostics */
        };

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('Request timeout'));
        }, timeoutMs);

        proc.on('error', onError);
        proc.stderr?.on('data', onStderr);
        proc.stdout?.on('data', onData);

        proc.stdin?.write(message);
    });
}
