import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OntologyEngine } from '../src/ontology/ontology-engine';
import { OntologyStorage } from '../src/ontology/storage';
import type { Concept } from '../src/types/core';
import { testPaths } from './test-helpers';

describe('Layer 4: Engine validation (rename/import/move)', () => {
    const DB = testPaths.testDb();
    let engine: OntologyEngine;

    beforeAll(async () => {
        engine = new OntologyEngine(new OntologyStorage(DB));
        await engine.ensureInitialized();
    });

    afterAll(async () => {
        await engine.dispose();
    });

    test('rename does not create anchors when none exist', async () => {
        const c: Concept = {
            id: 'rn-1',
            canonicalName: 'Foo',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'fp' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };
        await engine.addConcept(c, []);
        await engine.evolveConcept({ type: 'rename', conceptId: 'rn-1', newName: 'Bar' });
        const reloaded = await engine.findConcept('Bar');
        expect(reloaded?.canonicalName).toBe('Bar');

        const anchors = (engine as any).listConceptAnchors('rn-1');
        expect(Array.isArray(anchors)).toBe(true);
        expect(anchors.length).toBe(0);
    });

    test('import drops invalid anchors', async () => {
        await engine.importConcept({
            version: 2,
            concept: {
                id: 'imp-1',
                canonicalName: 'Imp',
                relations: [],
                confidence: 0.8,
                signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'fp' },
                metadata: { tags: [] },
                evolution: [],
            },
            anchors: [
                {
                    symbolText: 'Good',
                    location: {
                        uri: 'file:///valid.ts',
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    },
                    kind: 'variable' as any,
                    role: 'unknown',
                    occurrences: 1,
                    confidence: 0.8,
                },
                // invalid: empty uri
                {
                    symbolText: 'Bad',
                    location: {
                        uri: '',
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    },
                    kind: 'variable' as any,
                    role: 'unknown',
                    occurrences: 1,
                    confidence: 0.8,
                } as any,
            ],
        } as any);

        const loaded = await engine.findConcept('Imp');
        expect(loaded).toBeTruthy();

        const anchors = (engine as any).listConceptAnchors('imp-1');
        const texts = anchors.map((a: any) => a.symbolText).sort();
        expect(texts).toEqual(['Good']);
    });

    test('move is a no-op when given a bad uri', async () => {
        const c: Concept = {
            id: 'mv-1',
            canonicalName: 'Mover',
            relations: new Map(),
            signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'fp' },
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };

        await engine.addConcept(c, [
            {
                symbolText: 'Mover',
                location: {
                    uri: 'file:///valid.ts',
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                },
                kind: 'variable' as any,
                role: 'unknown',
                occurrences: 1,
            },
        ]);

        const beforeUri = (engine as any).listConceptAnchors('mv-1')[0].location.uri;
        await engine.evolveConcept({ type: 'move', conceptId: 'mv-1', location: '' });
        const afterUri = (engine as any).listConceptAnchors('mv-1')[0].location.uri;
        expect(afterUri).toBe(beforeUri);
    });
});
