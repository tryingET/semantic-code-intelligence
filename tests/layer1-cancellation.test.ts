import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { AsyncEnhancedGrep } from '../src/layers/enhanced-search-tools-async';

describe('AsyncEnhancedGrep cancellable operations', () => {
    test('searchCancellable can be cancelled quickly', async () => {
        const grep = new AsyncEnhancedGrep();
        const ctrl = grep.searchCancellable({
            pattern: 'CodeAnalyzer',
            path: path.join(process.cwd(), 'tests/fixtures'),
            timeout: 5000,
            maxResults: 1000,
            caseInsensitive: true,
        });
        const start = Date.now();
        ctrl.cancel();
        const results = await ctrl.promise;
        const elapsed = Date.now() - start;
        // Expect cancellation resolution to happen well under a second, independent of suite scheduler load.
        expect(elapsed).toBeLessThan(1000);
        // Results may be partial or empty; ensure promise resolved
        expect(Array.isArray(results)).toBe(true);
    });

    test('listFilesCancellable can be cancelled quickly', async () => {
        const grep = new AsyncEnhancedGrep();
        const ctrl = grep.listFilesCancellable({
            includes: ['**/*CodeAnalyzer*.{ts,tsx,js,jsx,md}'],
            excludes: ['node_modules', 'dist', '.git', 'coverage'],
            path: path.join(process.cwd(), 'tests/fixtures'),
            maxDepth: 8,
            timeout: 5000,
            maxFiles: 5000,
        });
        const start = Date.now();
        ctrl.cancel();
        const files = await ctrl.promise;
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(1000);
        expect(Array.isArray(files)).toBe(true);
    });

    test('searchStream emits a single end event when cancelled', async () => {
        const grep = new AsyncEnhancedGrep();
        const stream = grep.searchStream({
            pattern: 'CodeAnalyzer',
            path: path.join(process.cwd(), 'tests/fixtures'),
            timeout: 5000,
            maxResults: 1000,
            caseInsensitive: true,
        });
        let ends = 0;
        stream.on('end', () => {
            ends += 1;
        });
        stream.cancel();
        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(ends).toBe(1);
    });
});
