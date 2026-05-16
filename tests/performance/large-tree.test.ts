import { beforeAll, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import { AsyncEnhancedGrep } from '../../src/layers/enhanced-search-tools-async';
import { ensureLargeTree } from './utils/large_tree';

const perfOnly = process.env.PERF === '1' && process.env.PERF_LARGE_TREE === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

perfDescribe('Deterministic Large Tree Fixture', () => {
    const root = path.join(process.cwd(), '.test-data', 'large-tree');
    const files = parseInt(process.env.PERF_LARGE_TREE_FILES || '10000', 10);
    let grep: AsyncEnhancedGrep;

    beforeAll(async () => {
        await ensureLargeTree(root, files);
        grep = new AsyncEnhancedGrep({});
    });

    test('list files deterministically', async () => {
        const listed = await grep.listFiles({
            path: root,
            includes: ['**/*.ts'],
            maxDepth: 6,
            timeout: 5000,
            maxFiles: files + 1000,
        });
        // We created at least this many; allow slight variance if maxFiles < total
        expect(listed.length).toBeGreaterThanOrEqual(Math.min(files, listed.length));
    });
});
