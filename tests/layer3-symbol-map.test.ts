import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import { createCodeAnalyzer } from '../src/core/index';

describe('Layer 3 - buildSymbolMap robustness', () => {
    const workspaceRoot = path.resolve(__dirname, 'fixtures');
    let analyzer: any;

    beforeAll(async () => {
        analyzer = await createCodeAnalyzer({ workspaceRoot });
        await analyzer.initialize();
    });

    afterAll(async () => {
        await analyzer?.dispose?.();
    });

    test('returns exports for an exported class even without parsers', async () => {
        const result = await (analyzer as any).buildSymbolMap({
            identifier: 'TestClass',
            uri: 'file://workspace',
            maxFiles: 5,
        });

        expect(result).toBeDefined();
        expect(result.identifier).toBe('TestClass');
        // At minimum, we should discover an export entry for TestClass in fixtures
        expect(Array.isArray(result.exports)).toBe(true);
        const hasExport = (result.exports || []).some((e: any) => (e.name || '').toLowerCase() === 'testclass');
        expect(hasExport).toBe(true);
    });
});
