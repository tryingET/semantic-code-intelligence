import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { TreeSitterLayer } from '../src/layers/tree-sitter';
import {
    ensureTestDirectories,
    cleanupTestDirectories,
    testPaths,
    createTestFile,
    testFileContents,
} from './test-helpers';

describe('Layer 2 AST cap via L2_MAX_PARSE_FILES', () => {
    const dir = path.join(testPaths.testWorkspace(), 'l2cap');
    const prevEnv = process.env.L2_MAX_PARSE_FILES;

    beforeAll(() => {
        ensureTestDirectories();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Create 10 small TypeScript files to parse
        for (let i = 0; i < 10; i++) {
            createTestFile(path.join('.test-workspace', 'l2cap', `file${i}.ts`), testFileContents.typescript);
        }
    });

    afterAll(() => {
        // Restore env and cleanup
        if (prevEnv === undefined) delete process.env.L2_MAX_PARSE_FILES;
        else process.env.L2_MAX_PARSE_FILES = prevEnv;
        cleanupTestDirectories();
    });

    test('respects env cap and parses at most N files', async () => {
        process.env.L2_MAX_PARSE_FILES = '5';

        const layer = new TreeSitterLayer({
            enabled: true,
            timeout: 1000,
            languages: ['typescript', 'javascript'],
            maxFileSize: '1MB',
            projectPath: testPaths.testWorkspace(),
        });

        const files = new Set<string>();
        for (let i = 0; i < 10; i++) {
            files.add(path.join(dir, `file${i}.ts`));
        }

        const result = await layer.process({ exact: [], fuzzy: [], conceptual: [], files });
        // Expect no more than 5 files processed; under normal conditions exactly 5
        expect(result.files.length).toBeLessThanOrEqual(5);
        expect(result.files.length).toBe(5);
    });
});
