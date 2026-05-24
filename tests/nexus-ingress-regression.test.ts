import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HTTPAdapter } from '../src/adapters/http-adapter';
import { overlayStore } from '../src/core/overlay-store';
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

    test('rejects non-loopback browser origins before snapshot reads', async () => {
        const res = await fetch(`${base}/api/v1/snapshots`, {
            headers: { origin: 'https://attacker.example' },
        });
        expect(res.status).toBe(400);
        expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error?.code).toBe('InvalidParams');
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
    test('CLI find rejects absolute file inputs outside the detected workspace', () => {
        const outside = mkdtempSync(join(tmpdir(), 'sci-nexus-cli-outside-'));
        try {
            const outsideFile = join(outside, 'outside.ts');
            writeFileSync(outsideFile, 'export function OutsideCliSecret() { return 1; }\n');
            const proc = spawnSync(
                process.execPath,
                ['run', 'src/servers/cli.ts', 'find', 'OutsideCliSecret', '-f', outsideFile, '--json', '--no-color'],
                { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, SILENT_MODE: 'true' } }
            );
            const output = `${proc.stdout || ''}${proc.stderr || ''}`;
            expect(proc.status).not.toBe(0);
            const body = JSON.parse(proc.stdout || '{}');
            expect(body.success).toBe(false);
            expect(body.error?.message).toContain('workspace');
            expect(output).not.toContain(`file://${outsideFile}`);
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('CLI text-search rejects absolute search roots outside the detected workspace', () => {
        const outside = mkdtempSync(join(tmpdir(), 'sci-nexus-cli-search-outside-'));
        try {
            writeFileSync(join(outside, 'secret.txt'), 'needle_outside_cli_boundary\n');
            const proc = spawnSync(
                process.execPath,
                ['run', 'src/servers/cli.ts', 'text-search', 'needle_outside_cli_boundary', '-p', outside, '--json'],
                { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, SILENT_MODE: 'true' } }
            );
            const output = `${proc.stdout || ''}${proc.stderr || ''}`;
            expect(proc.status).not.toBe(0);
            const body = JSON.parse(proc.stdout || '{}');
            expect(body.success).toBe(false);
            expect(body.error?.message).toContain('workspace');
            expect(output).not.toContain('needle_outside_cli_boundary');
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('CLI symbol-map rejects absolute file inputs outside the detected workspace with nonzero JSON error', () => {
        const outside = mkdtempSync(join(tmpdir(), 'sci-nexus-cli-symbol-outside-'));
        try {
            const outsideFile = join(outside, 'outside.ts');
            writeFileSync(outsideFile, 'export const OutsideSymbolMapSecret = 1;\n');
            const proc = spawnSync(
                process.execPath,
                ['run', 'src/servers/cli.ts', 'symbol-map', 'OutsideSymbolMapSecret', '-f', outsideFile, '--json', '--no-color'],
                { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, SILENT_MODE: 'true' } }
            );
            expect(proc.status).not.toBe(0);
            const body = JSON.parse(proc.stdout || '{}');
            expect(body.success).toBe(false);
            expect(body.error?.message).toContain('workspace');
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('CLI workflow aliases reject boundary errors with nonzero JSON error', () => {
        const outside = mkdtempSync(join(tmpdir(), 'sci-nexus-cli-workflow-outside-'));
        try {
            writeFileSync(join(outside, 'outside.ts'), 'const OutsideStructuralSecret = 1;\n');
            const proc = spawnSync(
                process.execPath,
                ['run', 'src/servers/cli.ts', 'structural-search', 'typescript', 'const $A = $B', '--paths', outside, '--json'],
                { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, SILENT_MODE: 'true' } }
            );
            expect(proc.status).not.toBe(0);
            const body = JSON.parse(proc.stdout || '{}');
            expect(body.success).toBe(false);
            expect(body.error?.message).toContain('workspace');
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('CLI generic workflow exits nonzero for explicit tool errors', () => {
        const proc = spawnSync(
            process.execPath,
            [
                'run',
                'src/servers/cli.ts',
                'workflow',
                'run_checks',
                '-a',
                '{"snapshot":"00000000-0000-4000-8000-000000000000"}',
                '--json',
            ],
            { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, SILENT_MODE: 'true' } }
        );
        expect(proc.status).not.toBe(0);
        const body = JSON.parse(proc.stdout || '{}');
        expect(body.isError).toBe(true);
    });

    test('OverlayStore list can be scoped to a configured workspace after memory is cleared', () => {
        const cwd = process.cwd();
        const workspaceA = mkdtempSync(join(tmpdir(), 'sci-nexus-list-a-'));
        const workspaceB = mkdtempSync(join(tmpdir(), 'sci-nexus-list-b-'));
        try {
            const snap = overlayStore.createSnapshot(false, { workspaceRoot: workspaceB });
            overlayStore.clearAll();
            process.chdir(workspaceA);
            expect(overlayStore.list().map((item) => item.id)).not.toContain(snap.id);
            expect(overlayStore.list({ workspaceRoot: workspaceB }).map((item) => item.id)).toContain(snap.id);
        } finally {
            process.chdir(cwd);
            overlayStore.clearAll();
            rmSync(workspaceA, { recursive: true, force: true });
            rmSync(workspaceB, { recursive: true, force: true });
        }
    });

    test('OverlayStore scoped list backfills legacy snapshot metadata without workspaceRoot', () => {
        const cwd = process.cwd();
        const workspaceA = mkdtempSync(join(tmpdir(), 'sci-nexus-legacy-list-a-'));
        const workspaceB = mkdtempSync(join(tmpdir(), 'sci-nexus-legacy-list-b-'));
        try {
            const snap = overlayStore.createSnapshot(false, { workspaceRoot: workspaceB });
            const metadataPath = join(workspaceB, '.ontology', 'snapshots', snap.id, 'metadata.json');
            const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
            delete metadata.workspaceRoot;
            writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
            overlayStore.clearAll();
            process.chdir(workspaceA);
            expect(overlayStore.list({ workspaceRoot: workspaceB }).map((item) => item.id)).toContain(snap.id);
        } finally {
            process.chdir(cwd);
            overlayStore.clearAll();
            rmSync(workspaceA, { recursive: true, force: true });
            rmSync(workspaceB, { recursive: true, force: true });
        }
    });

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
