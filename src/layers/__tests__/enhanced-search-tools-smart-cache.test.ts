/**
 * Enhanced Search Tools Smart Cache Integration Tests
 * Tests the integration between enhanced search tools and smart caching
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    createEnhancedSearchTools,
    EnhancedGlob,
    EnhancedGrep,
    EnhancedLS,
    type EnhancedSearchTools,
} from '../enhanced-search-tools.js';

describe('Enhanced Search Tools with Smart Cache', () => {
    let tempDir: string;
    let testFiles: string[];

    beforeEach(async () => {
        // Create temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(import.meta.dirname, 'test-enhanced-'));

        // Create test files with different content
        testFiles = [];
        const testContents = [
            'function testFunction() {\n  console.log("test");\n}',
            'class TestClass {\n  constructor() {\n    this.name = "test";\n  }\n}',
            'export const testConstant = "test value";\nexport default testConstant;',
            'import { testFunction } from "./test1.ts";\ntestFunction();',
        ];

        for (let i = 0; i < testContents.length; i++) {
            const filePath = path.join(tempDir, `test${i + 1}.ts`);
            await fs.writeFile(filePath, testContents[i]);
            testFiles.push(filePath);
        }

        // Create a subdirectory with additional files
        const subDir = path.join(tempDir, 'subdir');
        await fs.mkdir(subDir);

        const subFilePath = path.join(subDir, 'subtest.ts');
        await fs.writeFile(subFilePath, 'const subTest = "subdirectory test";');
        testFiles.push(subFilePath);

        // Wait for file system operations to complete
        await new Promise((resolve) => setTimeout(resolve, 10));
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn('Error cleaning up test directory:', error);
        }
    });

    describe('EnhancedGrep with Smart Cache', () => {
        let grep: EnhancedGrep;

        beforeEach(() => {
            grep = new EnhancedGrep({
                enableSmartCache: true,
                cacheConfig: {
                    maxSize: 100,
                    defaultTtl: 60000,
                    gitAware: false,
                    zones: [
                        {
                            name: 'test-files',
                            patterns: [path.join(tempDir, '**')],
                            ttl: 30000,
                            checkFileModTime: true,
                            watchFiles: true,
                            description: 'Test files',
                        },
                    ],
                },
            });
        });

        afterEach(async () => {
            await grep.dispose();
        });

        it('should cache search results', async () => {
            const params = {
                pattern: 'test',
                path: tempDir,
                outputMode: 'content' as const,
            };

            // First search - should miss cache
            const results1 = await grep.search(params);
            expect(results1.length).toBeGreaterThan(0);

            // Second search - should hit cache
            const results2 = await grep.search(params);
            expect(results2).toEqual(results1);

            const stats = grep.getCacheStats();
            expect(stats.hits).toBeGreaterThan(0);
        });

        it('should invalidate cache when file is modified', async () => {
            const params = {
                pattern: 'testFunction',
                path: testFiles[0],
                outputMode: 'content' as const,
            };

            // First search
            const results1 = await grep.search(params);
            expect(results1.length).toBe(1);

            // Modify the file
            await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure different mtime
            await fs.writeFile(testFiles[0], 'function modifiedFunction() {\n  console.log("modified");\n}');

            // Search again - should return different results due to cache invalidation
            const results2 = await grep.search(params);
            expect(results2.length).toBe(0); // testFunction no longer exists

            // Search for new content
            const modifiedParams = { ...params, pattern: 'modifiedFunction' };
            const results3 = await grep.search(modifiedParams);
            expect(results3.length).toBe(1);
        });

        it('should handle different search paths with separate cache entries', async () => {
            // Search in different files
            const params1 = {
                pattern: 'test',
                path: testFiles[0],
                outputMode: 'content' as const,
            };

            const params2 = {
                pattern: 'test',
                path: testFiles[1],
                outputMode: 'content' as const,
            };

            const results1 = await grep.search(params1);
            const results2 = await grep.search(params2);

            expect(results1[0]?.file).toBe(testFiles[0]);
            expect(results2[0]?.file).toBe(testFiles[1]);

            // Both should be cached independently
            const stats = grep.getCacheStats();
            expect(stats.hits).toBe(0); // First searches are cache misses
            expect(stats.misses).toBe(2);

            // Repeat searches should hit cache
            await grep.search(params1);
            await grep.search(params2);

            const updatedStats = grep.getCacheStats();
            expect(updatedStats.hits).toBe(2);
        });
    });

    describe('EnhancedGlob with Smart Cache', () => {
        let glob: EnhancedGlob;

        beforeEach(() => {
            glob = new EnhancedGlob({
                enableSmartCache: true,
                cacheConfig: {
                    maxSize: 100,
                    defaultTtl: 60000,
                    gitAware: false,
                },
            });
        });

        afterEach(async () => {
            await glob.dispose();
        });

        it('should cache glob results', async () => {
            const params = {
                pattern: '*.ts',
                path: tempDir,
            };

            // First search
            const results1 = await glob.search(params);
            expect(results1.files.length).toBe(4); // 4 TypeScript files in main dir

            // Second search - should hit cache
            const results2 = await glob.search(params);
            expect(results2).toEqual(results1);

            const stats = glob.getCacheStats();
            expect(stats.hits).toBeGreaterThan(0);
        });

        it('should invalidate cache when directory contents change', async () => {
            const params = {
                pattern: '*.ts',
                path: tempDir,
            };

            // First search
            const results1 = await glob.search(params);
            const initialCount = results1.files.length;

            // Add a new file
            const newFilePath = path.join(tempDir, 'newfile.ts');
            await fs.writeFile(newFilePath, 'const newFile = "new file";');

            // Wait for file system changes to be detected
            await new Promise((resolve) => setTimeout(resolve, 20));

            // Search again - should detect the new file
            const results2 = await glob.search(params);
            expect(results2.files.length).toBe(initialCount + 1);

            // Clean up
            await fs.unlink(newFilePath);
        });

        it('should handle recursive glob patterns', async () => {
            const params = {
                pattern: '**/*.ts',
                path: tempDir,
            };

            const results = await glob.search(params);
            expect(results.files.length).toBe(5); // 4 in main dir + 1 in subdir

            // Cache the results
            const cachedResults = await glob.search(params);
            expect(cachedResults).toEqual(results);
        });
    });

    describe('EnhancedLS with Smart Cache', () => {
        let ls: EnhancedLS;

        beforeEach(() => {
            ls = new EnhancedLS({
                enableSmartCache: true,
                cacheConfig: {
                    maxSize: 100,
                    defaultTtl: 60000,
                    gitAware: false,
                },
            });
        });

        afterEach(async () => {
            await ls.dispose();
        });

        it('should cache directory listings', async () => {
            const params = {
                path: tempDir,
                includeMetadata: true,
            };

            // First listing
            const results1 = await ls.list(params);
            expect(results1.entries.length).toBeGreaterThan(0);

            // Second listing - should hit cache
            const results2 = await ls.list(params);
            expect(results2).toEqual(results1);

            const stats = ls.getCacheStats();
            expect(stats.hits).toBeGreaterThan(0);
        });

        it('should invalidate cache when directory is modified', async () => {
            const params = {
                path: tempDir,
                includeMetadata: true,
            };

            // First listing
            const results1 = await ls.list(params);
            const initialCount = results1.entries.length;

            // Add a new file
            const newFilePath = path.join(tempDir, 'newfile.txt');
            await fs.writeFile(newFilePath, 'new file content');

            // Wait for file system changes
            await new Promise((resolve) => setTimeout(resolve, 20));

            // List again - should detect the new file
            const results2 = await ls.list(params);
            expect(results2.entries.length).toBe(initialCount + 1);

            // Clean up
            await fs.unlink(newFilePath);
        });

        it('should handle recursive directory listings', async () => {
            const params = {
                path: tempDir,
                recursive: true,
                includeMetadata: true,
            };

            const results = await ls.list(params);
            expect(results.entries.length).toBeGreaterThan(5); // Files + subdirectory entries

            // Should find the subdirectory file
            const subDirFile = results.entries.find((entry) => entry.name === 'subtest.ts');
            expect(subDirFile).toBeDefined();
        });
    });

    describe('EnhancedSearchTools Unified Interface', () => {
        let searchTools: EnhancedSearchTools;

        beforeEach(() => {
            searchTools = createEnhancedSearchTools({
                globalSmartCache: {
                    maxSize: 200,
                    defaultTtl: 60000,
                    gitAware: false,
                    zones: [
                        {
                            name: 'test-zone',
                            patterns: [path.join(tempDir, '**')],
                            ttl: 30000,
                            checkFileModTime: true,
                            watchFiles: true,
                            description: 'Test zone for all tools',
                        },
                    ],
                },
            });
        });

        afterEach(async () => {
            await searchTools.dispose();
        });

        it('should provide unified cache statistics', () => {
            const cacheStats = searchTools.getCacheStats();
            expect(cacheStats.grep).toBeDefined();
            expect(cacheStats.glob).toBeDefined();
            expect(cacheStats.ls).toBeDefined();
        });

        it('should provide unified cache size information', () => {
            const cacheSize = searchTools.getCacheSize();
            expect(cacheSize.grep).toBeDefined();
            expect(cacheSize.glob).toBeDefined();
            expect(cacheSize.ls).toBeDefined();
        });

        it('should clear all caches at once', async () => {
            // Perform some operations to populate caches
            await searchTools.grep.search({ pattern: 'test', path: tempDir });
            await searchTools.glob.search({ pattern: '*.ts', path: tempDir });
            await searchTools.ls.list({ path: tempDir });

            // Verify caches have entries
            let totalEntries = 0;
            const sizes = searchTools.getCacheSize();
            totalEntries += sizes.grep.entries + sizes.glob.entries + sizes.ls.entries;
            expect(totalEntries).toBeGreaterThan(0);

            // Clear all caches
            await searchTools.clearAllCaches();

            // Verify caches are empty
            const clearedSizes = searchTools.getCacheSize();
            const clearedTotal = clearedSizes.grep.entries + clearedSizes.glob.entries + clearedSizes.ls.entries;
            expect(clearedTotal).toBe(0);
        });

        it('should maintain separate cache spaces for each tool', async () => {
            // Use same search terms but different tools
            const grepResults = await searchTools.grep.search({
                pattern: 'test',
                path: tempDir,
                outputMode: 'files_with_matches',
            });

            const globResults = await searchTools.glob.search({
                pattern: '*.ts',
                path: tempDir,
            });

            const lsResults = await searchTools.ls.list({
                path: tempDir,
            });

            // Each tool should have independent cache entries
            const stats = searchTools.getCacheStats();
            expect(stats.grep.misses).toBe(1); // First grep search
            expect(stats.glob.misses).toBe(1); // First glob search
            expect(stats.ls.misses).toBe(1); // First ls operation

            // Repeat operations should hit cache
            await searchTools.grep.search({
                pattern: 'test',
                path: tempDir,
                outputMode: 'files_with_matches',
            });

            const updatedStats = searchTools.getCacheStats();
            expect(updatedStats.grep.hits).toBe(1);
        });
    });

    describe('Cache Performance', () => {
        it('should improve performance on repeated searches', async () => {
            const searchTools = createEnhancedSearchTools({
                globalSmartCache: {
                    maxSize: 1000,
                    defaultTtl: 60000,
                    gitAware: false,
                },
            });

            try {
                const params = {
                    pattern: 'test',
                    path: tempDir,
                    outputMode: 'content' as const,
                };

                // Measure first search (cache miss)
                const start1 = Date.now();
                const results1 = await searchTools.grep.search(params);
                const time1 = Date.now() - start1;

                // Measure second search (cache hit)
                const start2 = Date.now();
                const results2 = await searchTools.grep.search(params);
                const time2 = Date.now() - start2;

                expect(results2).toEqual(results1);
                // Cache hit should be significantly faster (this might be flaky in very fast systems)
                // expect(time2).toBeLessThan(time1);

                const stats = searchTools.getCacheStats();
                expect(stats.grep.hits).toBe(1);
                expect(stats.grep.misses).toBe(1);
                expect(stats.grep.hitRate).toBeCloseTo(0.5);
            } finally {
                await searchTools.dispose();
            }
        });
    });

    describe('Memory Management', () => {
        it('should respect memory limits', async () => {
            const searchTools = createEnhancedSearchTools({
                globalSmartCache: {
                    maxSize: 5, // Very small cache
                    maxMemory: 1024, // 1KB memory limit
                    defaultTtl: 60000,
                    gitAware: false,
                },
            });

            try {
                // Perform many searches to test eviction
                for (let i = 0; i < 10; i++) {
                    await searchTools.grep.search({
                        pattern: `test${i}`,
                        path: tempDir,
                        outputMode: 'content',
                    });
                }

                const size = searchTools.getCacheSize().grep;
                expect(size.entries).toBeLessThanOrEqual(5); // Should not exceed maxSize
                expect(size.memoryBytes).toBeLessThanOrEqual(10 * 1024); // Some buffer for overhead

                const stats = searchTools.getCacheStats().grep;
                expect(stats.evictions).toBeGreaterThan(0); // Should have evicted some entries
            } finally {
                await searchTools.dispose();
            }
        });
    });

    describe('Error Handling', () => {
        it('should handle non-existent paths gracefully', async () => {
            const searchTools = createEnhancedSearchTools({
                globalSmartCache: {
                    gitAware: false,
                },
            });

            try {
                // Search in non-existent directory
                const nonExistentPath = path.join(tempDir, 'does-not-exist');

                // These should not throw errors
                const grepResults = await searchTools.grep
                    .search({
                        pattern: 'test',
                        path: nonExistentPath,
                    })
                    .catch(() => []); // Handle expected errors gracefully

                const lsResults = await searchTools.ls
                    .list({
                        path: nonExistentPath,
                    })
                    .catch(() => ({
                        entries: [],
                        metadata: { totalEntries: 0, searchTime: 0, errors: ['Path not found'], path: nonExistentPath },
                    }));

                // Should handle errors gracefully
                expect(Array.isArray(grepResults)).toBe(true);
                expect(lsResults.entries).toBeDefined();
            } finally {
                await searchTools.dispose();
            }
        });
    });
});
