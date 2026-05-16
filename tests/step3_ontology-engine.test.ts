import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { OntologyEngine } from '../src/ontology/ontology-engine';
import { OntologyStorage } from '../src/ontology/storage';
import { type Concept, RelationType, ThingKind } from '../src/types/core';

describe('Step 3: OntologyEngine', () => {
    let engine: OntologyEngine;
    const anchor = (symbolText: string) => ({
        symbolText,
        location: {
            uri: 'file:///' + symbolText + '.ts',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        },
        kind: ThingKind.Type,
        role: 'declaration' as const,
        occurrences: 1,
        confidence: 0.9,
    });
    const baseSignature = { parameters: [], sideEffects: [], complexity: 1, fingerprint: 'fp' };

    beforeAll(async () => {
        engine = new OntologyEngine(new OntologyStorage(':memory:'));
        await new Promise((res) => setTimeout(res, 50));
        const concept: Concept = {
            id: '1',
            canonicalName: 'Alpha',
            relations: new Map(),
            signature: baseSignature,
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };
        await engine.addConcept(concept, [anchor('Alpha')]);
    });

    afterAll(async () => {
        await engine.dispose();
    });

    test('finds concept by anchor', async () => {
        const found = await engine.findConcept('Alpha');
        expect(found?.canonicalName).toBe('Alpha');
    });

    test('renames concept through evolution', async () => {
        await engine.evolveConcept({ type: 'rename', conceptId: '1', newName: 'Beta' });
        const renamed = await engine.findConcept('Beta');
        expect(renamed?.canonicalName).toBe('Beta');
    });

    test('adds relations and retrieves related concepts', async () => {
        const concept2: Concept = {
            id: '2',
            canonicalName: 'Gamma',
            relations: new Map(),
            signature: baseSignature,
            evolution: [],
            metadata: { tags: [] },
            confidence: 0.9,
        };
        await engine.addConcept(concept2, [anchor('Gamma')]);
        await engine.addRelation('1', '2', RelationType.Uses);
        const related = engine.getRelatedConcepts('1');
        expect(related.some((r) => r.concept.id === '2')).toBe(true);
    });
});
