import { describe, expect, test } from 'bun:test';
import { AnalyzerFactory } from '../src/core/analyzer-factory';

describe('Layer 1 budget behavior', () => {
    test('findDefinition returns under Layer 1 budget on typical query', async () => {
        const { analyzer } = await AnalyzerFactory.createAnalyzer();
        // Warm-up: prime caches and JIT so measurement reflects typical steady-state usage
        await analyzer.findDefinition({
            uri: `file://${process.cwd()}/README.md`,
            position: { line: 0, character: 0 },
            identifier: 'CodeAnalyzer',
            maxResults: 50,
            includeDeclaration: true,
        });

        const start = Date.now();
        const res = await analyzer.findDefinition({
            uri: `file://${process.cwd()}/README.md`,
            position: { line: 0, character: 0 },
            identifier: 'CodeAnalyzer',
            maxResults: 50,
            includeDeclaration: true,
        });
        const elapsed = Date.now() - start;
        // Should be comfortably under a few seconds in this repo, thanks to async-first fast path
        expect(elapsed).toBeLessThan(3000);
        expect(Array.isArray(res.data)).toBe(true);
    });
});
