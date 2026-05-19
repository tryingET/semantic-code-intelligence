import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
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

    test('does not leave workspace artifacts behind after adversarial symlink checks', () => {
        const status = spawnSync('git', ['status', '--short'], { cwd: process.cwd(), encoding: 'utf8' }).stdout;
        expect(status).not.toContain('.tmp-read-file-');
    });
});
