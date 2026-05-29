import { describe, expect, test } from 'bun:test';
import { type BuildContext, ConceptBuilder, type UsageExample } from '../src/ontology/concept-builder';
import type { ASTNode } from '../src/types/core';

describe('Step 2: ConceptBuilder', () => {
    const builder = new ConceptBuilder();

    test('builds concept with metadata, tags and side effects', async () => {
        const astNode: ASTNode = {
            id: 'file.ts:1',
            type: 'function_declaration',
            text: 'function getUser(id){ console.log(id); }',
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
            children: [],
            metadata: { functionName: 'getUser', parameters: ['id'], returnType: 'User' },
        };

        const usage: UsageExample = {
            file: 'file.ts',
            line: 1,
            context: 'console.log(id)',
            type: 'call',
        };

        const context: BuildContext = {
            identifier: 'getUser',
            location: { uri: 'file.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
            astNodes: [astNode],
            usage: [usage],
        };

        const built = await builder.buildFromContext('getUser', context);
        expect(built).not.toBeNull();
        expect(built!.concept.metadata.tags).toEqual(
            expect.arrayContaining(['getter', 'camelCase', 'user-management'])
        );
        expect(built!.concept.signature.parameters).toContain('id');
        expect(built!.concept.signature.sideEffects).toContain('logging');
        expect(built!.concept.confidence).toBeGreaterThan(0.5);
    });
});
