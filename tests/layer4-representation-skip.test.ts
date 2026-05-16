import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OntologyEngine } from '../src/ontology/ontology-engine';
import { OntologyStorage } from '../src/ontology/storage';
import type { Concept } from '../src/types/core';
import { ensureTestDirectories, testPaths } from './test-helpers';

describe('Layer 4: Anchor persistence guards', () => {
    const DB_PATH = testPaths.testDb('ontology-rep-guard');
    let engine1: OntologyEngine;

    beforeAll(async () => {
        ensureTestDirectories();
        engine1 = new OntologyEngine(new OntologyStorage(DB_PATH));
        await new Promise((r) => setTimeout(r, 20));
    });

    afterAll(async () => {
        await engine1.dispose();
    });

    test('skips malformed anchors without crashing', async () => {
        const concept: Concept = {
            id: 'rep-guard-1',
            canonicalName: 'SkipDemo',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'fp' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };

        // Should not throw
        await engine1.addConcept(concept, [
            {
                symbolText: 'GoodRep',
                location: {
                    uri: 'file:///good.ts',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
                },
                kind: 'variable' as any,
                role: 'unknown',
                occurrences: 1,
            },
            // Malformed: missing/invalid uri (should be ignored)
            {
                symbolText: 'BadRep',
                location: { uri: '', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
                kind: 'variable' as any,
                role: 'unknown',
                occurrences: 1,
            } as any,
        ]);

        // New engine loads from DB; should only see valid anchor
        const engine2 = new OntologyEngine(new OntologyStorage(DB_PATH));
        await engine2.ensureInitialized();
        const loaded = await engine2.findConcept('SkipDemo');
        expect(loaded).toBeTruthy();
        const anchors = (engine2 as any).listConceptAnchors(loaded!.id);
        expect(Array.isArray(anchors)).toBe(true);
        expect(anchors.length).toBe(1);
        expect(anchors[0].symbolText).toBe('GoodRep');
        await engine2.dispose();
    });
});
