import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    SymbolWorkflowService,
    type SymbolWorkflowDeps,
} from '../src/core/workflows/symbol-workflow.js';
import { SYMBOL_IMPACT_DISCLOSURE_BUDGETS } from '../src/core/workflows/symbol-workflow-disclosure.js';
import { analyzeStructuralSignalEvidence } from '../src/core/workflows/symbol-workflow-structural-analysis.js';
import { readBoundedStructuralSource } from '../src/core/workflows/symbol-workflow-structural-budget.js';

const ROOT = process.cwd();
const FIXTURE = 'fixtures/symbol-impact-structural';
const SIGNALS = ['publicApi', 'state', 'registry', 'tests'] as const;

function workflowResult(value: Record<string, unknown>) {
    return Promise.resolve({ payload: value, isError: false });
}

function location(path: string, line: number, character: number, extra: Record<string, unknown> = {}) {
    return {
        name: 'ObliqueMarker',
        uri: pathToFileURL(join(ROOT, path)).href,
        range: {
            start: { line: line - 1, character: character - 1 },
            end: { line: line - 1, character: character - 1 + 'ObliqueMarker'.length },
        },
        kind: 'function',
        confidence: 0.99,
        source: 'exact',
        ...extra,
    };
}

function fakeLocation(path: string, extra: Record<string, unknown> = {}) {
    return {
        ...location(path, 1, 1, extra),
        uri: pathToFileURL(join('/workspace', path)).href,
    };
}

function deps(referenceOrder: 'forward' | 'reverse' = 'forward'): SymbolWorkflowDeps {
    const references = [
        location(`${FIXTURE}/mesh.ts`, 1, 10, { kind: 'usage' }),
        location(`${FIXTURE}/verification.ts`, 2, 10, { kind: 'usage' }),
        location(`${FIXTURE}/public-api-index-registry-state-store.spec.ts`, 1, 10, { kind: 'usage' }),
    ];
    if (referenceOrder === 'reverse') references.reverse();
    references.push({ ...references[0] });
    return {
        workspaceRoot: () => ROOT,
        findDefinition: () => workflowResult({ definitions: [location(`${FIXTURE}/facet.ts`, 3, 17)] }),
        buildSymbolMap: () =>
            workflowResult({
                declarations: [location(`${FIXTURE}/facet.ts`, 3, 17)],
                references,
            }),
        graphExpand: () =>
            workflowResult({
                neighbors: {
                    exports: [
                        { capture: 'export.func', text: 'OtherExport' },
                        { capture: 'export.func', text: 'ObliqueMarker' },
                        { capture: 'export.func', text: 'ObliqueMarker' },
                    ],
                    callers: [],
                    imports: [],
                    callees: [],
                },
                impactSummary: { hasImpactEvidence: true },
            }),
        safeRename: () => workflowResult({}),
        patchChecksInSnapshot: () => workflowResult({}),
        applySnapshot: () => workflowResult({}),
    };
}

function payload(result: any) {
    return result?.payload || result;
}

function classificationMetrics(result: any) {
    const truth: Record<(typeof SIGNALS)[number], Set<string>> = {
        publicApi: new Set([`${FIXTURE}/facet.ts`]),
        state: new Set([`${FIXTURE}/facet.ts`]),
        registry: new Set([`${FIXTURE}/mesh.ts`]),
        tests: new Set([`${FIXTURE}/verification.ts`]),
    };
    const files = [
        `${FIXTURE}/facet.ts`,
        `${FIXTURE}/mesh.ts`,
        `${FIXTURE}/verification.ts`,
        `${FIXTURE}/public-api-index-registry-state-store.spec.ts`,
    ];
    let falsePositives = 0;
    let falseNegatives = 0;
    let truePositives = 0;
    let trueNegatives = 0;
    for (const signal of SIGNALS) {
        const predicted = new Set<string>(result.editRisk.signals[signal].files);
        for (const file of files) {
            const expected = truth[signal].has(file);
            const observed = predicted.has(file);
            if (expected && observed) truePositives++;
            else if (expected) falseNegatives++;
            else if (observed) falsePositives++;
            else trueNegatives++;
        }
    }
    return { truePositives, trueNegatives, falsePositives, falseNegatives, labels: files.length * SIGNALS.length };
}

describe('explore_symbol_impact structural risk signals', () => {
    test('finds unconventional structural risks and measures zero fixture false positives/negatives', async () => {
        const result = payload(
            await new SymbolWorkflowService(deps()).exploreSymbol({
                symbol: 'ObliqueMarker',
                maxFiles: 10,
                maxLimitations: 10,
            })
        );

        expect(result.details).toBe('mode: standard');
        expect(result.editRisk.level).toBe('high');
        expect(result.editRisk.signals.publicApi).toMatchObject({
            status: 'detected',
            confidence: 'high',
            files: [`${FIXTURE}/facet.ts`],
            provenance: ['ast.export_declaration', 'graph.exports'],
        });
        expect(result.editRisk.signals.state).toMatchObject({
            status: 'detected',
            confidence: 'medium',
            files: [`${FIXTURE}/facet.ts`],
            provenance: ['ast.definition_write'],
        });
        expect(result.editRisk.signals.registry).toMatchObject({
            status: 'detected',
            confidence: 'medium',
            files: [`${FIXTURE}/mesh.ts`],
            provenance: ['ast.keyed_collection_write'],
        });
        expect(result.editRisk.signals.tests).toMatchObject({
            status: 'detected',
            confidence: 'high',
            files: [`${FIXTURE}/verification.ts`],
            provenance: ['ast.imported_test_call'],
        });
        for (const signal of SIGNALS) {
            expect(result.editRisk.signals[signal].namingFallback).toMatchObject({
                observed: true,
                confidence: 'low',
                provenance: ['fallback.naming'],
            });
        }
        expect(classificationMetrics(result)).toEqual({
            truePositives: 4,
            trueNegatives: 12,
            falsePositives: 0,
            falseNegatives: 0,
            labels: 16,
        });
        expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(48 * 1024);
    });

    test('keeps scoring, evidence ordering, and graph deduplication deterministic', async () => {
        const forward = payload(
            await new SymbolWorkflowService(deps('forward')).exploreSymbol({ symbol: 'ObliqueMarker', maxFiles: 10 })
        );
        const reverse = payload(
            await new SymbolWorkflowService(deps('reverse')).exploreSymbol({ symbol: 'ObliqueMarker', maxFiles: 10 })
        );

        expect(reverse.impact.files).toEqual(forward.impact.files);
        expect(reverse.editRisk).toEqual(forward.editRisk);
        const definition = forward.impact.files.find((file: any) => file.path === `${FIXTURE}/facet.ts`);
        expect(definition.reasons).toEqual(['definition', 'declaration', 'export']);
        expect(definition.score).toBe(280);
    });

    test('labels conventional names as fallback and leaves unsupported signals unknown', async () => {
        const conventional = 'src/public-api-index-registry-state-store.spec.ts';
        const fake: SymbolWorkflowDeps = {
            ...deps(),
            workspaceRoot: () => '/workspace',
            findDefinition: () => workflowResult({ definitions: [fakeLocation('src/plain.ts')] }),
            buildSymbolMap: () =>
                workflowResult({ declarations: [], references: [fakeLocation(conventional, { kind: 'usage' })] }),
            graphExpand: () => workflowResult({ neighbors: {}, impactSummary: { hasImpactEvidence: false } }),
        };
        const result = payload(await new SymbolWorkflowService(fake).exploreSymbol({ symbol: 'ObliqueMarker' }));

        expect(result.editRisk.level).toBe('unknown');
        for (const signal of SIGNALS) {
            expect(result.editRisk.signals[signal]).toMatchObject({
                detected: false,
                status: 'unknown',
                confidence: 'unknown',
                namingFallback: {
                    observed: true,
                    confidence: 'low',
                    files: [conventional],
                    provenance: ['fallback.naming'],
                },
            });
        }
        expect(JSON.stringify(result.editRisk)).not.toContain('not_detected');
    });

    test('does not classify unrelated seed-file exports as target public API evidence', async () => {
        const fake: SymbolWorkflowDeps = {
            ...deps(),
            workspaceRoot: () => '/workspace',
            findDefinition: () => workflowResult({ definitions: [fakeLocation('src/plain.ts')] }),
            buildSymbolMap: () => workflowResult({ declarations: [], references: [] }),
            graphExpand: () =>
                workflowResult({
                    neighbors: { exports: [{ capture: 'export.func', text: 'DifferentSymbol' }] },
                    impactSummary: { hasImpactEvidence: true },
                }),
        };
        const result = payload(await new SymbolWorkflowService(fake).exploreSymbol({ symbol: 'ObliqueMarker' }));

        expect(result.editRisk.level).toBe('unknown');
        expect(result.editRisk.signals.publicApi).toMatchObject({
            detected: false,
            status: 'unknown',
            confidence: 'unknown',
            namingFallback: { observed: false },
        });
    });

    test('caps graph work before sorting and ignores target evidence beyond the analysis boundary', async () => {
        const cap = SYMBOL_IMPACT_DISCLOSURE_BUDGETS.analyzedItemsPerSection;
        const exports = Array.from({ length: cap + 1 }, (_, index) => ({
            capture: 'export.func',
            text: index === cap ? 'ObliqueMarker' : `OtherExport${index}`,
        }));
        const fake: SymbolWorkflowDeps = {
            ...deps(),
            workspaceRoot: () => '/workspace',
            findDefinition: () => workflowResult({ definitions: [fakeLocation('src/plain.ts')] }),
            buildSymbolMap: () => workflowResult({ declarations: [], references: [] }),
            graphExpand: () =>
                workflowResult({
                    neighbors: { exports },
                    impactSummary: { hasImpactEvidence: true },
                }),
        };
        const result = payload(await new SymbolWorkflowService(fake).exploreSymbol({ symbol: 'ObliqueMarker' }));

        expect(result.editRisk.signals.publicApi).toMatchObject({ detected: false, status: 'unknown' });
        expect(result.impact.files[0].score).toBe(120);
        expect(result.limitations).toContain(
            'Backend evidence exceeded an analysis budget and was truncated deterministically.'
        );
    });

    test('emits structured omission receipts for oversized sources and candidate caps', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-ak4799-structural-'));
        try {
            writeFileSync(join(root, 'small.ts'), 'export const ObliqueMarker = 1;\n');
            writeFileSync(join(root, 'large.ts'), `export const ObliqueMarker = 1;\n${'x'.repeat(512 * 1024)}`);
            const oversized = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates: [{ path: 'large.ts', line: 1, character: 14, origin: 'definition' }],
            });
            expect(oversized.analysis).toMatchObject({
                attemptedFiles: 1,
                analyzedFiles: 0,
                oversizedFiles: 1,
                sourceBytesAnalyzed: 0,
            });
            expect(oversized.limitations).toContain(
                'Oversized structural source files were not read or parsed; affected signals remain unknown.'
            );

            const capped = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates: Array.from({ length: 300 }, () => ({
                    path: 'small.ts',
                    line: 1,
                    character: 14,
                    origin: 'definition' as const,
                })),
            });
            expect(capped.analysis).toMatchObject({
                observedCandidates: 300,
                selectedCandidates: 256,
                omittedCandidates: 44,
                analyzedFiles: 1,
            });
            expect(capped.limitations).toContain(
                'Structural source candidates exceeded an analysis budget and were omitted.'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('reconciles candidates omitted by the file cap', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-ak4799-file-cap-'));
        try {
            const candidates = Array.from({ length: 65 }, (_, index) => {
                const path = `f-${String(index).padStart(2, '0')}.ts`;
                writeFileSync(join(root, path), 'export const ObliqueMarker = 1;\n');
                return { path, line: 1, character: 14, origin: 'definition' as const };
            });
            const result = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates,
            });
            expect(result.analysis).toMatchObject({
                observedFiles: 65,
                selectedFiles: 64,
                omittedFiles: 1,
                filesOmittedByFileBudget: 1,
                filesOmittedByTotalByteBudget: 0,
                totalBudgetRejectedFiles: 0,
                unattemptedFiles: 0,
                observedCandidates: 65,
                selectedCandidates: 64,
                omittedCandidates: 1,
                candidatesOmittedByFileBudget: 1,
                rejectedCandidates: 0,
            });
            expect(result.analysis.observedCandidates).toBe(
                result.analysis.selectedCandidates +
                    result.analysis.omittedCandidates +
                    result.analysis.rejectedCandidates
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('shares one bounded AST-work receipt across deeply nested target bodies', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-ak4799-ast-work-'));
        try {
            const depth = 400;
            writeFileSync(
                join(root, 'nested.ts'),
                `${'function ObliqueMarker(){'.repeat(depth)}return 1;${'}'.repeat(depth)}\n`
            );
            const result = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates: [{ path: 'nested.ts', line: 1, character: 10, origin: 'definition' }],
            });
            expect(result.analysis.astWorkUnits).toBeLessThanOrEqual(
                result.analysis.astWorkUnitBudgetPerFile
            );
            expect(result.analysis).toMatchObject({
                symbolBodiesObserved: 400,
                symbolBodiesAnalyzed: 256,
                omittedSymbolBodies: 144,
            });
            expect(result.limitations).toContain(
                'Structural AST evidence exceeded an item budget and was omitted deterministically.'
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('caps actual source bytes read before the total source budget', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-ak4799-source-total-'));
        try {
            const candidates = Array.from({ length: 9 }, (_, index) => {
                const path = `source-${index}.txt`;
                writeFileSync(join(root, path), 'x'.repeat(500_000));
                return { path, line: 1, character: 1, origin: 'reference' as const };
            });
            const result = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates,
            });
            expect(result.analysis.sourceBytesRead).toBeLessThanOrEqual(
                result.analysis.totalSourceByteBudget
            );
            expect(result.analysis).toMatchObject({
                sourceBytesRead: 4_000_000,
                sourceBytesAnalyzed: 4_000_000,
                totalSourceByteBudgetExhausted: true,
                omittedFiles: 1,
                filesOmittedByFileBudget: 0,
                filesOmittedByTotalByteBudget: 1,
                totalBudgetRejectedFiles: 1,
                unattemptedFiles: 0,
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('accounts partial source reads even when a later read fails', async () => {
        let actualBytesRead = 0;
        let receiptBytes = 0;
        let reads = 0;
        const handle = {
            stat: async () => ({ size: 100 }),
            read: async (buffer: Buffer, offset: number) => {
                if (reads++ > 0) throw new Error('injected read failure');
                buffer.fill(120, offset, offset + 50);
                actualBytesRead += 50;
                return { bytesRead: 50 };
            },
        };
        await expect(
            readBoundedStructuralSource(handle, 100, (bytes) => {
                receiptBytes += bytes;
            })
        ).rejects.toThrow('injected read failure');
        expect(receiptBytes).toBe(actualBytesRead);
        expect(receiptBytes).toBe(50);
    });

    test('detects exact export-list sites without treating exported function bodies as target exports', async () => {
        const root = mkdtempSync(join(tmpdir(), 'sci-ak4799-exports-'));
        try {
            writeFileSync(
                join(root, 'relay.ts'),
                'const ObliqueMarker = () => 1;\nexport { ObliqueMarker };\n'
            );
            writeFileSync(
                join(root, 'consumer.ts'),
                'const ObliqueMarker = () => 1;\nexport function Consumer() { return ObliqueMarker(); }\n'
            );
            const relay = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates: [{ path: 'relay.ts', line: 1, character: 7, origin: 'definition' }],
            });
            const consumer = await analyzeStructuralSignalEvidence({
                workspaceRoot: root,
                symbol: 'ObliqueMarker',
                candidates: [{ path: 'consumer.ts', line: 2, character: 37, origin: 'reference' }],
            });
            expect(relay.evidence).toContainEqual(
                expect.objectContaining({
                    signal: 'publicApi',
                    path: 'relay.ts',
                    provenance: 'ast.export_declaration',
                    fallback: false,
                })
            );
            expect(consumer.evidence.some((item) => item.signal === 'publicApi' && !item.fallback)).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
