import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OntologyEngine } from '../src/ontology/ontology-engine';
import { OntologyStorage } from '../src/ontology/storage';

describe('Layer 4: Import/Export parity', () => {
    let engine: OntologyEngine;

    beforeAll(async () => {
        engine = new OntologyEngine(new OntologyStorage(':memory:'));
        await engine.ensureInitialized();
    });

    afterAll(async () => {
        await engine.dispose();
    });

    test('imports and exports concepts (v2)', async () => {
        await engine.importConcept({
            version: 2,
            concept: {
                id: 'demo-1',
                canonicalName: 'Demo',
                relations: [],
                signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'demo' },
                evolution: [],
                metadata: { tags: [] },
                confidence: 0.9,
            },
            anchors: [
                {
                    symbolText: 'Demo',
                    location: {
                        uri: 'file:///demo.ts',
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                    },
                    kind: 'variable' as any,
                    role: 'unknown',
                    occurrences: 1,
                    confidence: 0.9,
                },
            ],
        } as any);

        const exported = await engine.exportConcepts();
        expect(Array.isArray(exported)).toBe(true);
        expect(exported.length).toBeGreaterThan(0);
        expect(exported.some((c: any) => c?.concept?.canonicalName === 'Demo')).toBe(true);
    });
});
