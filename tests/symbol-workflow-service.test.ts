import { describe, expect, test } from 'bun:test';
import {
    SymbolWorkflowService,
    parseWorkflowResult,
    type SymbolWorkflowDeps,
} from '../src/core/workflows/symbol-workflow.js';
import { SYMBOL_IMPACT_DISCLOSURE_BUDGETS } from '../src/core/workflows/symbol-workflow-disclosure.js';

function payload(result: any) {
    return 'payload' in result ? result.payload : result;
}
function byteSize(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
function workflowResult(value: Record<string, unknown>) {
    return Promise.resolve({ payload: value, isError: false });
}
function seedGraph(neighbors: Record<string, unknown[]>) {
    return { file: '/workspace/policy/policy.go', neighbors, impactSummary: { hasImpactEvidence: true } };
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
                provenance: {
                    trace: repeatedContext,
                    token: 'sk-super-secret-value-1234567890',
                    environment: { HOME: '/opt/private-agent' },
                    stack: 'Error: private\n    at /opt/private-agent/private.ts:1:1',
                    note: 'backend failure at /srv/private-agent/private.ts',
                    credential: 'xoxb-super-secret-value-1234567890',
                    jwt: 'eyJheader123456.payload123456.signature123456',
                    '/srv/private-key': 'metadata-key-must-not-escape',
                },
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
                    exports: [
                        {
                            file: 'src/public-api.ts',
                            capture: 'export.func',
                            text: 'Target',
                            start: { line: 4, column: 2 },
                            context: repeatedContext,
                        },
                    ],
                    callers: [
                        {
                            file: 'tests/target.test.ts',
                            caller: 'validatesTarget',
                            start: { line: 4, column: 2 },
                            context: repeatedContext,
                        },
                    ],
                    imports: [
                        {
                            file: 'src/registry/plugin-registry.ts',
                            capture: 'import.name',
                            text: 'TargetDependency',
                            start: { line: 4, column: 2 },
                            context: repeatedContext,
                        },
                    ],
                    callees: [
                        {
                            file: 'src/state/store.ts',
                            name: 'updateTarget',
                            start: { line: 4, column: 2 },
                            context: repeatedContext,
                        },
                    ],
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
                    publicApi: { detected: true, status: 'detected', confidence: 'high' },
                    state: {
                        detected: false,
                        status: 'unknown',
                        namingFallback: { observed: true, hiddenFiles: 1 },
                    },
                    registry: { detected: false, status: 'unknown', namingFallback: { observed: true } },
                    tests: { detected: false, status: 'unknown', namingFallback: { observed: true } },
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
        expect(result.editRisk.signals.state).toMatchObject({
            detected: false,
            status: 'unknown',
            files: [],
            hiddenFiles: 0,
            namingFallback: { observed: true, files: [], hiddenFiles: 1, confidence: 'low' },
        });
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
                            imports: [
                                {
                                    capture: 'import.source',
                                    text: './dependency.js',
                                    start: { line: 0, column: 0 },
                                },
                            ],
                            exports: [{ capture: 'export.func', text: 'Target', start: { line: 1, column: 0 } }],
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
        expect(result.editRisk.signals.publicApi).toMatchObject({
            detected: true,
            status: 'detected',
            confidence: 'high',
            files: ['src/target.ts'],
            hiddenFiles: 0,
            provenance: ['graph.exports'],
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
        expect(result.impact.files.map((item: any) => item.path)).toEqual(['packages/a/src/index.ts', 'src/index.ts']);
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

        expect(result).toMatchObject({ ok: false, status: 'indeterminate', degraded: true });
        expect(result.limitations).toContain(
            'Some definition or reference evidence was omitted because it lacked a supported workspace-contained location.'
        );
        expect(JSON.stringify(result)).not.toContain('/outside/secret.ts');
        expect(graphCalls[0]).not.toHaveProperty('file');
    });
    test('omits secret-shaped compact source metadata without changing the compact schema', async () => {
        const credential = 'xoxb-compact-secret-value-1234567890';
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({ definitions: [location('src/target.ts', { source: credential })] }),
            })
        );

        const result = payload(await service.exploreSymbol({ symbol: 'Target' }));

        expect(result).toMatchObject({ ok: true, status: 'confirmed', details: 'mode: standard' });
        expect(result.definition).not.toHaveProperty('source');
        expect(JSON.stringify(result)).not.toContain(credential);
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
        expect(result).toMatchObject({ degraded: true, editRisk: { level: 'high' } });
        expect(result.limitations).toContain(
            'Some graph evidence was omitted because it lacked a supported workspace-contained location.'
        );
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
        expect(result.editRisk.level).toBe('unknown');
        expect(result.editRisk.signals.publicApi).toMatchObject({
            detected: false,
            status: 'unknown',
            confidence: 'unknown',
            namingFallback: { observed: true, confidence: 'low' },
        });
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
    test('makes compact, standard, and debug progressively disclose bounded evidence', async () => {
        const service = new SymbolWorkflowService(representativeDeps());
        const compact = payload(await service.exploreSymbol({ symbol: 'Target' }));
        const standard = payload(await service.exploreSymbol({ symbol: 'Target', mode: 'standard' }));
        const debug = payload(await service.exploreSymbol({ symbol: 'Target', mode: 'debug' }));

        expect(compact.details).toBe('mode: standard');
        expect(standard.details).toMatchObject({
            schemaVersion: 2,
            mode: 'standard',
            evidence: {
                definitions: { observed: 1, usable: 1 },
                references: { observed: 3, usable: 3 },
                graph: {
                    observedImpact: true,
                    usableImpact: true,
                    observedItems: 4,
                    usableItems: 4,
                },
            },
            provenance: { definitionLookup: { backend: 'layer1+layer2', present: true } },
            disclosure: {
                byteBudget: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.standardBytes,
                truncated: false,
            },
        });
        expect(standard.details.evidence.definitions.items[0]).toEqual({
            path: 'src/target.ts',
            line: 5,
            character: 3,
            kind: 'function',
            confidence: 0.9,
            source: 'exact',
            symbol: 'Target',
        });
        expect(standard.details).not.toHaveProperty('counts');
        expect(standard.details).not.toHaveProperty('definitions');
        expect(standard.details).not.toHaveProperty('limitations');
        expect(standard.details).not.toHaveProperty('diagnostics');
        expect(JSON.stringify(standard.details)).not.toContain('shapeFailures');
        expect(debug.details.mode).toBe('debug');
        expect(debug.details.graph).toMatchObject({
            hasImpactEvidence: true,
            observedImpact: true,
            usableImpact: true,
        });
        expect(debug.details.definitions.items).toEqual(standard.details.evidence.definitions.items);
        expect(debug.details.references.items).toEqual(standard.details.evidence.references.items);
        expect(debug.details.diagnostics.subcalls.map((call: any) => call.name)).toEqual([
            'find_definition',
            'build_symbol_map',
            'graph_expand',
        ]);
        expect(debug.details.diagnostics.subcalls.every((call: any) => call.status === 'ok')).toBe(true);
        expect(debug.details.diagnostics.subcalls.every((call: any) => Number.isFinite(call.elapsedMs))).toBe(true);
        expect(debug.details.diagnostics.subcalls[0].rawFragments[0]).toMatchObject({ encoding: 'json' });
        expect(debug.details.diagnostics.subcalls[0].rawFragments[0].emittedBytes).toBeLessThanOrEqual(
            SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugRawFragmentBytes
        );
        expect(debug.details.diagnostics.subcalls[0].rawFragments[0]).toMatchObject({
            sourceMeasurementTruncated: true,
            truncated: true,
        });
        expect(debug.details.disclosure.truncatedRawFragments).toBeGreaterThan(0);
        expect(debug.details.disclosure.truncated).toBe(true);

        const standardText = JSON.stringify(standard);
        const debugText = JSON.stringify(debug);
        for (const forbidden of [
            '/workspace',
            '/opt/private-agent',
            '/srv/private-agent',
            'xoxb-super-secret-value-1234567890',
            'eyJheader123456.payload123456.signature123456',
            '/srv/private-key',
            'sk-super-secret-value-1234567890',
            'Error: private',
        ]) {
            expect(standardText).not.toContain(forbidden);
            expect(debugText).not.toContain(forbidden);
        }
        expect(byteSize(compact)).toBeLessThan(byteSize(standard));
        expect(byteSize(standard)).toBeLessThan(byteSize(debug));
        expect(byteSize(standard.details)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.standardBytes);
        expect(byteSize(debug.details)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugBytes);
        expect(byteSize(standard)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes);
        expect(byteSize(debug)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes);
        expect(standard.details.disclosure.emittedBytes).toBe(byteSize(standard.details));
        expect(debug.details.disclosure.emittedBytes).toBe(byteSize(debug.details));
    });
    test('hard-bounds hostile provenance keys and values in standard and debug packets', async () => {
        const hugeKey = `metadata_${'K'.repeat(100_000)}`;
        const credential = 'npm_super_secret_value_1234567890';
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        backend: credential,
                        definitions: [location('src/target.ts')],
                        provenance: {
                            [hugeKey]: 'value',
                            note: 'failure at /usr/local/private-source.ts',
                            credential,
                        },
                    }),
            })
        );

        for (const mode of ['standard', 'debug']) {
            const result = payload(await service.exploreSymbol({ symbol: 'Target', mode }));
            const text = JSON.stringify(result);
            expect(text).not.toContain('K'.repeat(100));
            expect(text).not.toContain('/usr/local/private-source.ts');
            expect(text).not.toContain(credential);
            expect(result.details.provenance.definitionLookup.fields).toEqual(['note']);
            expect(result.details.provenance.definitionLookup.fieldsTruncated).toBe(true);
            expect(result.details.disclosure.emittedBytes).toBe(byteSize(result.details));
            expect(byteSize(result.details)).toBeLessThanOrEqual(result.details.disclosure.byteBudget);
            expect(byteSize(result)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes);
        }
    });
    test('redacts cross-platform paths, connection credentials, PEM, environment values, stacks, and compact secrets', async () => {
        const awsSecret = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789+/ab';
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        definitions: [location('src/target.ts', { source: awsSecret })],
                        provenance: {
                            windowsNote: 'read D:\\private\\alice.txt',
                            databaseNote: 'postgres://admin:hunter2@db.internal/app',
                            pemNote: '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
                            pythonNote:
                                'Traceback (most recent call last):\n  File "/srv/private.py", line 1\nPASSWORD=hunter2',
                            DATABASE_URL: 'postgres://admin:hunter2@db.internal/app',
                            PATH: '/srv/private/bin',
                            authNote: 'Authorization: Bearer abcDEF123456789xyz',
                            prefixedEnvNote: 'AWS_SESSION_TOKEN=abcDEF123456789xyz MY_PASSWORD=hunter2',
                            credentialJsonNote: 'credentials={"password":"hunter2"}',
                        },
                    }),
            })
        );

        for (const mode of ['compact', 'standard', 'debug']) {
            const result = payload(await service.exploreSymbol({ symbol: 'Target', mode }));
            const text = JSON.stringify(result);
            for (const forbidden of [
                'D:\\private\\alice.txt',
                'admin:hunter2',
                'private-material',
                'Traceback (most recent call last)',
                'PASSWORD=hunter2',
                '/srv/private.py',
                awsSecret,
                'DATABASE_URL',
                '"PATH"',
                'abcDEF123456789xyz',
                'MY_PASSWORD=hunter2',
                'AWS_SESSION_TOKEN=abcDEF123456789xyz',
                '"password":"hunter2"',
            ]) {
                expect(text).not.toContain(forbidden);
            }
        }
    });

    test('bounds metadata enumeration, limitations, and hostile path packet size', async () => {
        const provenance = Object.fromEntries(
            Array.from({ length: 10_000 }, (_, index) => [`field_${index}`, `value_${index}`])
        );
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () =>
                    workflowResult({
                        definitions: [location(`src/${'x'.repeat(100_000)}.ts`)],
                        provenance,
                    }),
                graphExpand: () =>
                    workflowResult({
                        impactSummary: {
                            hasImpactEvidence: false,
                            limitations: Array.from({ length: 10_000 }, (_, index) => `limitation-${index}`),
                        },
                    }),
            })
        );

        for (const mode of ['standard', 'debug']) {
            const result = payload(await service.exploreSymbol({ symbol: 'Target', mode }));
            expect(result.ok).toBe(false);
            expect(result.status).toBe('indeterminate');
            expect(byteSize(result)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes);
            expect(result.details.provenance.definitionLookup.fieldCount).toBeLessThanOrEqual(
                SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedMetadataFields + 1
            );
            expect(result.details.provenance.definitionLookup.fieldCountExact).toBe(false);
            expect(result.details.provenance.definitionLookup.fieldsTruncated).toBe(true);
            expect(result.details.disclosure.emittedBytes).toBe(byteSize(result.details));
        }
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
            status: 'indeterminate',
            degraded: true,
            evidence: { references: 1, graphImpact: false, partial: true },
            nextReads: [
                {
                    action: 'locate_confirm_definition',
                    arguments: { symbol: 'MissingSymbol', precise: true },
                },
            ],
        });
        expect(result.message).toContain('do not plan edits');
        expect(result.limitations).toContain(
            'Graph impact was reported, but no graph item was usable after bounded normalization.'
        );
        expect(result.nextReads[0].reason).toContain('without the file filter');
        expect(result).not.toHaveProperty('impact');
        expect(result).not.toHaveProperty('details');
        expect(JSON.stringify(result).length).toBeLessThan(900);
    });
    test('normalizes seed-local Go graph captures into usable standard evidence', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                graphExpand: () =>
                    workflowResult(
                        seedGraph({
                            exports: [{ capture: 'export.name', text: 'SetApprover', start: { line: 12, column: 3 } }],
                            imports: [{ capture: 'import.source', text: 'context', start: { line: 2, column: 8 } }],
                            callees: [{ name: 'authorize', start: { line: 20, column: 4 } }],
                            callers: [],
                        })
                    ),
            })
        );
        const compact = payload(await service.exploreSymbol({ symbol: 'SetApprover', file: 'policy/policy.go' }));
        const standard = payload(
            await service.exploreSymbol({ symbol: 'SetApprover', file: 'policy/policy.go', mode: 'standard' })
        );
        expect(compact).toMatchObject({
            ok: false,
            status: 'unconfirmed',
            degraded: false,
            evidence: { references: 0, graphImpact: true, partial: true },
        });
        expect(compact.nextReads[0]).toMatchObject({
            action: 'locate_confirm_definition',
            arguments: { symbol: 'SetApprover', precise: true },
        });
        expect(standard.details).toMatchObject({
            schemaVersion: 2,
            mode: 'standard',
            evidence: {
                graph: { observedImpact: true, usableImpact: true, observedItems: 3, usableItems: 3 },
            },
        });
        expect(standard.details.evidence.graph.edges.exports).toMatchObject({
            observed: 1,
            usable: 1,
            items: [
                {
                    path: 'policy/policy.go',
                    line: 13,
                    character: 4,
                    kind: 'export.name',
                    symbol: 'SetApprover',
                },
            ],
        });
        expect(standard.details).not.toHaveProperty('omissions');
        expect(JSON.stringify(standard)).not.toContain('/workspace');
    });
    test('rejects malformed seed-local graph records instead of laundering them through the seed path', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                graphExpand: () =>
                    workflowResult(
                        seedGraph({
                            exports: [
                                {},
                                { capture: 'export.name', text: 'Target', start: {} },
                                { capture: 'export.name', text: 'Target', start: 'invalid' },
                                { capture: 'export.name', text: 'Target', start: { line: -1, column: 0 } },
                                { capture: 'import.name', text: 'Target', start: { line: 1, column: 0 } },
                            ],
                            imports: [{ capture: 'export.name', text: 'dependency', start: { line: 2, column: 0 } }],
                            callees: [{ name: '', start: { line: 3, column: 0 } }],
                        })
                    ),
            })
        );
        const compact = payload(await service.exploreSymbol({ symbol: 'Target', file: 'policy/policy.go' }));
        const standard = payload(
            await service.exploreSymbol({ symbol: 'Target', file: 'policy/policy.go', mode: 'standard' })
        );

        expect(compact).toMatchObject({
            ok: false,
            status: 'indeterminate',
            degraded: true,
            evidence: { references: 0, graphImpact: false, partial: false },
        });
        expect(compact.limitations).toContain(
            'Graph impact was reported, but no graph item was usable after bounded normalization.'
        );
        expect(standard.details.evidence.graph).toMatchObject({
            observedImpact: true,
            usableImpact: false,
            observedItems: 7,
            usableItems: 0,
        });
        expect(standard.details.omissions).toEqual(
            expect.arrayContaining([
                { section: 'graph.exports', reason: 'invalid_shape', count: 5 },
                { section: 'graph.imports', reason: 'invalid_shape', count: 1 },
                { section: 'graph.callees', reason: 'invalid_shape', count: 1 },
            ])
        );
        expect(JSON.stringify(standard)).not.toContain('/workspace');
    });
    test('never promotes valid-looking payload data from failed subcalls into usable evidence', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                buildSymbolMap: async () => ({
                    payload: {
                        declarations: [],
                        references: [location('src/reference.ts', { kind: 'usage' })],
                    },
                    isError: true,
                }),
                graphExpand: async () => ({
                    payload: seedGraph({
                        exports: [
                            {
                                file: 'src/failed-public.ts',
                                capture: 'export.name',
                                text: 'Target',
                                start: { line: 1, column: 0 },
                            },
                        ],
                    }),
                    isError: true,
                }),
            })
        );
        const compact = payload(await service.exploreSymbol({ symbol: 'Target', file: 'policy/policy.go' }));
        const standard = payload(
            await service.exploreSymbol({ symbol: 'Target', file: 'policy/policy.go', mode: 'standard' })
        );
        const debug = payload(
            await service.exploreSymbol({ symbol: 'Target', file: 'policy/policy.go', mode: 'debug' })
        );

        expect(compact).toMatchObject({
            ok: true,
            status: 'confirmed',
            degraded: true,
            definition: { path: 'src/target.ts' },
            impact: { totalFiles: 1 },
            editRisk: { level: 'high', signals: { publicApi: { detected: false } } },
        });
        expect(compact.impact.files.map((item: any) => item.path)).toEqual(['src/target.ts']);
        expect(compact.limitations).toEqual(['build_symbol_map: error_result', 'graph_expand: error_result']);
        expect(standard.details).toMatchObject({
            schemaVersion: 2,
            evidence: { definitions: { observed: 1, usable: 1 } },
        });
        expect(standard.details.evidence).not.toHaveProperty('graph');
        expect(JSON.stringify(standard)).not.toContain('src/reference.ts');
        expect(JSON.stringify(standard)).not.toContain('src/failed-public.ts');
        expect(debug.details.graph).toMatchObject({
            hasImpactEvidence: false,
            observedImpact: false,
            usableImpact: false,
            observedItems: 0,
            usableItems: 0,
        });
        expect(debug.details.diagnostics.subcalls.map((call: any) => call.status)).toEqual([
            'ok',
            'error_result',
            'error_result',
        ]);
    });
    test('keeps the compact unconfirmed shape while standard and debug explain bounded partial evidence', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: () => workflowResult({ definitions: [{ name: 'MissingSymbol', kind: 'function' }] }),
                buildSymbolMap: () =>
                    workflowResult({ declarations: [], references: [location('src/reference.ts', { kind: 'usage' })] }),
                graphExpand: () => workflowResult({ impactSummary: { hasImpactEvidence: true } }),
            })
        );
        const compact = payload(await service.exploreSymbol({ symbol: 'MissingSymbol', file: 'src/known.ts' }));
        const standard = payload(
            await service.exploreSymbol({ symbol: 'MissingSymbol', file: 'src/known.ts', mode: 'standard' })
        );
        const debug = payload(
            await service.exploreSymbol({ symbol: 'MissingSymbol', file: 'src/known.ts', mode: 'debug' })
        );

        expect(compact).not.toHaveProperty('details');
        expect(byteSize(compact)).toBeLessThan(900);
        expect(standard.details).toMatchObject({
            schemaVersion: 2,
            mode: 'standard',
            evidence: {
                definitions: { observed: 1, usable: 0, omitted: 1 },
                references: { observed: 1, usable: 1 },
                graph: { observedImpact: true, usableImpact: false, observedItems: 0, usableItems: 0 },
            },
            omissions: [{ section: 'definitions', reason: 'invalid_shape', count: 1 }],
        });
        expect(standard.details).not.toHaveProperty('diagnostics');
        expect(JSON.stringify(standard.details)).not.toContain('shapeFailures');
        expect(debug.details.mode).toBe('debug');
        expect(debug.details.diagnostics.subcalls[0].shapeValidationFailures).toContainEqual({
            code: 'invalid_item_shape',
            section: 'definitions',
            count: 1,
        });
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

    test('reports failed, malformed, and thrown subcalls without leaking backend errors or stacks', async () => {
        const service = new SymbolWorkflowService(
            createDeps({
                findDefinition: async () => ({
                    text: 'definition lookup failed at /opt/private-agent/private.ts',
                    isError: true,
                }),
                buildSymbolMap: async () => ({ text: 'not-json', isError: false }),
                graphExpand: async () => {
                    throw new Error('secret stack at /opt/private-agent/private.ts');
                },
            })
        );
        const compact = payload(await service.exploreSymbol({ symbol: 'UnknownSymbol' }));
        const debug = payload(await service.exploreSymbol({ symbol: 'UnknownSymbol', mode: 'debug' }));

        expect(compact).toMatchObject({ ok: false, status: 'indeterminate', degraded: true });
        expect(compact.message).toContain('do not plan edits');
        expect(compact.limitations).toEqual([
            'find_definition: error_result',
            'build_symbol_map: unstructured_result',
            'graph_expand: threw',
        ]);
        expect(debug.details.diagnostics.subcalls.map((call: any) => call.status)).toEqual([
            'error_result',
            'unstructured_result',
            'threw',
        ]);
        expect(JSON.stringify(debug)).not.toContain('/opt/private-agent');
        expect(JSON.stringify(debug)).not.toContain('secret stack');
    });

    test('measures bounded output for confirmed, unconfirmed, degraded, and high-fanout probes', async () => {
        const confirmed = payload(
            await new SymbolWorkflowService(representativeDeps()).exploreSymbol({ symbol: 'Target', mode: 'debug' })
        );
        const unconfirmed = payload(
            await new SymbolWorkflowService(createDeps()).exploreSymbol({ symbol: 'Missing', mode: 'debug' })
        );
        const degraded = payload(
            await new SymbolWorkflowService(
                createDeps({ findDefinition: async () => ({ text: 'failed', isError: true }) })
            ).exploreSymbol({ symbol: 'Missing', mode: 'debug' })
        );
        const fanout = Array.from({ length: 5_000 }, (_, index) =>
            location(`src/consumers/consumer-${index}.ts`, {
                kind: 'usage',
                context: `secret-${index}:${'x'.repeat(500)}`,
            })
        );
        const highFanout = payload(
            await new SymbolWorkflowService(
                createDeps({
                    findDefinition: () => workflowResult({ definitions: [location('src/target.ts')] }),
                    buildSymbolMap: () => workflowResult({ declarations: [], references: fanout }),
                })
            ).exploreSymbol({ symbol: 'Target', mode: 'debug', maxFiles: 25 })
        );
        const measurements = {
            confirmed: byteSize(confirmed),
            unconfirmed: byteSize(unconfirmed),
            degraded: byteSize(degraded),
            highFanout: byteSize(highFanout),
        };

        console.log(`AK4788_SIZE_MEASUREMENTS ${JSON.stringify(measurements)}`);
        expect(highFanout.details.references).toMatchObject({
            count: 5_000,
            emitted: SYMBOL_IMPACT_DISCLOSURE_BUDGETS.itemsPerSection,
            truncated: true,
        });
        expect(highFanout.details.disclosure.omittedItems).toBeGreaterThanOrEqual(
            5_000 - SYMBOL_IMPACT_DISCLOSURE_BUDGETS.itemsPerSection
        );
        for (const result of [confirmed, unconfirmed, degraded, highFanout]) {
            expect(byteSize(result.details)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.debugBytes);
            expect(result.details.disclosure.emittedBytes).toBeLessThanOrEqual(result.details.disclosure.byteBudget);
            expect(result.details.disclosure.emittedBytes).toBe(byteSize(result.details));
            expect(byteSize(result)).toBeLessThanOrEqual(SYMBOL_IMPACT_DISCLOSURE_BUDGETS.packetBytes);
        }
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
