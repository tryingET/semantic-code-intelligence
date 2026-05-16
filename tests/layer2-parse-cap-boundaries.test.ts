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

describe('Layer 2 AST cap boundaries (L2_MAX_PARSE_FILES)', () => {
    const dir = path.join(testPaths.testWorkspace(), 'l2cap-boundaries');
    const prevEnv = process.env.L2_MAX_PARSE_FILES;

    beforeAll(() => {
        ensureTestDirectories();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // Create 25 small TypeScript files to parse
        for (let i = 0; i < 25; i++) {
            createTestFile(
                path.join('.test-workspace', 'l2cap-boundaries', `file${i}.ts`),
                testFileContents.typescript
            );
        }
    });

    afterAll(() => {
        // Restore env and cleanup
        if (prevEnv === undefined) delete process.env.L2_MAX_PARSE_FILES;
        else process.env.L2_MAX_PARSE_FILES = prevEnv;
        cleanupTestDirectories();
    });

    test('clamps values below 1 to 1', async () => {
        process.env.L2_MAX_PARSE_FILES = '0';

        const layer = new TreeSitterLayer({
            enabled: true,
            timeout: 1000,
            languages: ['typescript', 'javascript'],
            maxFileSize: '1MB',
            projectPath: testPaths.testWorkspace(),
        });

        const files = new Set<string>();
        for (let i = 0; i < 25; i++) {
            files.add(path.join(dir, `file${i}.ts`));
        }

        const result = await layer.process({ exact: [], fuzzy: [], conceptual: [], files });
        expect(result.files.length).toBeLessThanOrEqual(1);
        expect(result.files.length).toBe(1);
    });

    test('defaults to 20 when env is invalid', async () => {
        process.env.L2_MAX_PARSE_FILES = 'abc';

        const layer = new TreeSitterLayer({
            enabled: true,
            timeout: 2000,
            languages: ['typescript', 'javascript'],
            maxFileSize: '1MB',
            projectPath: testPaths.testWorkspace(),
        });

        const files = new Set<string>();
        for (let i = 0; i < 25; i++) {
            files.add(path.join(dir, `file${i}.ts`));
        }

        const result = await layer.process({ exact: [], fuzzy: [], conceptual: [], files });
        expect(result.files.length).toBeLessThanOrEqual(20);
        expect(result.files.length).toBe(20);
    });

    test('caps values above 100; uses available files when fewer', async () => {
        process.env.L2_MAX_PARSE_FILES = '200';

        const layer = new TreeSitterLayer({
            enabled: true,
            timeout: 2000,
            languages: ['typescript', 'javascript'],
            maxFileSize: '1MB',
            projectPath: testPaths.testWorkspace(),
        });

        const files = new Set<string>();
        for (let i = 0; i < 25; i++) {
            files.add(path.join(dir, `file${i}.ts`));
        }

        const result = await layer.process({ exact: [], fuzzy: [], conceptual: [], files });
        // We only created 25 files, so expect all 25 processed
        expect(result.files.length).toBe(25);
    });
});
