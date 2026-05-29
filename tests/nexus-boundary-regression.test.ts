import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLIAdapter } from '../src/adapters/cli-adapter.js';
import { HTTPAdapter } from '../src/adapters/http-adapter.js';
import { LSPAdapter } from '../src/adapters/lsp-adapter.js';
import { uriToPath } from '../src/adapters/utils.js';
import { expandNeighbors } from '../src/core/code-graph.js';
import { overlayStore } from '../src/core/overlay-store.js';
import { resolveScipArtifact } from '../src/core/scip-reader.js';
import { WorkspaceQueryWorkflowService } from '../src/core/workflows/workspace-query-workflow.js';
import { workspaceInputToPath } from '../src/core/workspace-input.js';
import { AsyncEnhancedGrep } from '../src/layers/enhanced-search-tools-async.js';
import { TreeSitterLayer } from '../src/layers/tree-sitter.js';
import { IgnoreFileManager } from '../src/utils/ignore-file.js';

const roots: string[] = [];
function tempWorkspace(prefix = 'sci-nexus-boundary-') {
    const root = mkdtempSync(join(tmpdir(), prefix));
    roots.push(root);
    return root;
}

afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('nexus boundary regressions', () => {
    test('IgnoreFileManager is read-only on construction and applies directory patterns relative to workspace root', () => {
        const workspace = tempWorkspace();
        const ignorePath = join(workspace, '.semantic-code-ignore');

        const missing = new IgnoreFileManager(workspace);
        expect(existsSync(ignorePath)).toBe(false);
        expect(missing.shouldIgnore(join(workspace, 'node_modules', 'pkg', 'index.js'))).toBe(true);

        writeFileSync(ignorePath, 'generated/\n', 'utf8');
        const manager = new IgnoreFileManager(workspace);
        expect(manager.shouldIgnore(join(workspace, 'generated', 'a.ts'))).toBe(true);
        expect(manager.shouldIgnore(join(workspace, 'src', 'generated', 'a.ts'))).toBe(true);
        expect(manager.shouldIgnore(join(workspace, '..literal-name.ts'))).toBe(false);

        const otherCwd = tempWorkspace('sci-nexus-boundary-cwd-');
        const previousCwd = process.cwd();
        try {
            process.chdir(otherCwd);
            expect(manager.shouldIgnore(join(workspace, 'generated', 'b.ts'))).toBe(true);
        } finally {
            process.chdir(previousCwd);
        }
    });

    test('ripgrep parsing preserves source line whitespace', async () => {
        const workspace = tempWorkspace();
        writeFileSync(join(workspace, 'a.txt'), '  needle  \n', 'utf8');
        const grep = new AsyncEnhancedGrep({ cacheSize: 0 });
        const result = await grep.search({ pattern: 'needle', path: workspace, timeout: 1000 });
        expect(result[0]).toMatchObject({ column: 3, text: '  needle  ' });
    });

    test('TreeSitterLayer emits import relationships and arrow-function names', async () => {
        const workspace = tempWorkspace();
        const importFile = join(workspace, 'imports.ts');
        writeFileSync(importFile, "import {foo} from './b';\nexport function bar(){ return foo(); }\n", 'utf8');
        const arrowFile = join(workspace, 'arrow.ts');
        writeFileSync(arrowFile, 'const baz = () => 1;\n', 'utf8');

        const layer = new TreeSitterLayer({
            enabled: true,
            timeout: 1000,
            languages: ['typescript'],
            maxFileSize: '1MB',
            projectPath: workspace,
        });
        const imports = await layer.process({
            exact: [{ file: importFile, line: 1, column: 1, text: 'foo', match: 'foo', confidence: 1 }],
            fuzzy: [],
            conceptual: [],
            files: new Set([importFile]),
            searchTime: 0,
            toolsUsed: [],
            confidence: 1,
        });
        expect(imports.relationships.some((rel: any) => rel.type === 'imports' && rel.to === './b')).toBe(true);

        const arrows = await layer.process({
            exact: [{ file: arrowFile, line: 1, column: 7, text: 'baz', match: 'baz', confidence: 1 }],
            fuzzy: [],
            conceptual: [],
            files: new Set([arrowFile]),
            searchTime: 0,
            toolsUsed: [],
            confidence: 1,
        });
        expect(arrows.nodes.some((node: any) => node.metadata?.functionName === 'baz')).toBe(true);
    });

    test('Python code graph captures aliased from-imports', async () => {
        const workspace = tempWorkspace();
        writeFileSync(join(workspace, 'a.py'), 'import os, sys\nfrom pkg import a, b as c\n', 'utf8');
        const result = await expandNeighbors({ file: 'a.py', workspaceRoot: workspace, edges: ['imports'], limit: 20 });
        const imports = result.neighbors.imports.map((entry: any) => entry.text);
        expect(imports).toContain('b');
        expect(imports).toContain('c');
    });

    test('workflow path inputs normalize file URIs through the shared workspace boundary', async () => {
        const workspace = tempWorkspace();
        const srcDir = join(workspace, 'src');
        mkdirSync(srcDir);
        writeFileSync(join(workspace, 'sample.ts'), 'const needle = 1;\n', 'utf8');
        writeFileSync(join(srcDir, 'placeholder'), '', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspace,
            coreAnalyzer: {
                async initialize() {},
                async textSearch() {
                    return { count: 0, results: [] };
                },
                async buildSymbolMap() {
                    return { declarations: [] };
                },
            },
            pathInputFromToolFile: (value, root) => workspaceInputToPath(value, root),
        });

        const fileUri = pathToFileURL(join(workspace, 'sample.ts')).href;
        const read = await service.readFile({ path: fileUri, range: { startLine: 1, endLine: 1 } });
        expect((read as any).payload.path).toBe('sample.ts');
        expect((read as any).payload.content).toBe('const needle = 1;');

        const listed = await service.listFiles({ path: pathToFileURL(srcDir).href, maxFiles: 1 });
        expect((listed as any).payload.path).toBe('src');
    });

    test('shared containment accepts in-workspace filenames beginning with dot-dot text', async () => {
        const workspace = tempWorkspace();
        writeFileSync(join(workspace, '..foo.ts'), 'const dotdotName = 1;\n', 'utf8');
        writeFileSync(join(workspace, '..index.scip'), 'not a real index for containment-only resolution\n', 'utf8');
        const service = new WorkspaceQueryWorkflowService({
            workspaceRoot: () => workspace,
            coreAnalyzer: {
                async initialize() {},
                async textSearch() {
                    return { count: 0, results: [] };
                },
                async buildSymbolMap() {
                    return { declarations: [] };
                },
            },
            pathInputFromToolFile: (value, root) => workspaceInputToPath(value, root),
        });

        const direct = await service.readFile({ path: '..foo.ts', range: { startLine: 1, endLine: 1 } });
        expect((direct as any).payload.path).toBe('..foo.ts');
        expect((direct as any).payload.content).toBe('const dotdotName = 1;');

        const snapshot = overlayStore.createSnapshot(false, { workspaceRoot: workspace });
        const fromSnapshot = await service.readFile({
            path: '..foo.ts',
            snapshot: snapshot.id,
            range: { startLine: 1, endLine: 1 },
        });
        expect((fromSnapshot as any).payload.path).toBe('..foo.ts');
        expect((fromSnapshot as any).payload.content).toBe('const dotdotName = 1;');

        const scip = await resolveScipArtifact('..index.scip', { workspaceRoot: workspace });
        expect(scip.path).toBe(join(workspace, '..index.scip'));
    });

    test('LSP completion treats workspace placeholder URIs as contained-boundary misses, not internal errors', async () => {
        const workspace = tempWorkspace();
        const adapter = new LSPAdapter(
            {
                prepareRename: async () => ({ data: null }),
                rename: async () => ({ data: { changes: {} } }),
                getCompletions: async () => ({ data: [] }),
                trackFileChange: async () => undefined,
                getDiagnostics: () => [],
            },
            { workspaceRoot: workspace }
        );

        const result = await adapter.handleCompletion({
            textDocument: { uri: 'file://workspace' },
            position: { line: 0, character: 0 },
        } as any);
        expect(result).toEqual([]);
    });

    test('LSP virtual workspace URIs preserve unsaved document text under non-cwd workspace roots', async () => {
        const workspace = tempWorkspace();
        const file = join(workspace, 'live.ts');
        writeFileSync(file, 'const diskName = 1;\n', 'utf8');
        let definitionRequest: any;
        const adapter = new LSPAdapter(
            {
                findDefinitionAsync: async (request: any) => {
                    definitionRequest = request;
                    return { data: [], performance: {} };
                },
                prepareRename: async () => ({ data: null }),
                rename: async () => ({ data: { changes: {} } }),
                getCompletions: async () => ({ data: [] }),
                trackFileChange: async () => undefined,
                getDiagnostics: () => [],
            },
            { workspaceRoot: workspace }
        );

        await adapter.handleDidOpenTextDocument({
            textDocument: { uri: 'file://workspace/live.ts', text: 'const liveName = 1;\n' },
        } as any);
        await adapter.handleDefinition({
            textDocument: { uri: 'file://workspace/live.ts' },
            position: { line: 0, character: 7 },
        } as any);

        expect(definitionRequest?.identifier).toBe('liveName');
        expect(definitionRequest?.uri).toBe(pathToFileURL(file).href);
    });

    test('LSP convenience methods resolve workspace placeholder URIs against configured roots', async () => {
        const workspace = tempWorkspace();
        const file = join(workspace, 'definition.ts');
        writeFileSync(file, 'const target = 1;\n', 'utf8');
        let definitionRequest: any;
        const adapter = new LSPAdapter(
            {
                initialize: async () => undefined,
                findDefinitionAsync: async (request: any) => {
                    definitionRequest = request;
                    return { data: [], performance: {} };
                },
                prepareRename: async () => ({ data: null }),
                rename: async () => ({ data: { changes: {} } }),
                getCompletions: async () => ({ data: [] }),
                trackFileChange: async () => undefined,
                getDiagnostics: () => [],
            },
            { workspaceRoot: workspace }
        );

        await adapter.findDefinition('file://workspace/definition.ts', { line: 0, character: 7 });

        expect(definitionRequest?.uri).toBe(pathToFileURL(file).href);
        expect(definitionRequest?.identifier).toBe('target');
    });

    test('workspace URI normalization rejects workspace-like file hosts instead of localizing them', async () => {
        const workspace = tempWorkspace();
        mkdirSync(join(workspace, '-evil'), { recursive: true });
        writeFileSync(join(workspace, '-evil', 'a'), 'const shouldNotLocalize = 1;\n', 'utf8');
        expect(() => workspaceInputToPath('file://workspace-evil/a', workspace)).toThrow();
        expect(() => uriToPath('file://workspace-evil/a')).toThrow();

        const core = {
            config: { workspaceRoot: workspace },
            async initialize() {},
            async findDefinitionAsync(request: any) {
                return {
                    data: [
                        {
                            uri: request.uri,
                            range: { start: request.position, end: request.position },
                            kind: 'variable',
                        },
                    ],
                };
            },
            async findReferencesAsync() {
                return { data: [] };
            },
        } as any;
        const http = new HTTPAdapter(core, { enableCors: false, enableOpenAPI: false });
        const httpResponse = await http.handleRequest({
            method: 'POST',
            url: 'http://localhost/api/v1/definition',
            headers: {},
            body: JSON.stringify({ identifier: 'shouldNotLocalize', file: 'file://workspace-evil/a' }),
        });
        expect(httpResponse.status).toBe(400);

        const cli = new CLIAdapter(core);
        await expect(cli.findDefinition('file://workspace-evil/a', { symbol: 'shouldNotLocalize' })).rejects.toThrow();
    });

    test('LSP shared containment rejects outside-workspace precise request URIs', async () => {
        const workspace = tempWorkspace();
        const adapter = new LSPAdapter(
            {
                prepareRename: async () => ({ data: null }),
                rename: async () => ({ data: { changes: {} } }),
                getCompletions: async () => ({ data: [] }),
                trackFileChange: async () => undefined,
                getDiagnostics: () => [],
            },
            { workspaceRoot: workspace }
        );

        expect(await adapter.resolveContainedUriOrNull(pathToFileURL(join(tmpdir(), 'outside.ts')).href)).toBeNull();
    });

    test('LSP rename requests are preview-pure dry runs', async () => {
        const workspace = tempWorkspace();
        const file = join(workspace, 'rename.ts');
        writeFileSync(file, 'const oldName = 1;\n', 'utf8');
        let renameRequest: any;
        const adapter = new LSPAdapter(
            {
                prepareRename: async () => ({ data: null }),
                rename: async (request: any) => {
                    renameRequest = request;
                    return { data: { changes: {} } };
                },
                getCompletions: async () => ({ data: [] }),
                trackFileChange: async () => undefined,
                getDiagnostics: () => [],
            },
            { workspaceRoot: workspace }
        );

        const uri = pathToFileURL(file).toString();
        await adapter.handleDidOpenTextDocument({
            textDocument: { uri, languageId: 'typescript', version: 1, text: readFileSync(file, 'utf8') },
        } as any);
        await adapter.handleRename({
            textDocument: { uri },
            position: { line: 0, character: 7 },
            newName: 'newName',
        } as any);
        expect(renameRequest?.dryRun).toBe(true);
    });
});
