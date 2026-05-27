import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AnalyzerFactory } from '../src/core/analyzer-factory.js';
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
