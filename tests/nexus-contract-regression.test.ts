import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HTTPAdapter } from '../src/adapters/http-adapter';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { createDefaultCoreConfig } from '../src/adapters/utils';
import { LSPAdapter } from '../src/adapters/lsp-adapter';
import { createCodeAnalyzer } from '../src/core/index';
import { normalizeStructuralPaths } from '../src/core/workflows/structural-workflow';

const roots: string[] = [];

function tempWorkspace(prefix = 'sci-nexus-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function parseContent(res: any): any {
    const text = res?.content?.[0]?.text;
    if (typeof text === 'string') return JSON.parse(text);
    return res?.payload ?? res;
}

async function withMcp<T>(workspaceRoot: string, fn: (mcp: MCPAdapter) => Promise<T>): Promise<T> {
    const cfg = createDefaultCoreConfig();
    const analyzer = await createCodeAnalyzer({ ...cfg, workspaceRoot });
    await analyzer.initialize();
    try {
        return await fn(new MCPAdapter(analyzer));
    } finally {
        await analyzer.dispose?.();
    }
}

describe('nexus contract regressions', () => {
    test('advertised list_files routes to a bounded workspace listing', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const res = await mcp.handleToolCall('list_files', { path: '.', maxFiles: 10, depth: 1 });
            const out = parseContent(res);
            expect(res.isError).toBe(false);
            expect(out.files.some((file: any) => file.path === 'sample.ts' && file.type === 'file')).toBe(true);
        });
    });

    test('propose_patch rejects header-only diffs instead of staging unusable overlays', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const snap = parseContent(await mcp.handleToolCall('get_snapshot', { preferExisting: false })).snapshot;
            const patch = 'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n';
            const res = await mcp.handleToolCall('propose_patch', { snapshot: snap, patch });
            const out = parseContent(res);
            expect(res.isError).toBe(true);
            expect(out.accepted).toBe(false);
            expect(String(out.message)).toContain('invalid_patch');
        });
    });

    test('timestamped unified diff headers do not become file names', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const patch = '--- a/sample.ts\t2026-05-24\n+++ b/sample.ts\t2026-05-24\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
            const res = await mcp.handleToolCall('recommend_checks', { patch });
            const out = parseContent(res);
            expect(out.inputs.files).toEqual(['sample.ts']);
        });
    });

    test('structural paths reject symlink escapes before ast-grep execution', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-outside-');
        writeFileSync(join(outsideRoot, 'secret.ts'), 'function OutsideSecret() { return 1; }\n', 'utf8');
        symlinkSync(outsideRoot, join(workspaceRoot, 'out'));

        await expect(normalizeStructuralPaths(['out'], workspaceRoot)).rejects.toThrow('structural path must stay within the workspace');
    });

    test('HTTP legacy endpoints reject existing files outside the configured workspace by default', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-http-outside-');
        const outsideFile = join(outsideRoot, 'outside.ts');
        writeFileSync(outsideFile, 'const OutsideHttpSecret = 1;\n', 'utf8');
        const core: any = {
            config: { workspaceRoot },
            findDefinition: async () => ({ data: [], performance: {}, requestId: 'unused', timestamp: Date.now() }),
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'OutsideHttpSecret', file: outsideFile, position: { line: 0, character: 6 } }),
        });

        expect(response.status).toBe(400);
        expect(response.body).not.toContain('OutsideHttpSecret = 1');
    });

    test('HTTP virtual file placeholders do not throw URL-host errors', async () => {
        const workspaceRoot = tempWorkspace();
        const calls: any[] = [];
        const core: any = {
            config: { workspaceRoot },
            findDefinition: async (req: any) => {
                calls.push(req);
                return { data: [], performance: {}, requestId: 'ok', timestamp: Date.now() };
            },
            sharedServices: {},
        };
        const adapter = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });

        const response = await adapter.handleRequest({
            method: 'POST',
            url: '/api/v1/definition',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ identifier: 'Anything', uri: 'file://workspace', position: { line: 0, character: 0 } }),
        });

        expect(response.status).toBe(200);
        expect(calls[0].uri).toContain(workspaceRoot);
    });

    test('propose_patch validates subsequent patches against the current staged snapshot state', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'export const value = 1;\n', 'utf8');

        await withMcp(workspaceRoot, async (mcp) => {
            const snap = parseContent(await mcp.handleToolCall('get_snapshot', { preferExisting: false })).snapshot;
            const first = 'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n';
            const staleSecond = 'diff --git a/sample.ts b/sample.ts\n--- a/sample.ts\n+++ b/sample.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 3;\n';
            expect(parseContent(await mcp.handleToolCall('propose_patch', { snapshot: snap, patch: first })).accepted).toBe(true);
            const res = await mcp.handleToolCall('propose_patch', { snapshot: snap, patch: staleSecond });
            const out = parseContent(res);
            expect(res.isError).toBe(true);
            expect(out.accepted).toBe(false);
            expect(String(out.message)).toContain('invalid_patch');
        });
    });

    test('LSP identifier extraction does not read or delegate outside-workspace file URIs', async () => {
        const workspaceRoot = tempWorkspace();
        const outsideRoot = tempWorkspace('sci-nexus-lsp-outside-');
        const outsideFile = join(outsideRoot, 'outside.ts');
        writeFileSync(outsideFile, 'const OutsideLspSecret = 1;\n', 'utf8');
        const seen: any[] = [];
        const core: any = {
            initialize: async () => {},
            findDefinitionAsync: async (req: any) => {
                seen.push(req);
                return { data: [] };
            },
            findReferencesAsync: async () => ({ data: [] }),
            prepareRename: async () => ({ data: null }),
            rename: async () => ({ data: { changes: {} } }),
            getCompletions: async () => ({ data: [] }),
            trackFileChange: async () => {},
            getDiagnostics: () => ({}),
            config: { workspaceRoot },
        };
        const adapter = new LSPAdapter(core, { workspaceRoot });

        const result = await adapter.findDefinition(outsideFile, { line: 0, character: 8 });
        expect(result).toEqual([]);
        expect(seen).toEqual([]);
    });
});
