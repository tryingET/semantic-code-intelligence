import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceQueryWorkflowService } from '../src/core/workflows/workspace-query-workflow.js';

const roots: string[] = [];
function tempWorkspace() {
    const root = mkdtempSync(join(tmpdir(), 'sci-workspace-query-'));
    roots.push(root);
    return root;
}
function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('WorkspaceQueryWorkflowService', () => {
    test('reads bounded files through configured workspace roots without MCP response objects', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'line 1\nline 2\nline 3\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {},
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(await service.readFile({ path: 'sample.ts', range: { startLine: 2, endLine: 3 } }));
        expect(out).toMatchObject({ path: 'sample.ts', content: 'line 2\nline 3', totalLines: 4 });

        const nullEnd = payload(await service.readFile({ path: 'sample.ts', range: { startLine: 2, endLine: null } }));
        expect(nullEnd.content).toBe('line 2\nline 3\n');
    });

    test('regex text search bypasses heuristic core search and preserves regex semantics', async () => {
        const workspaceRoot = tempWorkspace();
        mkdirSync(join(workspaceRoot, 'src'));
        writeFileSync(join(workspaceRoot, 'src', 'sample.ts'), 'literal a.b\nregex acb\n', 'utf8');
        const calls: any[] = [];
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async initialize() {},
                async textSearch(pattern: string, options: any) {
                    calls.push({ pattern, options });
                    return { count: 1, results: [{ file: 'sample.ts', line: 1, text: 'literal a.b' }] };
                },
            },
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(await service.textSearch({ query: 'a.b', path: 'src', kind: 'regex', maxResults: 10 }));
        expect(calls).toHaveLength(0);
        expect(out.count).toBe(2);
        expect(JSON.stringify(out)).toContain('regex acb');
    });

    test('rejects invalid query and result caps as InvalidParams', async () => {
        const workspaceRoot = tempWorkspace();
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async initialize() {},
                async textSearch() {
                    return { count: 0, results: [] };
                },
                async buildSymbolMap() {
                    return { declarations: [] };
                },
            },
            pathInputFromToolFile: (value) => value,
        });

        await expect(service.textSearch({ query: '' })).rejects.toThrow('Missing required parameter: query');
        await expect(service.textSearch({ query: 'x', maxResults: -1 })).rejects.toThrow(
            'maxResults must be an integer from 1 to 1000'
        );
        await expect(service.textSearch({ query: 'x', timeoutMs: 0 })).rejects.toThrow(
            'timeoutMs must be an integer from 50 to 60000'
        );
        await expect(service.symbolSearch({ query: 'x', maxResults: -1 })).rejects.toThrow(
            'maxResults must be an integer from 1 to 200'
        );
        await expect(service.astQuery({ language: 'typescript', query: '' })).rejects.toThrow(
            'Missing required parameter: query'
        );
        await expect(service.astQuery({ language: 'rust', query: '(function_item)' })).rejects.toThrow(
            'Unsupported ast_query language'
        );
        await expect(
            service.astQuery({ language: 'typescript', query: 'function $A() {}', limit: -1 })
        ).rejects.toThrow('limit must be an integer from 1 to 1000');
    });

    test('symbol_search prioritizes workspace-contained fileHint before maxResults slicing', async () => {
        const workspaceRoot = tempWorkspace();
        mkdirSync(join(workspaceRoot, 'src'));
        writeFileSync(join(workspaceRoot, 'src', 'a.ts'), 'export const Foo = 1;\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'src', 'b.ts'), 'export function Foo() { return 2; }\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async buildSymbolMap(options: any) {
                    expect(options.maxFiles).toBeGreaterThan(1);
                    expect(options.uri).toBe(`file://${join(workspaceRoot, 'src', 'a.ts')}`);
                    return {
                        declarations: [
                            {
                                uri: `file://${join(workspaceRoot, 'src', 'b.ts')}`,
                                range: {},
                                kind: 'function',
                                name: 'Foo',
                            },
                            {
                                uri: `file://${join(workspaceRoot, 'src', 'a.ts')}`,
                                range: {},
                                kind: 'const',
                                name: 'Foo',
                            },
                        ],
                    };
                },
            },
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(await service.symbolSearch({ query: 'Foo', fileHint: 'src/a.ts', maxResults: 1 }));
        expect(out.count).toBe(1);
        expect(out.symbols[0].uri).toContain('/src/a.ts');
    });

    test('symbol_search treats fileHint as priority, not a result filter', async () => {
        const workspaceRoot = tempWorkspace();
        mkdirSync(join(workspaceRoot, 'src'));
        writeFileSync(join(workspaceRoot, 'src', 'a.ts'), 'export const Bar = 1;\n', 'utf8');
        writeFileSync(join(workspaceRoot, 'src', 'b.ts'), 'export const Foo = 2;\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async buildSymbolMap() {
                    return {
                        declarations: [
                            {
                                uri: `file://${join(workspaceRoot, 'src', 'b.ts')}`,
                                range: {},
                                kind: 'const',
                                name: 'Foo',
                            },
                        ],
                    };
                },
            },
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(await service.symbolSearch({ query: 'Foo', fileHint: 'src/a.ts', maxResults: 1 }));
        expect(out.count).toBe(1);
        expect(out.symbols[0].uri).toContain('/src/b.ts');
    });

    test('symbol_search encodes fileHint fallback URIs as file URLs', async () => {
        const workspaceRoot = tempWorkspace();
        mkdirSync(join(workspaceRoot, 'hash#dir'), { recursive: true });
        writeFileSync(join(workspaceRoot, 'hash#dir', 'space file.ts'), 'const EncodedNeedle = 1;\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async buildSymbolMap() {
                    return { declarations: [] };
                },
            },
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(
            await service.symbolSearch({ query: 'EncodedNeedle', fileHint: 'hash#dir/space file.ts', maxResults: 1 })
        );
        expect(out.count).toBe(1);
        expect(out.symbols[0].uri).toContain('hash%23dir/space%20file.ts');
    });

    test('symbol_search prioritizes in-workspace fileHint paths that begin with dot-dot text', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, '..foo.ts'), 'export const DotDotNeedle = 1;\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async buildSymbolMap() {
                    return {
                        declarations: [
                            {
                                uri: pathToFileURL(join(workspaceRoot, 'other.ts')).href,
                                range: {},
                                kind: 'const',
                                name: 'DotDotNeedle',
                            },
                            {
                                uri: pathToFileURL(join(workspaceRoot, '..foo.ts')).href,
                                range: {},
                                kind: 'const',
                                name: 'DotDotNeedle',
                            },
                        ],
                    };
                },
            },
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(await service.symbolSearch({ query: 'DotDotNeedle', fileHint: '..foo.ts', maxResults: 1 }));
        expect(out.count).toBe(1);
        expect(out.symbols[0].uri).toBe(pathToFileURL(join(workspaceRoot, '..foo.ts')).href);
    });

    test('text search uses bounded workspace traversal without requiring analyzer search', async () => {
        const workspaceRoot = tempWorkspace();
        writeFileSync(join(workspaceRoot, 'sample.ts'), 'needle\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspaceRoot,
            coreAnalyzer: {
                async initialize() {},
            },
            pathInputFromToolFile: (value) => value,
        });

        const out = payload(await service.textSearch({ query: 'needle', path: '.', kind: 'literal' }));
        expect(out.count).toBe(1);
        expect(out.results[0]).toMatchObject({
            file: join(workspaceRoot, 'sample.ts'),
            line: 1,
            column: 1,
            text: 'needle',
        });
    });
});
