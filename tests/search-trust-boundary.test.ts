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

function parseToolJson(result: any): any {
    return JSON.parse(result?.content?.[0]?.text || '{}');
}

afterEach(() => {
    for (const path of cleanupPaths.splice(0).reverse()) {
        rmSync(path, { recursive: true, force: true });
    }
});

describe('search workspace trust boundary', () => {
    test('text_search searches ordinary workspace paths', async () => {
        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('text_search', {
            query: 'Product posture',
            path: 'docs/project/product-posture.md',
            maxResults: 5,
        });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.count).toBeGreaterThan(0);
        expect(JSON.stringify(payload)).toContain('Product posture');
    });

    test('text_search rejects absolute out-of-workspace paths without leaking result snippets', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-text-search-outside-')));
        const outsideFile = join(outsideDir, 'outside.txt');
        writeFileSync(outsideFile, 'outsideSecretTextSearchLeak\n');

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('text_search', {
            query: 'outsideSecretTextSearchLeak',
            path: outsideFile,
            maxResults: 5,
        });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretTextSearchLeak\n');
    });

    test('text_search rejects workspace symlink roots whose real target escapes the workspace', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-text-search-symlink-outside-')));
        writeFileSync(join(outsideDir, 'outside.txt'), 'outsideSecretTextSearchSymlinkLeak\n');
        const linkDir = uniqueWorkspacePath('.tmp-text-search-symlink-dir');
        symlinkSync(outsideDir, linkDir, 'dir');

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('text_search', {
            query: 'outsideSecretTextSearchSymlinkLeak',
            path: linkDir,
            maxResults: 5,
        });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretTextSearchSymlinkLeak\n');
    });

    test('symbol_search rejects fileHint symlink escapes without leaking fallback text', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-symbol-search-outside-')));
        const outsideFile = join(outsideDir, 'outside.ts');
        writeFileSync(outsideFile, 'const outsideSecretSymbolSearchLeak = true;\n');
        const linkPath = uniqueWorkspacePath('.tmp-symbol-search-symlink.ts');
        symlinkSync(outsideFile, linkPath);

        const mcp = new MCPAdapter({ buildSymbolMap: async () => ({ declarations: [] }) } as any);
        const result = await mcp.handleToolCall('symbol_search', {
            query: 'outsideSecretSymbolSearchLeak',
            fileHint: linkPath,
            maxResults: 5,
        });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretSymbolSearchLeak = true');
    });
});
