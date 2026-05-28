import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { MCPAdapter } from '../src/adapters/mcp-adapter';
import { runAstQuery } from '../src/core/ast-query';
import { overlayStore } from '../src/core/overlay-store';

const functionQuery = '(function_declaration name: (identifier) @name)';
const cleanupPaths: string[] = [];

function track(path: string): string {
    cleanupPaths.push(path);
    return path;
}

function uniqueWorkspacePath(prefix: string): string {
    return track(resolve(process.cwd(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`));
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

describe('ast_query workspace trust boundary', () => {
    test('queries ordinary workspace files and returns workspace-relative file paths', async () => {
        const result = await runAstQuery({
            language: 'typescript',
            query: functionQuery,
            paths: ['tests/fixtures/example.ts'],
            limit: 20,
        });

        expect(result.count).toBeGreaterThan(0);
        expect(result.results.some((item: any) => item.file === 'tests/fixtures/example.ts')).toBe(true);
        expect(JSON.stringify(result)).toContain('TestFunction');
    });

    test('rejects explicit absolute paths outside the workspace without leaking snippet content', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-ast-query-outside-')));
        const outsideFile = join(outsideDir, 'outside.ts');
        writeFileSync(outsideFile, 'function outsideSecretAstQueryLeak() { return "secret"; }\n');

        let message = '';
        try {
            await runAstQuery({ language: 'typescript', query: functionQuery, paths: [outsideFile], limit: 10 });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toContain('workspace');
        expect(message).not.toContain('outsideSecretAstQueryLeak');
    });

    test('rejects explicit workspace symlinks whose real target escapes the workspace', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-ast-query-symlink-outside-')));
        const outsideFile = join(outsideDir, 'outside.ts');
        writeFileSync(outsideFile, 'function outsideSecretAstQuerySymlinkLeak() { return "secret"; }\n');
        const linkPath = uniqueWorkspacePath('.tmp-ast-query-explicit-symlink');
        symlinkSync(outsideFile, linkPath);

        let rendered = '';
        try {
            await runAstQuery({ language: 'typescript', query: functionQuery, paths: [linkPath], limit: 10 });
        } catch (error) {
            rendered = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
        }

        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretAstQuerySymlinkLeak');
    });

    test('glob expansion skips symlink escapes without returning outside snippets', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-ast-query-glob-outside-')));
        const outsideFile = join(outsideDir, 'outside.ts');
        writeFileSync(outsideFile, 'function outsideSecretAstQueryGlobLeak() { return "secret"; }\n');
        const linkPath = uniqueWorkspacePath('.tmp-ast-query-glob-symlink');
        symlinkSync(outsideFile, linkPath);

        const result = await runAstQuery({
            language: 'typescript',
            query: functionQuery,
            glob: '.tmp-ast-query-glob-symlink-*.ts',
            limit: 10,
        });

        const rendered = JSON.stringify(result);
        expect(rendered).not.toContain('outsideSecretAstQueryGlobLeak');
        expect(result.count).toBe(0);
    });

    test('rejects parent traversal globs before filesystem expansion', async () => {
        let message = '';
        try {
            await runAstQuery({
                language: 'typescript',
                query: functionQuery,
                glob: '../**/*.ts',
                limit: 1,
            });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }

        expect(message).toContain('workspace');
    });

    test('MCP ast_query returns a structured error for escaping explicit paths', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-ast-query-mcp-outside-')));
        const outsideFile = join(outsideDir, 'outside.ts');
        writeFileSync(outsideFile, 'function outsideSecretAstQueryMcpLeak() { return "secret"; }\n');

        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: [outsideFile],
            limit: 10,
        });
        const rendered = JSON.stringify(result);

        expect(result.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretAstQueryMcpLeak');
    });

    test('MCP ast_query queries staged snapshot overlay syntax without mutating live workspace results', async () => {
        const liveText = 'function liveAstSnapshotOnly() { return "live"; }';
        const snapshotText = 'function stagedAstSnapshotOnly() { return "snapshot"; }';
        const absPath = uniqueWorkspacePath('.tmp-ast-query-snapshot-file');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });

        const snapshotResult = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: [relPath],
            snapshot,
            limit: 10,
        });
        const liveResult = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: [relPath],
            limit: 10,
        });
        const snapshotPayload = parseToolJson(snapshotResult);
        const livePayload = parseToolJson(liveResult);

        expect(snapshotResult.isError).toBe(false);
        expect(JSON.stringify(snapshotPayload)).toContain('stagedAstSnapshotOnly');
        expect(JSON.stringify(snapshotPayload)).not.toContain('liveAstSnapshotOnly');
        expect(JSON.stringify(livePayload)).toContain('liveAstSnapshotOnly');
        expect(JSON.stringify(livePayload)).not.toContain('stagedAstSnapshotOnly');
    });

    test('MCP ast_query maps absolute live-workspace paths to snapshot-relative files', async () => {
        const liveText = 'function absoluteLiveAstSnapshotOnly() { return "live"; }';
        const snapshotText = 'function absoluteStagedAstSnapshotOnly() { return "snapshot"; }';
        const absPath = uniqueWorkspacePath('.tmp-ast-query-snapshot-absolute');
        const relPath = relative(process.cwd(), absPath);
        writeFileSync(absPath, `${liveText}\n`);

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        await mcp.handleToolCall('propose_patch', {
            snapshot,
            patch: updateOneLineDiff(relPath, liveText, snapshotText),
        });

        const result = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: [absPath],
            snapshot,
            limit: 10,
        });
        const payload = parseToolJson(result);

        expect(result.isError).toBe(false);
        expect(JSON.stringify(payload)).toContain('absoluteStagedAstSnapshotOnly');
        expect(JSON.stringify(payload)).not.toContain('absoluteLiveAstSnapshotOnly');
    });

    test('MCP snapshot ast_query rejects traversal and materialized symlink escapes without leaking snippets', async () => {
        const outsideDir = track(mkdtempSync(join(tmpdir(), 'sci-ast-query-snapshot-outside-')));
        const outsideFile = join(outsideDir, 'outside.ts');
        writeFileSync(outsideFile, 'function outsideSecretSnapshotAstQueryLeak() { return "secret"; }\n');

        const mcp = new MCPAdapter(undefined as any);
        const snapshot = await freshSnapshot(mcp);
        const snapshotRoot = await (overlayStore as any).ensureMaterialized(snapshot);
        const linkRel = `.tmp-ast-query-snapshot-link-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`;
        const linkPath = track(join(snapshotRoot, linkRel));
        mkdirSync(dirname(linkPath), { recursive: true });
        symlinkSync(outsideFile, linkPath);

        const traversal = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: ['../package.json'],
            snapshot,
            limit: 10,
        });
        const symlink = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: [linkRel],
            snapshot,
            limit: 10,
        });
        const rendered = JSON.stringify(symlink);

        expect(traversal.isError).toBe(true);
        expect(symlink.isError).toBe(true);
        expect(rendered).toContain('workspace');
        expect(rendered).not.toContain('outsideSecretSnapshotAstQueryLeak');
    });

    test('MCP ast_query fails closed for unknown snapshot ids', async () => {
        const mcp = new MCPAdapter(undefined as any);
        const result = await mcp.handleToolCall('ast_query', {
            language: 'typescript',
            query: functionQuery,
            paths: ['tests/fixtures/example.ts'],
            snapshot: '00000000-0000-4000-8000-000000000000',
            limit: 10,
        });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result)).toContain('Unknown snapshot id');
    });
});
