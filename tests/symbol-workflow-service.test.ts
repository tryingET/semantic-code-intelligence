import { describe, expect, test } from 'bun:test';
import {
    SymbolWorkflowService,
    parseWorkflowResult,
    type SymbolWorkflowDeps,
} from '../src/core/workflows/symbol-workflow.js';

function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

function workflowResult(value: Record<string, unknown>) {
    return Promise.resolve({ payload: value, isError: false });
}

function createDeps(overrides: Partial<SymbolWorkflowDeps> = {}): SymbolWorkflowDeps {
    return {
        findDefinition: () => workflowResult({ definitions: [] }),
        buildSymbolMap: () => workflowResult({ declarations: [], references: [] }),
        graphExpand: () => workflowResult({ impactSummary: { hasImpactEvidence: false } }),
        safeRename: () => workflowResult({}),
        patchChecksInSnapshot: () => workflowResult({}),
        applySnapshot: () => workflowResult({}),
        ...overrides,
    };
}

describe('SymbolWorkflowService', () => {
    test('locates definitions with fast pass then precise retry when ambiguous', async () => {
        const calls: any[] = [];
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: async (args) => {
                    calls.push(args);
                    return {
                        payload: {
                            definitions: args.precise ? [{ uri: 'file:///workspace/target.ts', name: args.symbol }] : [],
                        },
                        isError: false,
                    };
                },
            })
        );

        const result = payload(await service.locateConfirmDefinition({ symbol: 'Target' }));
        expect(result).toMatchObject({ workflow: 'locate_confirm_definition', ok: true, decision: 'precise_retry' });
        expect(result.attempts).toEqual([
            { mode: 'fast', count: 0 },
            { mode: 'precise', count: 1 },
        ]);
        expect(calls.map((call) => call.precise)).toEqual([false, true]);
    });

    test('explores symbols by composing navigation, map, and graph services without MCP objects', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                pickOntologySeedFile: async () => 'src/target.ts',
                findDefinition: async (args) => ({
                    payload: { definitions: [{ name: args.symbol, uri: args.file }] },
                    isError: false,
                }),
                buildSymbolMap: async (args) => ({
                    payload: { identifier: args.symbol, files: [args.file], declarations: [], references: [] },
                    isError: false,
                }),
                graphExpand: async (args) => ({
                    payload: { seed: args.symbol, file: args.file, nodes: [] },
                    isError: false,
                }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target', limit: 10 }));
        expect(result).toMatchObject({ ok: true, degraded: false });
        expect(result.definitions.definitions[0]).toMatchObject({ name: 'Target', uri: 'src/target.ts' });
        expect(result.symbolMap).toMatchObject({ identifier: 'Target', files: ['src/target.ts'] });
        expect(result.neighbors).toMatchObject({ seed: 'Target', file: 'src/target.ts' });
    });

    test('reports a confirmed symbol when definition evidence exists', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [{ name: 'KnownSymbol' }] }),
                graphExpand: () => workflowResult({ impactSummary: { hasImpactEvidence: true } }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'KnownSymbol', file: 'src/known.ts' }));

        expect(result.ok).toBe(true);
        expect(result.partial).toBe(false);
        expect(result.degraded).toBe(false);
        expect(result.symbolResolution).toEqual({
            status: 'confirmed',
            definitionCount: 1,
            declarationCount: 0,
            referenceCount: 0,
            hasImpactEvidence: true,
            issues: [],
        });
        expect(result.next_actions).toContain('Open top definition');
    });

    test('accepts declaration-only evidence as symbol confirmation', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                buildSymbolMap: () => workflowResult({ declarations: [{ name: 'DeclaredSymbol' }], references: [] }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'DeclaredSymbol' }));

        expect(result.ok).toBe(true);
        expect(result.symbolResolution).toMatchObject({
            status: 'confirmed',
            definitionCount: 0,
            declarationCount: 1,
        });
    });

    test('does not claim success from file-wide impact when the symbol is unconfirmed', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                buildSymbolMap: () => workflowResult({ declarations: [], references: [{ name: 'MissingSymbol' }] }),
                graphExpand: () => workflowResult({ impactSummary: { hasImpactEvidence: true } }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'MissingSymbol', file: 'src/known.ts' }));

        expect(result.ok).toBe(false);
        expect(result.partial).toBe(true);
        expect(result.degraded).toBe(false);
        expect(result.symbolResolution).toEqual({
            status: 'unconfirmed',
            definitionCount: 0,
            declarationCount: 0,
            referenceCount: 1,
            hasImpactEvidence: true,
            issues: [],
        });
        expect(result.next_actions).not.toContain('Open top definition');
        expect(result.next_actions.join('\n')).toContain('without a file filter');
    });

    test('distinguishes a complete miss from partial impact evidence', async () => {
        const service = new SymbolWorkflowService(createDeps());

        const result = payload(await service.exploreSymbol({ symbol: 'MissingSymbol' }));

        expect(result.ok).toBe(false);
        expect(result.partial).toBe(false);
        expect(result.degraded).toBe(false);
        expect(result.symbolResolution.status).toBe('unconfirmed');
        expect(result.next_actions.join('\n')).toContain('Check the symbol spelling');
    });

    test('reports subcall errors and malformed results as indeterminate rather than absent', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: async () => ({ text: 'definition lookup failed', isError: true }),
                buildSymbolMap: async () => ({ text: 'not-json', isError: false }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'UnknownSymbol' }));

        expect(result.ok).toBe(false);
        expect(result.partial).toBe(false);
        expect(result.degraded).toBe(true);
        expect(result.symbolResolution).toMatchObject({
            status: 'indeterminate',
            definitionCount: 0,
            declarationCount: 0,
            issues: ['find_definition: error_result', 'build_symbol_map: unstructured_result'],
        });
        expect(result.next_actions.join('\n')).toContain('Do not infer');
    });

    test('execute_intent routes patch apply-if-ok through snapshot apply only when allowed', async () => {
        const original = process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        try {
            let applied = false;
            const service = new SymbolWorkflowService(
                createDeps({
                    patchChecksInSnapshot: async () => ({
                        payload: { ok: true, snapshot: 'snap-1' },
                        isError: false,
                    }),
                    applySnapshot: async (args) => {
                        applied = args.snapshot === 'snap-1';
                        return { payload: { ok: true }, isError: false };
                    },
                })
            );

            const result = payload(await service.executeIntent({ patch: 'diff --git a/a b/a', applyIfOk: true }));
            expect(applied).toBe(true);
            expect(result).toMatchObject({ invoked: 'patch_checks_in_snapshot', ok: true, applied: true });
        } finally {
            if (original === undefined) delete process.env.ALLOW_SNAPSHOT_APPLY;
            else process.env.ALLOW_SNAPSHOT_APPLY = original;
        }
    });

    test('parseWorkflowResult decodes text results when possible', () => {
        expect(parseWorkflowResult({ text: '{"ok":true}' })).toEqual({ ok: true });
        expect(parseWorkflowResult({ payload: { ok: true } })).toEqual({ ok: true });
    });
});
