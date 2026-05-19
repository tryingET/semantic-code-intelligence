import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter';

const cleanupPaths: string[] = [];

function track(path: string): string {
    cleanupPaths.push(path);
    return path;
}

function uniqueWorkspacePath(prefix: string): string {
    return track(resolve(process.cwd(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`));
}

function outsideFileWith(content: string, ext = 'ts'): string {
    const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-navigation-outside-')));
    const outsideFile = join(outsideDir, `outside.${ext}`);
    writeFileSync(outsideFile, content);
    return outsideFile;
}

function rendered(result: any): string {
    return JSON.stringify(result);
}

afterEach(() => {
    for (const path of cleanupPaths.splice(0).reverse()) {
        rmSync(path, { recursive: true, force: true });
    }
});

describe('navigation workspace trust boundary', () => {
    test('graph_expand rejects absolute out-of-workspace files without leaking graph content', async () => {
        const outsideFile = outsideFileWith('import outsideSecretGraphLeak from "secret-module";\nexport const outsideSecretExport = 1;\n');
        const mcp = new MCPAdapter({ buildSymbolMap: async () => ({ declarations: [] }) } as any);

        const result = await mcp.handleToolCall('graph_expand', {
            file: outsideFile,
            edges: ['imports', 'exports'],
            limit: 10,
        });
        const body = rendered(result);

        expect(result.isError).toBe(true);
        expect(body).toContain('workspace');
        expect(body).not.toContain('outsideSecretGraphLeak');
        expect(body).not.toContain('outsideSecretExport');
        expect(body).not.toContain('secret-module');
    });

    test('graph_expand rejects workspace symlink files whose real target escapes the workspace', async () => {
        const outsideFile = outsideFileWith('export const outsideSecretGraphSymlinkLeak = true;\n');
        const linkPath = uniqueWorkspacePath('.tmp-graph-expand-symlink.ts');
        symlinkSync(outsideFile, linkPath);
        const mcp = new MCPAdapter({ buildSymbolMap: async () => ({ declarations: [] }) } as any);

        const result = await mcp.handleToolCall('graph_expand', {
            file: linkPath,
            edges: ['exports'],
            limit: 10,
        });
        const body = rendered(result);

        expect(result.isError).toBe(true);
        expect(body).toContain('workspace');
        expect(body).not.toContain('outsideSecretGraphSymlinkLeak');
    });

    test('graph_expand symbol seed filters out-of-workspace declaration URIs before fallback search', async () => {
        const outsideFile = outsideFileWith('export function outsideSecretGraphSeedLeak() { return true; }\n');
        const mcp = new MCPAdapter({
            buildSymbolMap: async () => ({ declarations: [{ uri: `file://${outsideFile}` }] }),
        } as any);

        const result = await mcp.handleToolCall('graph_expand', {
            symbol: 'outsideSecretGraphSeedLeak',
            edges: ['callers'],
            limit: 10,
        });
        const body = rendered(result);

        expect(result.isError).toBe(false);
        expect(body).not.toContain(outsideFile);
        expect(body).not.toContain('outsideSecretGraphSeedLeak() { return true; }');
    });

    test('find_definition rejects outside file before deriving a symbol or calling core', async () => {
        const outsideFile = outsideFileWith('export function OutsideDefinitionSecret() { return 1; }\n');
        let called = false;
        const mcp = new MCPAdapter({
            async initialize() {},
            async findDefinitionAsync() {
                called = true;
                return { data: [], performance: { total: 0 } };
            },
        } as any);

        const result = await mcp.handleToolCall('find_definition', {
            file: outsideFile,
            symbol: 'OutsideDefinitionSecret',
            position: { line: 0, character: 20 },
        });
        const body = rendered(result);

        expect(result.isError).toBe(true);
        expect(called).toBe(false);
        expect(body).toContain('workspace');
        expect(body).not.toContain('OutsideDefinitionSecret() { return 1; }');
    });

    test('find_references rejects outside file before calling core', async () => {
        const outsideFile = outsideFileWith('OutsideReferencesSecret();\n');
        let called = false;
        const mcp = new MCPAdapter({
            async initialize() {},
            async findReferencesAsync() {
                called = true;
                return { data: [], performance: { total: 0 } };
            },
        } as any);

        const result = await mcp.handleToolCall('find_references', {
            file: outsideFile,
            symbol: 'OutsideReferencesSecret',
        });

        expect(result.isError).toBe(true);
        expect(called).toBe(false);
        expect(rendered(result)).toContain('workspace');
    });

    test('explore_codebase rejects outside file before calling core', async () => {
        const outsideFile = outsideFileWith('export const outsideExploreSecret = true;\n');
        let called = false;
        const mcp = new MCPAdapter({
            async exploreCodebase() {
                called = true;
                return { symbol: '', definitions: [], references: [], performance: {}, diagnostics: [], timestamp: '' };
            },
        } as any);

        const result = await mcp.handleToolCall('explore_codebase', {
            file: `file://${outsideFile}`,
            symbol: 'outsideExploreSecret',
        });

        expect(result.isError).toBe(true);
        expect(called).toBe(false);
        expect(rendered(result)).toContain('workspace');
    });
});
