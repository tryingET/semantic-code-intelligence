import { describe, expect, test } from 'bun:test';
import { CodeAnalysisWorkflowService } from '../src/core/workflows/code-analysis-workflow.js';

function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

describe('CodeAnalysisWorkflowService', () => {
    test('shapes completions without MCP protocol objects', async () => {
        const service = new CodeAnalysisWorkflowService({
            maxResults: () => 50,
            resolveWorkspaceFile: async () => ({ path: '', uri: '', relativePath: '' }),
            filterWorkspaceItemsByUri: async (items) => items,
            coreAnalyzer: {
                getCompletions: async () => ({
                    data: [{ label: 'alpha', kind: 'function', detail: 'demo', confidence: 0.8 }],
                    performance: { total: 1 },
                    requestId: 'comp-1',
                }),
            },
        });

        const result = payload(await service.getCompletions({ file: 'target.ts', position: { line: 0, character: 0 } }));
        expect(result).toMatchObject({ schemaVersion: 2, requestId: 'comp-1', count: 1 });
        expect(result.completions[0]).toMatchObject({ label: 'alpha', kind: 3, detail: 'demo', confidence: 0.8 });
    });

    test('builds symbol map and generate-tests payloads without adapter formatting', async () => {
        const service = new CodeAnalysisWorkflowService({
            maxResults: () => 50,
            resolveWorkspaceFile: async () => ({ path: '', uri: '', relativePath: '' }),
            filterWorkspaceItemsByUri: async (items) => items,
            coreAnalyzer: {
                buildSymbolMap: async (request: any) => ({ identifier: request.identifier, files: [request.uri] }),
            },
        });

        const map = payload(await service.buildSymbolMap({ symbol: 'Target', maxFiles: 10 }));
        expect(map).toMatchObject({ schemaVersion: 2, identifier: 'Target' });

        const generated = payload(await service.generateTests({ target: 'src/target.ts', framework: 'bun' }));
        expect(generated).toMatchObject({ status: 'not_implemented', target: 'src/target.ts', framework: 'bun' });
    });

    test('explore_codebase filters out-of-workspace definitions and references', async () => {
        const service = new CodeAnalysisWorkflowService({
            maxResults: () => 50,
            resolveWorkspaceFile: async () => ({ path: '/workspace/target.ts', uri: 'file:///workspace/target.ts', relativePath: 'target.ts' }),
            filterWorkspaceItemsByUri: async (items) => items.filter((item: any) => String(item.uri).includes('/workspace/')),
            coreAnalyzer: {
                exploreCodebase: async () => ({
                    symbol: 'Target',
                    contextUri: 'file:///workspace/target.ts',
                    definitions: [definition('file:///workspace/target.ts'), definition('file:///outside/target.ts')],
                    references: [definition('file:///workspace/ref.ts'), definition('file:///outside/ref.ts')],
                    performance: { total: 1 },
                    diagnostics: [],
                    timestamp: 123,
                }),
            },
        });

        const result = payload(await service.exploreCodebase({ symbol: 'Target', file: 'target.ts' }));
        expect(result).toMatchObject({ schemaVersion: 2, symbol: 'Target', timestamp: 123 });
        expect(result.definitions).toHaveLength(1);
        expect(result.references).toHaveLength(1);
        expect(result.definitions[0].uri).toBe('file:///workspace/target.ts');
    });
});

function definition(uri: string) {
    return {
        uri,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
        kind: 'class',
        name: 'Target',
    };
}
