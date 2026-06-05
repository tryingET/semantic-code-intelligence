import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
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

describe('read_file workspace trust boundary', () => {
    test('reads ordinary workspace files and preserves bounded result shape', async () => {
        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('read_file', {
            path: 'docs/project/product-posture.md',
            range: { startLine: 1, endLine: 12 },
            maxBytes: 2048,
        });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.path).toBe('docs/project/product-posture.md');
        expect(payload.content).toContain('Product posture');
        expect(payload.truncated).toBe(false);
    });

    test('rejects final symlinks whose real target escapes the workspace without leaking target content', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-read-file-outside-')));
        const outsideFile = join(outsideDir, 'outside.txt');
        writeFileSync(outsideFile, 'outside-secret-from-symlink\n');
        const linkPath = uniqueWorkspacePath('.tmp-read-file-final-symlink');
        symlinkSync(outsideFile, linkPath);

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('read_file', { path: linkPath });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outside-secret-from-symlink');
    });

    test('rejects parent-directory symlink escapes that are lexically inside the workspace', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-read-file-parent-outside-')));
        writeFileSync(join(outsideDir, 'outside.txt'), 'outside-secret-from-parent-symlink\n');
        const linkDir = uniqueWorkspacePath('.tmp-read-file-parent-symlink');
        symlinkSync(outsideDir, linkDir, 'dir');
        const requested = `${linkDir}/outside.txt`;

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('read_file', { path: requested });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outside-secret-from-parent-symlink');
    });

    test('allows symlinks that resolve to regular files inside the workspace', async () => {
        const target = resolve(process.cwd(), 'tests/fixtures/example.ts');
        const linkPath = uniqueWorkspacePath('.tmp-read-file-internal-symlink');
        symlinkSync(target, linkPath);

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('read_file', { path: linkPath, range: { startLine: 1, endLine: 5 } });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.path).toContain('.tmp-read-file-internal-symlink');
        expect(payload.content.length).toBeGreaterThan(0);
    });

    test('reads staged snapshot overlay content without mutating the live workspace', async () => {
        const liveText = 'live workspace content';
        const snapshotText = 'snapshot overlay content';
        const absPath = uniqueWorkspacePath('.tmp-read-file-snapshot-overlay.md');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        const proposed = await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });
        expect(proposed.isError).toBe(false);

        const snapshotRead = await mcp.handleToolCall('read_file', { path: relPath, snapshot });
        const liveRead = await mcp.handleToolCall('read_file', { path: relPath });
        const snapshotPayload = parseToolJson(snapshotRead);
        const livePayload = parseToolJson(liveRead);

        expect(snapshotRead.isError).toBe(false);
        expect(snapshotPayload.path).toBe(relPath);
        expect(snapshotPayload.content).toContain(snapshotText);
        expect(snapshotPayload.content).not.toContain(liveText);
        expect(livePayload.content).toContain(liveText);
        expect(livePayload.content).not.toContain(snapshotText);
    });

    test('snapshot read_file rejects materialized control artifacts as non-workspace files', async () => {
        const liveText = 'control artifact live content';
        const snapshotText = 'control artifact snapshot content';
        const absPath = uniqueWorkspacePath('.tmp-read-file-snapshot-control.md');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        const proposed = await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });
        expect(proposed.isError).toBe(false);

        const result = await mcp.handleToolCall('read_file', { path: 'overlay.diff', snapshot });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('snapshot control artifact');
        expect(rendered).not.toContain('control artifact snapshot content');
    });

    test('snapshot text_search skips materialized control artifacts', async () => {
        const liveText = 'text search live content';
        const snapshotText = `unique_snapshot_search_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const absPath = uniqueWorkspacePath('.tmp-read-file-snapshot-search.md');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });

        const result = await mcp.handleToolCall('text_search', {
            snapshot,
            query: snapshotText,
            maxResults: 10,
        });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.results.map((item: any) => item.file)).toEqual([relPath]);
    });

    test('maps absolute live-workspace paths to the same relative file inside a snapshot', async () => {
        const liveText = 'absolute live content';
        const snapshotText = 'absolute snapshot content';
        const absPath = uniqueWorkspacePath('.tmp-read-file-snapshot-absolute.md');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });

        const result = await mcp.handleToolCall('read_file', { path: absPath, snapshot });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.path).toBe(relPath);
        expect(payload.content).toContain(snapshotText);
        expect(payload.content).not.toContain(liveText);
    });

    test('snapshot reads reject traversal and materialized symlink escapes without leaking target content', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-read-file-snapshot-outside-')));
        const outsideFile = join(outsideDir, 'outside.txt');
        writeFileSync(outsideFile, 'outside-secret-from-snapshot-symlink\n');

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        const snapshotRoot = await (overlayStore as any).ensureMaterialized(snapshot);
        const linkRel = `.tmp-read-file-snapshot-link-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const linkPath = track(join(snapshotRoot, linkRel));
        mkdirSync(dirname(linkPath), { recursive: true });
        symlinkSync(outsideFile, linkPath);

        const traversal = await mcp.handleToolCall('read_file', { path: '../package.json', snapshot });
        const symlink = await mcp.handleToolCall('read_file', { path: linkRel, snapshot });
        const rendered = JSON.stringify(symlink);

        expect(traversal.isError).toBe(true);
        expect(symlink.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outside-secret-from-snapshot-symlink');
    });

    test('snapshot reads fail closed for unknown snapshot ids', async () => {
        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('read_file', {
            path: 'package.json',
            snapshot: '00000000-0000-4000-8000-000000000000',
        });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('Unknown snapshot id');
    });

    test('snapshot reads preserve maxBytes bounds for large files', async () => {
        const liveText = 'x'.repeat(1024);
        const snapshotText = 'y'.repeat(1024);
        const absPath = uniqueWorkspacePath('.tmp-read-file-snapshot-large.txt');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });

        const result = await mcp.handleToolCall('read_file', { path: relPath, snapshot, maxBytes: 32 });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.truncated).toBe(true);
        expect(payload.bytes).toBe(32);
        expect(payload.content).toBe('y'.repeat(32));
    });

    test('read_file maxBytes is byte-accurate for multibyte content', async () => {
        const absPath = uniqueWorkspacePath('.tmp-read-file-unicode.txt');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, 'éééabc\n', 'utf8');

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('read_file', { path: relPath, maxBytes: 5 });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(payload.truncated).toBe(true);
        expect(payload.bytes).toBe(4);
        expect(Buffer.byteLength(payload.content, 'utf8')).toBeLessThanOrEqual(5);
        expect(payload.content).toBe('éé');
    });

    test('does not leave workspace artifacts behind after adversarial symlink checks', () => {
        const status = spawnSync('git', ['status', '--short'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
        expect(status).not.toContain('.tmp-read-file-');
    });
});
