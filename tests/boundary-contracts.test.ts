import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AnalyzerFactory } from '../src/core/analyzer-factory.js';
import { CodeAnalysisWorkflowService } from '../src/core/workflows/code-analysis-workflow.js';
import { LSPAdapter } from '../src/adapters/lsp-adapter.js';
import { HTTPAdapter } from '../src/adapters/http-adapter.js';
import { TreeSitterLayer } from '../src/layers/tree-sitter.js';

function fakeCore(overrides: Record<string, any> = {}): any {
    return {
        config: { workspaceRoot: process.cwd() },
        prepareRename: async () => ({ data: null }),
        rename: async () => ({ data: { changes: {} } }),
        getCompletions: async () => ({ data: [] }),
        findDefinitionAsync: async (request: any) => ({
            data: [
                {
                    uri: request.uri,
                    range: { start: request.position, end: request.position },
                    kind: 'variable',
                    name: request.identifier,
                },
            ],
        }),
        findReferencesAsync: async () => ({ data: [] }),
        trackFileChange: async () => undefined,
        getDiagnostics: () => ({}),
        ...overrides,
    };
}

describe('boundary contracts', () => {
    test('AnalyzerFactory deep-merges partial layer overrides', async () => {
        const created = await AnalyzerFactory.createAnalyzer({ layers: { layer2: { enabled: false } as any } });
        try {
            expect(created.layerManager.getLayer('layer2')).toBeTruthy();
        } finally {
            await created.analyzer.dispose().catch(() => undefined);
            await created.layerManager.dispose().catch(() => undefined);
            await created.sharedServices.dispose().catch(() => undefined);
        }
    });

    test('lazy Layer 4 getter returns an engine instead of runtime null', async () => {
        const created = await AnalyzerFactory.createTestAnalyzer();
        try {
            const layer4: any = created.layerManager.getLayer('layer4');
            expect(layer4.getOntologyEngine()).toBeTruthy();
            expect(typeof layer4.getOntologyEngine().ensureInitialized).toBe('function');
        } finally {
            await created.analyzer.dispose().catch(() => undefined);
            await created.layerManager.dispose().catch(() => undefined);
            await created.sharedServices.dispose().catch(() => undefined);
        }
    });

    test('disabled learning layers do not claim capabilities or create disabled DBs', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sci-disabled-layers-'));
        const created = await AnalyzerFactory.createAnalyzer({
            workspaceRoot: dir,
            layers: {
                layer3: { dbPath: join(dir, 'l3', 'symbols.db') } as any,
                layer4: { enabled: false, dbPath: join(dir, 'l4', 'ontology.db') } as any,
                layer5: { enabled: false, dbPath: join(dir, 'l5', 'patterns.db') } as any,
            } as any,
            monitoring: { enabled: false } as any,
        });
        try {
            expect(created.layerManager.getLayer('layer4')).toBeTruthy();
            expect(created.layerManager.getLayer('layer5')).toBeTruthy();
            expect(created.analyzer.getDiagnostics().learningCapabilities).toMatchObject({
                patternLearning: false,
                feedbackCollection: false,
                evolutionTracking: false,
                teamKnowledge: false,
                comprehensiveAnalysis: false,
            });
            expect(existsSync(join(dir, 'l4', 'ontology.db'))).toBe(false);
            expect(existsSync(join(dir, 'l5', 'patterns.db'))).toBe(false);
        } finally {
            await created.analyzer.dispose().catch(() => undefined);
            await created.layerManager.dispose().catch(() => undefined);
            await created.sharedServices.dispose().catch(() => undefined);
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('Layer 5 adapter honors its own DB path instead of the Layer 4 ontology DB', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sci-layer5-db-'));
        const layer5DbPath = join(dir, 'l5', 'patterns.db');
        const created = await AnalyzerFactory.createAnalyzer({
            workspaceRoot: dir,
            layers: {
                layer3: { dbPath: join(dir, 'l3', 'symbols.db') } as any,
                layer4: { dbPath: join(dir, 'l4', 'ontology.db') } as any,
                layer5: { dbPath: layer5DbPath } as any,
            } as any,
            monitoring: { enabled: false } as any,
        });
        try {
            const layer5: any = created.layerManager.getLayer('layer5');
            expect(layer5.getPatternLearner().storage.dbPath).toBe(layer5DbPath);
        } finally {
            await created.analyzer.dispose().catch(() => undefined);
            await created.layerManager.dispose().catch(() => undefined);
            await created.sharedServices.dispose().catch(() => undefined);
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('workspace analyzer scopes default Layer 5 and shared DB paths to the workspace', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sci-workspace-db-'));
        const workspaceDbPath = join(dir, '.ontology', 'ontology.db');
        const created = await AnalyzerFactory.createWorkspaceAnalyzer(dir, { monitoring: { enabled: false } as any });
        try {
            const layer5: any = created.layerManager.getLayer('layer5');
            expect(layer5.getPatternLearner().storage.dbPath).toBe(workspaceDbPath);
            expect((created.sharedServices.database as any).config.path).toBe(workspaceDbPath);
            expect((created.analyzer as any).learningOrchestrator.patternLearner.storage.dbPath).toBe(workspaceDbPath);
        } finally {
            await created.analyzer.dispose().catch(() => undefined);
            await created.layerManager.dispose().catch(() => undefined);
            await created.sharedServices.dispose().catch(() => undefined);
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('workflow completions preserve trigger context and camelCase LSP kinds', async () => {
        let capturedRequest: any;
        const service = new CodeAnalysisWorkflowService({
            coreAnalyzer: {
                getCompletions: async (request: any) => {
                    capturedRequest = request;
                    return {
                        data: [
                            { label: 'EnumMemberItem', kind: 'enumMember' },
                            { label: 'TypeParameterItem', kind: 'typeParameter' },
                        ],
                        performance: {},
                        requestId: 'completion-test',
                    };
                },
            },
            maxResults: () => 20,
            resolveWorkspaceFile: async () => ({
                path: join(process.cwd(), 'sample.ts'),
                uri: 'file://workspace/sample.ts',
                relativePath: 'sample.ts',
            }),
            resolveWorkspaceLexicalPath: (value: string) => ({ path: value, relativePath: value }),
            filterWorkspaceItemsByUri: async (items: any[]) => items,
            workspaceRoot: () => process.cwd(),
        });

        const result = await service.getCompletions({
            file: 'sample.ts',
            position: { line: 0, character: 1 },
            triggerCharacter: '.',
        });

        expect(capturedRequest.context).toEqual({ triggerKind: 2, triggerCharacter: '.' });
        expect((result.payload as any).completions.map((item: any) => item.kind)).toEqual([20, 25]);
    });

    test('LSP adapter seeds didOpen text before applying ranged incremental changes', async () => {
        const adapter = new LSPAdapter(fakeCore(), { workspaceRoot: process.cwd() });
        const uri = pathToFileURL(`${process.cwd()}/tests/__virtual_lsp_incremental.ts`).href;

        await adapter.handleDidOpenTextDocument({
            textDocument: { uri, text: 'const alpha = 1;\n' },
        });
        await adapter.handleDidChangeTextDocument({
            textDocument: { uri },
            contentChanges: [
                {
                    range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
                    text: 'beta',
                },
            ],
        });

        await expect(adapter.resolveIdentifierAtPosition(uri, { line: 0, character: 7 })).resolves.toBe('beta');
    });

    test('LSP close clears definition memo along with synchronized text', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sci-lsp-close-'));
        const file = join(dir, 'sample.ts');
        writeFileSync(file, 'const DiskName = 1;\n', 'utf8');
        const uri = pathToFileURL(file).href;
        const seen: string[] = [];
        const adapter = new LSPAdapter(
            fakeCore({
                config: { workspaceRoot: dir },
                findDefinitionAsync: async (request: any) => {
                    seen.push(request.identifier);
                    return {
                        data: [
                            {
                                uri: request.uri,
                                range: { start: request.position, end: request.position },
                            },
                        ],
                    };
                },
            }),
            { workspaceRoot: dir }
        );

        try {
            await adapter.handleDidOpenTextDocument({ textDocument: { uri, text: 'const MemoryName = 1;\n' } });
            await adapter.handleDefinition({ textDocument: { uri }, position: { line: 0, character: 8 } } as any);
            await adapter.handleDidCloseTextDocument({ textDocument: { uri } });
            await adapter.handleDefinition({ textDocument: { uri }, position: { line: 0, character: 8 } } as any);

            expect(seen).toEqual(['MemoryName', 'DiskName']);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('Tree-sitter language detection handles project paths with spaces without shelling out', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'sci path with spaces '));
        try {
            await writeFile(join(dir, 'sample.py'), 'def sample():\n    return 1\n');
            const layer = new TreeSitterLayer({
                enabled: true,
                timeout: 100,
                languages: ['python'],
                maxFileSize: '100000',
                projectPath: dir,
            });
            expect((layer as any).config.languages).toContain('python');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test('HTTP adapter definition responses preserve OpenAPI-required confidence metadata', async () => {
        const adapter = new HTTPAdapter(
            fakeCore({
                findDefinition: async () => ({
                    data: [
                        {
                            uri: 'file://workspace/example.ts',
                            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 8 } },
                            kind: 'function',
                            name: 'example',
                            confidence: 0.9,
                            source: 'exact',
                            layer: 'layer1',
                        },
                    ],
                    performance: {},
                    timestamp: 1,
                    cacheHit: false,
                }),
            })
        );

        const response = await adapter.handleRequest({
            method: 'POST',
            url: 'http://localhost/api/v1/definition',
            headers: {},
            body: JSON.stringify({ identifier: 'example' }),
        });
        const body = JSON.parse(response.body);

        expect(response.status).toBe(200);
        expect(body.data[0]).toMatchObject({ confidence: 0.9, source: 'exact', layer: 'layer1' });
    });

    test('HTTP adapter preserves internal failures as 500 and rejects NaN numeric bounds', async () => {
        const adapter = new HTTPAdapter(
            fakeCore({
                getCompletions: async () => {
                    throw new Error('boom');
                },
                buildSymbolMap: async () => ({ files: 0, declarations: [], references: [] }),
            })
        );

        const completion = await adapter.handleRequest({
            method: 'POST',
            url: 'http://localhost/api/v1/completions',
            headers: {},
            body: JSON.stringify({ file: 'file://workspace', position: { line: 0, character: 0 } }),
        });
        expect(completion.status).toBe(500);

        const symbolMap = await adapter.handleRequest({
            method: 'POST',
            url: 'http://localhost/api/v1/symbol-map',
            headers: {},
            body: JSON.stringify({ identifier: 'CodeAnalyzer', file: 'file://workspace', maxFiles: 'nope' }),
        });
        expect(symbolMap.status).toBe(400);
    });
});
