import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCodeAnalyzer } from '../src/core/index.js';
import { RenameWorkflowService } from '../src/core/workflows/rename-workflow.js';
import { EnhancedMCPServer } from '../src/servers/mcp-enhanced.js';
import { FastMCPServer } from '../src/servers/mcp-fast.js';
import { app } from '../src/servers/mcp-http.js';
import { initMcpHttpSession, mcpHttpHeaders } from './helpers/mcp-http';

const roots: string[] = [];

function tempRoot(prefix: string): string {
    const root = mkdtempSync(path.join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('nexus implementation regressions', () => {
    test('core find_definition rejects existing file URIs outside the configured workspace', async () => {
        const workspace = tempRoot('sci-nexus-ws-');
        const outside = tempRoot('sci-nexus-outside-');
        const outsideFile = path.join(outside, 'secret.ts');
        writeFileSync(outsideFile, 'export const OutsideDefinitionLeak = 1;\n', 'utf8');

        const analyzer = await createCodeAnalyzer({ workspaceRoot: workspace });
        try {
            await expect(
                analyzer.findDefinition({
                    uri: `file://${outsideFile}`,
                    identifier: 'OutsideDefinitionLeak',
                    position: { line: 0, character: 0 },
                } as any)
            ).rejects.toThrow(/workspace/);
        } finally {
            await (analyzer as any).dispose?.().catch(() => undefined);
        }
    });

    test('core find_references rejects existing file URIs outside the configured workspace', async () => {
        const workspace = tempRoot('sci-nexus-ws-');
        const outside = tempRoot('sci-nexus-outside-');
        const outsideFile = path.join(outside, 'secret.ts');
        writeFileSync(
            outsideFile,
            'export const OutsideReferenceLeak = 1;\nconsole.log(OutsideReferenceLeak);\n',
            'utf8'
        );

        const analyzer = await createCodeAnalyzer({ workspaceRoot: workspace });
        try {
            await expect(
                analyzer.findReferences({
                    uri: `file://${outsideFile}`,
                    identifier: 'OutsideReferenceLeak',
                    position: { line: 0, character: 0 },
                } as any)
            ).rejects.toThrow(/workspace/);
        } finally {
            await (analyzer as any).dispose?.().catch(() => undefined);
        }
    });

    test('core textSearch rejects absolute paths outside the configured workspace', async () => {
        const workspace = tempRoot('sci-nexus-ws-');
        const outside = tempRoot('sci-nexus-outside-');
        writeFileSync(path.join(outside, 'secret.txt'), 'outsideSecretDirectTextSearchLeak\n', 'utf8');

        const analyzer = await createCodeAnalyzer({ workspaceRoot: workspace });
        try {
            await expect(
                analyzer.textSearch('outsideSecretDirectTextSearchLeak', { path: outside, maxResults: 5 })
            ).rejects.toThrow(/workspace/);
        } finally {
            await (analyzer as any).dispose?.().catch(() => undefined);
        }
    });

    test('apply_rename refuses direct mutation instead of reporting a false applied status', async () => {
        const workspace = tempRoot('sci-nexus-rename-');
        const target = path.join(workspace, 'target.ts');
        const before = 'export const oldName = 1;\nconsole.log(oldName);\n';
        writeFileSync(target, before, 'utf8');

        const service = new RenameWorkflowService({
            workspaceRoot: () => workspace,
            coreAnalyzer: { rename: async () => ({ data: { changes: {} }, performance: {}, requestId: 'unused' }) },
        });

        const result = await service.applyRename({ oldName: 'oldName', newName: 'newName', file: 'target.ts' });

        expect(result.isError).toBe(true);
        expect((result as any).payload.status).toBe('unsupported');
        expect(readFileSync(target, 'utf8')).toBe(before);
    });

    test('MCP HTTP invalid snapshot resource reports client error instead of internal error', async () => {
        const server = app.listen(0, '127.0.0.1');
        try {
            await new Promise<void>((resolve) => server.once('listening', resolve));
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            const base = `http://127.0.0.1:${port}/mcp`;
            const sessionId = await initMcpHttpSession(base, { name: 'nexus-regression', version: '1.0.0' });
            const response = await fetch(base, {
                method: 'POST',
                headers: mcpHttpHeaders(sessionId),
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 3,
                    method: 'resources/read',
                    params: { uri: 'snapshot://' },
                }),
            });
            const payload = await response.json();

            expect(response.status).toBe(200);
            expect(payload.id).toBe(3);
            expect(payload.error?.code).toBe(-32602);
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    test('MCP HTTP missing-session batch errors preserve per-request ids', async () => {
        const server = app.listen(0, '127.0.0.1');
        try {
            await new Promise<void>((resolve) => server.once('listening', resolve));
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify([
                    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
                    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
                ]),
            });
            const payload = await response.json();

            expect(response.status).toBe(400);
            expect(payload).toEqual([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]);
        } finally {
            await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
        }
    });

    test('MCP stdio lazy initialization can retry after an initialization failure', async () => {
        for (const ServerClass of [FastMCPServer, EnhancedMCPServer]) {
            const server = new ServerClass() as any;
            let attempts = 0;
            server.initializeCore = async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('first init failure');
                server.initialized = true;
            };

            await expect(server.ensureInitialized()).rejects.toThrow('first init failure');
            await expect(server.ensureInitialized()).resolves.toBeUndefined();
            expect(attempts).toBe(2);
            await server.shutdown?.();
        }
    });

    test('CLI --json parse failures emit a JSON error envelope', () => {
        const result = spawnSync('bun', ['src/servers/cli.ts', 'symbol-map', 'Foo', '--max-files', 'nope', '--json'], {
            cwd: process.cwd(),
            encoding: 'utf8',
        });

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(() => JSON.parse(result.stderr.trim())).not.toThrow();
        expect(JSON.parse(result.stderr.trim())).toMatchObject({ ok: false, error: 'max-files must be an integer' });
    });
});
