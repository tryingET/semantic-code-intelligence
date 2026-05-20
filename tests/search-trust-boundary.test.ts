import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { overlayStore } from '../src/core/overlay-store';

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

async function freshSnapshot(mcp: MCPAdapter): Promise<string> {
    const result = await mcp.handleToolCall('get_snapshot', { preferExisting: false });
    return parseToolJson(result).snapshot;
}

function updateOneLineDiff(relativePath: string, before: string, after: string): string {
    return [
        `diff --git a/${relativePath} b/${relativePath}`,
        `--- a/${relativePath}`,
        `+++ b/${relativePath}`,
        '@@ -1 +1 @@',
        `-${before}`,
        `+${after}`,
        '',
    ].join('\n');
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

    test('text_search searches staged snapshot overlay content without mutating live workspace results', async () => {
        const liveText = 'search live token';
        const snapshotText = 'search snapshot token';
        const absPath = uniqueWorkspacePath('.tmp-text-search-snapshot-file');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', { snapshot, patch: updateOneLineDiff(relPath, liveText, snapshotText) });

        const snapshotResult = await mcp.handleToolCall('text_search', { query: snapshotText, path: relPath, snapshot, maxResults: 5 });
        const liveResult = await mcp.handleToolCall('text_search', { query: snapshotText, path: relPath, maxResults: 5 });
        const snapshotPayload = parseToolJson(snapshotResult);
        const livePayload = parseToolJson(liveResult);

        expect(snapshotResult.isError).toBe(false);
        expect(snapshotPayload.count).toBeGreaterThan(0);
        expect(JSON.stringify(snapshotPayload)).toContain(snapshotText);
        expect(Number(livePayload.count || 0)).toBe(0);
    });

    test('text_search maps absolute live-workspace paths to the same relative file inside a snapshot', async () => {
        const liveText = 'absolute search live token';
        const snapshotText = 'absolute search snapshot token';
        const absPath = uniqueWorkspacePath('.tmp-text-search-snapshot-absolute');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', { snapshot, patch: updateOneLineDiff(relPath, liveText, snapshotText) });

        const result = await mcp.handleToolCall('text_search', { query: snapshotText, path: absPath, snapshot, maxResults: 5 });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.count).toBeGreaterThan(0);
        expect(JSON.stringify(payload)).toContain(snapshotText);
    });

    test('snapshot text_search rejects traversal and materialized symlink escapes without leaking target content', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-text-search-snapshot-outside-')));
        const outsideFile = join(outsideDir, 'outside.txt');
        writeFileSync(outsideFile, 'outsideSecretSnapshotTextSearchLeak\n');

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        const snapshotRoot = await (overlayStore as any).ensureMaterialized(snapshot);
        const linkRel = `.tmp-text-search-snapshot-link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const linkPath = track(join(snapshotRoot, linkRel));
        mkdirSync(dirname(linkPath), { recursive: true });
        symlinkSync(outsideFile, linkPath);

        const traversal = await mcp.handleToolCall('text_search', { query: 'package', path: '../package.json', snapshot, maxResults: 5 });
        const symlink = await mcp.handleToolCall('text_search', { query: 'outsideSecretSnapshotTextSearchLeak', path: linkRel, snapshot, maxResults: 5 });
        const rendered = JSON.stringify(symlink);

        expect(traversal.isError).toBe(true);
        expect(symlink.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretSnapshotTextSearchLeak\n');
    });

    test('text_search fails closed for unknown snapshot ids', async () => {
        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('text_search', { query: 'anything', snapshot: '00000000-0000-4000-8000-000000000000' });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('Unknown snapshot id');
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
