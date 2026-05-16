import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    createTestConfig,
    fromFileUri,
    getProjectPath,
    getProjectRoot,
    isBunRuntime,
    isTestEnvironment,
    testPaths,
    toFileUri,
} from './test-helpers';

describe('Test Helpers', () => {
    test('getProjectRoot should find project root', () => {
        const root = getProjectRoot();
        expect(root).toBeDefined();
        expect(typeof root).toBe('string');

        // Should find a directory containing package.json
        const packageJsonPath = path.join(root, 'package.json');
        expect(fs.existsSync(packageJsonPath)).toBe(true);
    });

    test('getProjectPath should create paths relative to project root', () => {
        const srcPath = getProjectPath('src');
        const root = getProjectRoot();

        expect(srcPath).toBe(path.join(root, 'src'));
    });

    test('testPaths should provide consistent paths', () => {
        const paths = testPaths;

        expect(typeof paths.root()).toBe('string');
        expect(typeof paths.src()).toBe('string');
        expect(typeof paths.tests()).toBe('string');
        expect(typeof paths.dist()).toBe('string');
        expect(typeof paths.fixtures()).toBe('string');

        // All paths should be absolute
        expect(path.isAbsolute(paths.root())).toBe(true);
        expect(path.isAbsolute(paths.src())).toBe(true);
        expect(path.isAbsolute(paths.fixtures())).toBe(true);
    });

    test('createTestConfig should return valid config', () => {
        const config = createTestConfig();

        expect(config).toBeDefined();
        expect(config.workspaceRoot).toBeDefined();
        expect(config.layers).toBeDefined();
        expect(config.cache).toBeDefined();
        expect(config.database).toBeDefined();
        expect(config.database.path).toBe(':memory:');
    });

    test('createTestConfig should accept overrides', () => {
        const config = createTestConfig({
            database: { path: '/custom/path', maxConnections: 5 },
        });

        expect(config.database.path).toBe('/custom/path');
        expect(config.database.maxConnections).toBe(5);
    });

    test('toFileUri should convert paths to file URIs', () => {
        const uri = toFileUri('test/file.ts');
        expect(uri).toMatch(/^file:\/\//);
        expect(uri).toContain('test/file.ts');
    });

    test('fromFileUri should convert file URIs back to paths', () => {
        const originalPath = '/test/file.ts';
        const uri = `file://${originalPath}`;
        const convertedPath = fromFileUri(uri);

        expect(convertedPath).toBe(originalPath.replace(/\//g, path.sep));
    });

    test('fromFileUri should handle non-URI strings', () => {
        const regularPath = '/test/file.ts';
        const result = fromFileUri(regularPath);
        expect(result).toBe(regularPath);
    });

    test('runtime detection', () => {
        expect(typeof isBunRuntime()).toBe('boolean');
        expect(isBunRuntime()).toBe(true); // Should be true when running with Bun
    });

    test('environment detection', () => {
        expect(typeof isTestEnvironment()).toBe('boolean');
    });
});
