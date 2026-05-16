import { describe, expect, test } from 'bun:test';
import { KnowledgeSpreader } from '../src/propagation/knowledge-spreader';
import type { Concept } from '../src/types/core';

function createConcept(id: string, name: string): Concept {
    return {
        id,
        canonicalName: name,
        relations: new Map(),
        signature: { parameters: [], sideEffects: [], complexity: 1, fingerprint: id },
        evolution: [],
        metadata: { tags: [] },
        confidence: 0.9,
    };
}

describe('Step 5: KnowledgeSpreader', () => {
    const baseConcept = createConcept('1', 'alpha');
    const ontology = {
        findConcept: async (_id: string) => baseConcept,
        getRelatedConcepts: (_id: string) => [
            { concept: createConcept('2', 'beta'), relation: 'uses', distance: 1, confidence: 0.9 },
        ],
    } as any;
    const ks = new KnowledgeSpreader(ontology, {} as any);

    test('analyzePropagationPotential returns low for minimal context', async () => {
        const result = await ks.analyzePropagationPotential('alpha');
        expect(result.directRelations).toBe(1);
        expect(result.overallPotential).toBe('low');
    });

    test('analyzePropagationPotential increases with history and module', async () => {
        (ks as any).coChangeHistory.set('alpha', new Map([['gamma', 2]]));
        (ks as any).moduleAnalysis.set('', new Set(['alpha', 'delta']));
        const result = await ks.analyzePropagationPotential('alpha');
        expect(result.directRelations).toBe(1);
        expect(result.historicalCoChanges).toBe(1);
        expect(result.sameModuleConcepts).toBe(2);
        expect(result.overallPotential).toBe('medium');
    });
});
