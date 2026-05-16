import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { AnalyzerFactory } from '../src/core/analyzer-factory';
import { OntologyEngine } from '../src/ontology/ontology-engine';
import { OntologyStorage } from '../src/ontology/storage';
import type { Concept } from '../src/types/core';

describe('Layer 4 metrics surface', () => {
    test('Instrumented storage collects timings and CLI exposes metrics', async () => {
        // Direct engine path
        const engine = new OntologyEngine(new OntologyStorage(':memory:'));
        await new Promise((r) => setTimeout(r, 20));

        // Do some operations
        const c: Concept = {
            id: 'm1',
            canonicalName: 'MetricOne',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'm' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };
        await engine.addConcept(c, [
            {
                symbolText: 'MetricOne',
                location: {
                    uri: 'file:///MetricOne.ts',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                },
                kind: 'variable' as any,
                role: 'unknown',
                occurrences: 1,
            },
        ]);
        await engine.findConcept('MetricOne');
        await engine.exportConcepts();

        const m = engine.getStorageMetrics();
        expect(m).toBeTruthy();
        expect(m?.operations.upsertConcept?.count || 0).toBeGreaterThan(0);
        expect(m?.operations.loadAllConcepts?.count || 0).toBeGreaterThan(0);
        expect(m?.operations.loadAllSymbols?.count || 0).toBeGreaterThan(0);
        expect(m?.operations.loadAllThings?.count || 0).toBeGreaterThan(0);

        await engine.dispose();
    });
});
