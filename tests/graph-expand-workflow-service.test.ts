import { describe, expect, test } from 'bun:test';
import { pathToFileURL } from 'node:url';
import {
    GraphExpandWorkflowService,
    inferGraphLanguage,
    summarizeGraphImpact,
} from '../src/core/workflows/graph-expand-workflow.js';

describe('GraphExpandWorkflowService helpers', () => {
    test('infers graph language support without MCP adapter state', () => {
        expect(inferGraphLanguage('src/example.ts')).toMatchObject({
            language: 'typescript',
            support: 'tree_sitter_best_effort',
        });
        expect(inferGraphLanguage('src/example.clj')).toMatchObject({
            language: 'clj',
            support: 'unsupported_extension',
            supportedEdges: [],
        });
        expect(inferGraphLanguage(undefined)).toMatchObject({
            language: 'symbol_seed',
            support: 'symbol_seed_best_effort',
        });
    });

    test('symbol seeds use build_symbol_map payload declarations as bounded seed files', async () => {
        const seen: any[] = [];
        const service = new GraphExpandWorkflowService({
            workspaceRoot: () => process.cwd(),
            resolveWorkspaceFile: async () => {
                throw new Error('not expected');
            },
            resolveWorkspaceLexicalPath: () => ({ relativePath: 'unused.ts' }),
            containedUriOrNull: async (uri) => uri,
            buildSymbolMap: async (request: any) => {
                seen.push(request);
                return {
                    payload: {
                        declarations: [{ uri: pathToFileURL(`${process.cwd()}/tests/fixtures/example.ts`).href }],
                    },
                };
            },
        });

        const result: any = await service.graphExpand({ symbol: 'TestFunction', edges: ['callees'], limit: 5 });
        expect(seen[0]).toMatchObject({ symbol: 'TestFunction', astOnly: true, maxFiles: 50 });
        expect(result.payload?.impactSummary?.seed).toEqual({ kind: 'symbol', value: 'TestFunction' });
    });

    test('summarizes graph impact evidence as a protocol-neutral payload', () => {
        const impact = summarizeGraphImpact(
            {
                neighbors: {
                    imports: [{ file: 'src/a.ts' }],
                    exports: [],
                    callers: [{ caller: 'run' }],
                    callees: [],
                },
                languageSupport: {
                    language: 'typescript',
                    support: 'tree_sitter_best_effort',
                    supportedEdges: ['imports', 'exports', 'callers', 'callees'],
                },
                provenance: { backend: 'tree_sitter', freshness: 'current' },
            },
            { file: 'src/a.ts', edges: ['imports', 'callers'], depth: 2 },
            '/workspace'
        );

        expect(impact.seed).toEqual({ kind: 'file', value: 'src/a.ts' });
        expect(impact.counts).toMatchObject({ imports: 1, callers: 1 });
        expect(impact.hasImpactEvidence).toBe(true);
        expect(impact.limitations).toContain(
            'depth: recursive graph expansion is not implemented; returned evidence is one-hop best effort'
        );
        expect(impact.provenance).toMatchObject({
            backend: 'tree_sitter',
            freshness: 'current',
            workspaceRoot: '/workspace',
        });
    });
});
