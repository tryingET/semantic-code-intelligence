import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runAstQuery } from '../src/core/ast-query';
import { MCPAdapter } from '../src/adapters/mcp-adapter';

const functionQuery = '(function_declaration name: (identifier) @name)';
const cleanupPaths: string[] = [];

function track(path: string): string {
    cleanupPaths.push(path);
    return path;
}

function uniqueWorkspacePath(prefix: string): string {
    return track(resolve(process.cwd(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`));
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
});
