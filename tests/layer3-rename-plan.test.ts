import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { createCodeAnalyzer } from '../src/core/index';

describe('Layer 3 - plan rename (preview)', () => {
    const workspaceRoot = path.resolve(__dirname, 'fixtures');
    let analyzer: any;

    beforeAll(async () => {
        analyzer = await createCodeAnalyzer({ workspaceRoot });
        await analyzer.initialize();
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('returns a WorkspaceEdit with changes for TestClass → RenamedClass (dry run)', async () => {
        const result = await analyzer.rename({
            uri: 'file://workspace',
            position: { line: 0, character: 0 },
            identifier: 'TestClass',
            newName: 'RenamedClass',
            dryRun: true,
        });

        expect(result).toBeDefined();
        expect(result.data).toBeDefined();
        const changes = result.data.changes || {};
        expect(typeof changes).toBe('object');
        expect(Object.keys(changes).length).toBeGreaterThan(0);
        const edits = Object.values(changes).flat() as Array<{ newText: string }>;
        expect(edits.length).toBeGreaterThan(0);
        expect(edits.some((edit) => edit.newText === 'RenamedClass')).toBe(true);
        expect(result.performance).toBeDefined();
    });
});
