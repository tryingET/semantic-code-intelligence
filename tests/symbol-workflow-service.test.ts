import { describe, expect, test } from 'bun:test';
import { SymbolWorkflowService, parseWorkflowResult } from '../src/core/workflows/symbol-workflow.js';

function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}

describe('SymbolWorkflowService', () => {
    test('locates definitions with fast pass then precise retry when ambiguous', async () => {
        const calls: any[] = [];
        const service = new SymbolWorkflowService({
            findDefinition: async (args) => {
                calls.push(args);
                return {
                    payload: {
                        definitions: args.precise
                            ? [{ uri: 'file:///workspace/target.ts', name: args.symbol }]
                            : [],
                    },
                    isError: false,
                };
            },
            buildSymbolMap: async () => ({ payload: {}, isError: false }),
            graphExpand: async () => ({ payload: {}, isError: false }),
            safeRename: async () => ({ payload: {}, isError: false }),
            patchChecksInSnapshot: async () => ({ payload: {}, isError: false }),
            applySnapshot: async () => ({ payload: {}, isError: false }),
        });

        const result = payload(await service.locateConfirmDefinition({ symbol: 'Target' }));
        expect(result).toMatchObject({ workflow: 'locate_confirm_definition', ok: true, decision: 'precise_retry' });
        expect(result.attempts).toEqual([
            { mode: 'fast', count: 0 },
            { mode: 'precise', count: 1 },
        ]);
        expect(calls.map((call) => call.precise)).toEqual([false, true]);
    });

    test('explores symbols by composing navigation, map, and graph services without MCP objects', async () => {
        const service = new SymbolWorkflowService({
            pickOntologySeedFile: async () => 'src/target.ts',
            findDefinition: async (args) => ({ payload: { definitions: [{ name: args.symbol, uri: args.file }] }, isError: false }),
            buildSymbolMap: async (args) => ({ payload: { identifier: args.symbol, files: [args.file] }, isError: false }),
            graphExpand: async (args) => ({ payload: { seed: args.symbol, file: args.file, nodes: [] }, isError: false }),
            safeRename: async () => ({ payload: {}, isError: false }),
            patchChecksInSnapshot: async () => ({ payload: {}, isError: false }),
            applySnapshot: async () => ({ payload: {}, isError: false }),
        });

        const result = payload(await service.exploreSymbol({ symbol: 'Target', limit: 10 }));
        expect(result).toMatchObject({ ok: true });
        expect(result.definitions.definitions[0]).toMatchObject({ name: 'Target', uri: 'src/target.ts' });
        expect(result.symbolMap).toMatchObject({ identifier: 'Target', files: ['src/target.ts'] });
        expect(result.neighbors).toMatchObject({ seed: 'Target', file: 'src/target.ts' });
    });

    test('execute_intent routes patch apply-if-ok through snapshot apply only when allowed', async () => {
        const original = process.env.ALLOW_SNAPSHOT_APPLY;
        process.env.ALLOW_SNAPSHOT_APPLY = '1';
        try {
            let applied = false;
            const service = new SymbolWorkflowService({
                findDefinition: async () => ({ payload: {}, isError: false }),
                buildSymbolMap: async () => ({ payload: {}, isError: false }),
                graphExpand: async () => ({ payload: {}, isError: false }),
                safeRename: async () => ({ payload: {}, isError: false }),
                patchChecksInSnapshot: async () => ({ payload: { ok: true, snapshot: 'snap-1' }, isError: false }),
                applySnapshot: async (args) => {
                    applied = args.snapshot === 'snap-1';
                    return { payload: { ok: true }, isError: false };
                },
            });

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
