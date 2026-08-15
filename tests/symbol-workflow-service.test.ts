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

function location(path: string, extra: Record<string, unknown> = {}) {
    return {
        name: 'Target',
        uri: `file:///workspace/${path}`,
        range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
        kind: 'function',
        confidence: 0.9,
        source: 'exact',
        ...extra,
    };
}

function createDeps(overrides: Partial<SymbolWorkflowDeps> = {}): SymbolWorkflowDeps {
    return {
        workspaceRoot: () => '/workspace',
        findDefinition: () => workflowResult({ definitions: [] }),
        buildSymbolMap: () => workflowResult({ declarations: [], references: [] }),
        graphExpand: () => workflowResult({ impactSummary: { hasImpactEvidence: false } }),
        safeRename: () => workflowResult({}),
        patchChecksInSnapshot: () => workflowResult({}),
        applySnapshot: () => workflowResult({}),
        ...overrides,
    };
}

function representativeDeps(): SymbolWorkflowDeps {
    const repeatedContext = 'backend trace detail '.repeat(80);
    return createDeps({
        findDefinition: () =>
            workflowResult({
                backend: 'layer1+layer2',
                definitions: [location('src/target.ts', { context: repeatedContext })],
                provenance: { trace: repeatedContext },
            }),
        buildSymbolMap: () =>
            workflowResult({
                identifier: 'Target',
                declarations: [location('src/target.ts'), location('src/target.ts')],
                references: [
                    location('src/registry/plugin-registry.ts', { kind: 'usage', context: repeatedContext }),
                    location('tests/target.test.ts', { kind: 'call', context: repeatedContext }),
                    location('src/registry/plugin-registry.ts', { kind: 'usage', context: repeatedContext }),
                ],
            }),
        graphExpand: () =>
            workflowResult({
                neighbors: {
                    exports: [{ file: 'src/public-api.ts', symbol: 'Target', context: repeatedContext }],
                    callers: [{ file: 'tests/target.test.ts', caller: 'validatesTarget', context: repeatedContext }],
                    imports: [{ file: 'src/registry/plugin-registry.ts', context: repeatedContext }],
                    callees: [{ file: 'src/state/store.ts', context: repeatedContext }],
                },
                impactSummary: {
                    hasImpactEvidence: true,
                    limitations: ['callers: best-effort syntactic evidence'],
                    provenance: { workspaceRoot: '/workspace', trace: repeatedContext },
                },
            }),
    });
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
                            definitions: args.precise ? [location('target.ts', { name: args.symbol })] : [],
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

    test('returns a compact, deduplicated, semantically ranked impact packet', async () => {
        const result = payload(
            await new SymbolWorkflowService(representativeDeps()).exploreSymbol({
                symbol: 'Target',
                maxFiles: 4,
                maxNextReads: 2,
            })
        );

        expect(result).toMatchObject({
            schemaVersion: 1,
            workflow: 'explore_symbol_impact',
            ok: true,
            status: 'confirmed',
            definition: { path: 'src/target.ts', line: 5 },
            impact: { totalFiles: 5, truncated: true },
            editRisk: {
                level: 'high',
                signals: {
                    publicApi: { detected: true },
                    state: { detected: true, files: [], hiddenFiles: 1 },
                    registry: { detected: true },
                    tests: { detected: true },
                },
            },
            details: 'mode: standard',
        });
        expect(result.impact.files).toHaveLength(4);
        expect(new Set(result.impact.files.map((item: any) => item.path)).size).toBe(4);
        expect(result.impact.files[0]).toMatchObject({ path: 'src/target.ts' });
        expect(result.nextReads).toHaveLength(2);
        expect(result.limitations).toContain(
            'Impact files are truncated; risk signals still summarize all ranked evidence.'
        );
        expect(result.editRisk.signals.state).toEqual({ detected: true, files: [], hiddenFiles: 1 });
        expect(JSON.stringify(result.editRisk)).not.toContain('src/state/store.ts');
        expect(result).not.toHaveProperty('tips');
        expect(result).not.toHaveProperty('symbolMap');
        expect(result).not.toHaveProperty('neighbors');
    });

    test('seeds all graph impact edges from the confirmed definition for symbol-only calls', async () => {
        const graphCalls: any[] = [];
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                graphExpand: (args) => {
                    graphCalls.push(args);
                    return workflowResult({ neighbors: {} });
                },
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.ok).toBe(true);
        expect(graphCalls).toEqual([
            {
                file: 'src/target.ts',
                symbol: 'Target',
                edges: ['imports', 'exports', 'callers', 'callees'],
                depth: 1,
                limit: 50,
            },
        ]);
    });

    test('attributes pathless seed-local import and export captures to the confirmed file', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                graphExpand: () =>
                    workflowResult({
                        neighbors: {
                            imports: [{ capture: 'import.source', text: './dependency.js' }],
                            exports: [{ capture: 'export.func', text: 'Target' }],
                        },
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.impact.files).toHaveLength(1);
        expect(result.impact.files[0]).toMatchObject({
            path: 'src/target.ts',
            reasons: ['definition', 'export', 'import'],
        });
        expect(result.editRisk.signals.publicApi).toEqual({
            detected: true,
            files: ['src/target.ts'],
            hiddenFiles: 0,
        });
    });

    test('does not merge distinct paths merely because one is a suffix of the other', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('packages/a/src/index.ts')] }),
                buildSymbolMap: () =>
                    workflowResult({
                        declarations: [],
                        references: [{ name: 'Target', file: 'src/index.ts', kind: 'usage' }],
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.impact.totalFiles).toBe(2);
        expect(result.impact.files.map((item: any) => item.path)).toEqual([
            'packages/a/src/index.ts',
            'src/index.ts',
        ]);
    });

    test('deduplicates absolute URI and relative paths for the same workspace file', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                buildSymbolMap: () =>
                    workflowResult({
                        declarations: [{ name: 'Target', file: 'src/target.ts', kind: 'function' }],
                        references: [],
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.definitions.count).toBe(1);
        expect(result.impact.totalFiles).toBe(1);
        expect(result.impact.files[0].path).toBe('src/target.ts');
    });

    test('rejects definition candidates outside the trusted workspace', async () => {
        const graphCalls: any[] = [];
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        definitions: [{ name: 'Target', file: '/outside/secret.ts', kind: 'function' }],
                    }),
                graphExpand: (args) => {
                    graphCalls.push(args);
                    return workflowResult({ impactSummary: { hasImpactEvidence: false } });
                },
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result).toMatchObject({ ok: false, status: 'unconfirmed' });
        expect(JSON.stringify(result)).not.toContain('/outside/secret.ts');
        expect(graphCalls[0]).not.toHaveProperty('file');
    });

    test('does not reinterpret a rejected graph path as a pathless seed-local capture', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                graphExpand: () =>
                    workflowResult({
                        neighbors: { exports: [{ file: '/outside/export.ts', text: 'Target' }] },
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.impact.totalFiles).toBe(1);
        expect(result.editRisk.signals.publicApi.detected).toBe(false);
        expect(JSON.stringify(result)).not.toContain('/outside/export.ts');
    });

    test('filters malformed candidates before deduplicating a valid definition at the same location', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        definitions: [
                            location('src/target.ts', { kind: 'unknown' }),
                            location('src/target.ts', { kind: 'function' }),
                        ],
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result).toMatchObject({ ok: true, definition: { path: 'src/target.ts' } });
    });

    test('includes every confirmed definition file in impact and risk analysis', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        definitions: [location('src/internal.ts'), location('src/public-api.ts')],
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.definitions.count).toBe(2);
        expect(result.impact.totalFiles).toBe(2);
        expect(result.impact.files.map((item: any) => item.path)).toContain('src/public-api.ts');
        expect(result.editRisk.level).toBe('high');
        expect(result.editRisk.signals.publicApi.detected).toBe(true);
        expect(result.limitations).toContain(
            'Multiple definition candidates were found; impact includes every confirmed definition file.'
        );
    });

    test('bounds backend limitation strings in compact mode', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                graphExpand: () =>
                    workflowResult({
                        neighbors: {},
                        impactSummary: { limitations: [`large:${'x'.repeat(1_000)}`] },
                    }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result.limitations).toHaveLength(1);
        expect(result.limitations[0].length).toBe(200);
        expect(result.limitations[0].endsWith('…')).toBe(true);
    });

    test('keeps the confirmed definition as the first read even when another file ranks higher', async () => {
        const references = Array.from({ length: 5 }, (_, line) =>
            location('src/heavy-consumer.ts', {
                kind: 'usage',
                range: { start: { line, character: 0 }, end: { line, character: 6 } },
            })
        );
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                buildSymbolMap: () => workflowResult({ declarations: [], references }),
            })
        );
        const result = payload(await service.exploreSymbol({ symbol: 'Target', maxFiles: 1 }));

        expect(result.impact.files).toHaveLength(1);
        expect(result.impact.files[0].path).toBe('src/target.ts');
        expect(result.nextReads[0]).toMatchObject({
            path: 'src/target.ts',
            reason: 'Start at the confirmed definition.',
        });
        expect(JSON.stringify(result)).not.toContain('heavy-consumer.ts');
    });

    test('keeps full backend and provenance evidence behind explicit standard mode', async () => {
        const service = new SymbolWorkflowService(representativeDeps());
        const compact = payload(await service.exploreSymbol({ symbol: 'Target' }));
        const standard = payload(await service.exploreSymbol({ symbol: 'Target', mode: 'standard' }));

        expect(standard.details.definitions.backend).toBe('layer1+layer2');
        expect(standard.details.symbolMap.references).toHaveLength(3);
        expect(standard.details.neighbors.impactSummary.provenance).toBeDefined();
        expect(JSON.stringify(compact).length / JSON.stringify(standard).length).toBeLessThanOrEqual(0.2);
    });

    test('fails closed with a short response when references exist but no locatable definition does', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [{ name: 'MissingSymbol', kind: 'function' }] }),
                buildSymbolMap: () =>
                    workflowResult({ declarations: [], references: [location('src/reference.ts', { kind: 'usage' })] }),
                graphExpand: () => workflowResult({ impactSummary: { hasImpactEvidence: true } }),
            })
        );
        const result = payload(await service.exploreSymbol({ symbol: 'MissingSymbol', file: 'src/known.ts' }));

        expect(result).toMatchObject({
            ok: false,
            status: 'unconfirmed',
            evidence: { references: 1, graphImpact: true, partial: true },
        });
        expect(result.message).toContain('insufficient');
        expect(result.nextReads[0].reason).toContain('without the file filter');
        expect(result).not.toHaveProperty('impact');
        expect(result).not.toHaveProperty('details');
        expect(JSON.stringify(result).length).toBeLessThan(700);
    });

    test('does not confirm locatable candidates without positive definition kind and exact symbol name', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        definitions: [
                            location('src/unknown.ts', { kind: 'unknown' }),
                            location('src/wrong.ts', { name: 'DifferentSymbol' }),
                        ],
                    }),
            })
        );
        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result).toMatchObject({ ok: false, status: 'unconfirmed' });
    });

    test('reports malformed or failed evidence as indeterminate rather than absent', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: async () => ({ text: 'definition lookup failed', isError: true }),
                buildSymbolMap: async () => ({ text: 'not-json', isError: false }),
            })
        );
        const result = payload(await service.exploreSymbol({ symbol: 'UnknownSymbol' }));

        expect(result).toMatchObject({ ok: false, status: 'indeterminate', degraded: true });
        expect(result.message).toContain('do not plan edits');
        expect(result.limitations).toEqual([
            'find_definition: error_result',
            'build_symbol_map: unstructured_result',
        ]);
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
