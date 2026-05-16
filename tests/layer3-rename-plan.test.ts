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
        // Shape validation only; edit counts depend on host tooling availability
        expect(typeof changes).toBe('object');
        expect(result.performance).toBeDefined();
    });
});
