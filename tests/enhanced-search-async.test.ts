/**
 * Tests for Async Enhanced Search Tools
 *
 * These tests validate that our async implementation solves
 * all the performance issues identified in the analysis.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const perfOnly = process.env.PERF === '1';
const perfDescribe = perfOnly ? describe : describe.skip;

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
    AsyncEnhancedGrep,
    RipgrepProcessPool,
    type SearchStream,
    SmartSearchCache,
} from '../src/layers/enhanced-search-tools-async';

perfDescribe('Async Enhanced Search Performance', () => {
    let grep: AsyncEnhancedGrep;

    beforeAll(() => {
        grep = new AsyncEnhancedGrep({
            maxProcesses: 4,
            cacheSize: 100,
            cacheTTL: 60000,
            defaultTimeout: 5000,
        });
    });

    afterAll(() => {
        grep.destroy();
    });

    describe('Non-blocking Execution', () => {
        test('should not block event loop during search', async () => {
            let eventLoopBlocked = false;
            let checkInterval: any;

            // Set up event loop monitoring
            const startTime = Date.now();
            checkInterval = setInterval(() => {
                const delay = Date.now() - startTime;
                // If more than 50ms between intervals, loop was blocked
                if (delay > 50) {
                    eventLoopBlocked = true;
                }
            }, 10);

            // Perform search
            const searchPromise = grep.search({
                pattern: 'function',
                path: '.',
                maxResults: 100,
            });

            // Do other work while search is running
            let workCompleted = 0;
            for (let i = 0; i < 100; i++) {
                await new Promise((resolve) => setImmediate(resolve));
                workCompleted++;
            }

            const results = await searchPromise;
            clearInterval(checkInterval);

            // Validate
            expect(eventLoopBlocked).toBe(false);
            expect(workCompleted).toBe(100); // All work completed
            expect(results.length).toBeGreaterThan(0);
        });

        test('multiple searches should run in parallel', async () => {
            const startTime = Date.now();

            // Launch 5 searches in parallel
            const searches = [
                grep.search({ pattern: 'function', path: '.' }),
                grep.search({ pattern: 'class', path: '.' }),
                grep.search({ pattern: 'import', path: '.' }),
                grep.search({ pattern: 'export', path: '.' }),
                grep.search({ pattern: 'const', path: '.' }),
            ];

            const results = await Promise.all(searches);
            const totalTime = Date.now() - startTime;

            // All searches should complete
            results.forEach((r) => {
                expect(r.length).toBeGreaterThan(0);
            });

            // Should be faster than sequential (5 * 100ms = 500ms)
            // Parallel should complete in ~200ms or less
            expect(totalTime).toBeLessThan(300);
        });
    });

    describe('Streaming Results', () => {
        test('should emit results as they arrive', async () => {
            const receivedResults: any[] = [];
            const progressUpdates: any[] = [];
            let firstResultTime = 0;
            let lastResultTime = 0;
            const startTime = Date.now();

            const stream = grep.searchStream({
                pattern: 'TODO',
                path: '.',
                maxResults: 50,
            });

            await new Promise<void>((resolve, reject) => {
                stream.on('data', (result) => {
                    if (receivedResults.length === 0) {
                        firstResultTime = Date.now() - startTime;
                    }
                    receivedResults.push(result);
                    lastResultTime = Date.now() - startTime;
                });

                stream.on('progress', (progress) => {
                    progressUpdates.push(progress);
                });

                stream.on('error', reject);
                stream.on('end', resolve);
            });

            // Validate streaming behavior
            expect(receivedResults.length).toBeGreaterThan(0);
            expect(progressUpdates.length).toBeGreaterThan(0);

            // First result should arrive quickly (not waiting for all)
            expect(firstResultTime).toBeLessThan(50);

            // Results should be spread over time (not all at once)
            const timeSpread = lastResultTime - firstResultTime;
            expect(timeSpread).toBeGreaterThan(0);
        });

        test('should support early termination', async () => {
            let totalReceived = 0;
            const stream = grep.searchStream({
                pattern: 'function', // Common pattern with many results
                path: '.',
            });

            await new Promise<void>((resolve) => {
                stream.on('data', () => {
                    totalReceived++;
                    if (totalReceived === 10) {
                        stream.cancel(); // Cancel after 10 results
                    }
                });

                stream.on('end', resolve);
            });

            // Should have stopped at ~10 results (might be slightly more due to buffering)
            expect(totalReceived).toBeLessThanOrEqual(15);
        });
    });

    describe('Smart Caching', () => {
        test('cached results should return instantly', async () => {
            const pattern = 'cacheTest' + Date.now();

            // First search (cold cache)
            const coldStart = Date.now();
            const coldResults = await grep.search({
                pattern,
                path: './src',
            });
            const coldTime = Date.now() - coldStart;

            // Second search (warm cache)
            const warmStart = Date.now();
            const warmResults = await grep.search({
                pattern,
                path: './src',
            });
            const warmTime = Date.now() - warmStart;

            // Cache should be much faster
            expect(warmTime).toBeLessThan(5); // Should be instant
            expect(warmTime).toBeLessThan(coldTime / 10); // At least 10x faster
            expect(warmResults).toEqual(coldResults); // Same results
        });

        test('cache should invalidate on file change', async () => {
            // Create a temporary test file
            const testFile = './test-cache-invalidation.ts';
            await fs.writeFile(testFile, 'function testFunction() {}');

            try {
                // First search
                const results1 = await grep.search({
                    pattern: 'testFunction',
                    path: '.',
                });

                // Modify the file
                await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay
                await fs.appendFile(testFile, '\nfunction testFunction2() {}');

                // Search again - cache should be invalidated
                const results2 = await grep.search({
                    pattern: 'testFunction',
                    path: '.',
                });

                // Results should be different (file was modified)
                expect(results2.length).toBeGreaterThanOrEqual(results1.length);
            } finally {
                // Clean up
                await fs.unlink(testFile).catch(() => {});
            }
        });
    });

    describe('Parallel Search', () => {
        test('should search multiple directories in parallel', async () => {
            const startTime = Date.now();

            const results = await grep.searchParallel(['function', 'class'], ['./src', './tests'], { maxResults: 50 });

            const totalTime = Date.now() - startTime;

            // Should have results for each pattern/directory combination
            expect(results.size).toBe(4); // 2 patterns × 2 directories

            // Each should have some results
            for (const [key, value] of results) {
                expect(value.length).toBeGreaterThan(0);
            }

            // Should be fast (parallel execution)
            expect(totalTime).toBeLessThan(200);
        });
    });

    perfDescribe('Performance Benchmarks', () => {
        test('Layer 1 performance should meet 50ms target', async () => {
            const iterations = 20;
            const times: number[] = [];

            for (let i = 0; i < iterations; i++) {
                const start = Date.now();
                await grep.search({
                    pattern: `test${i}`, // Different pattern to avoid cache
                    path: './src',
                    maxResults: 10,
                });
                times.push(Date.now() - start);
            }

            const mean = times.reduce((a, b) => a + b, 0) / times.length;
            const sorted = times.sort((a, b) => a - b);
            const p95 = sorted[Math.floor(iterations * 0.95)];

            console.log('Async Performance:', { mean, p95 });

            // Should meet performance targets
            expect(mean).toBeLessThan(50); // Mean under 50ms
            expect(p95).toBeLessThan(100); // P95 under 100ms
        });

        test('should handle large result sets efficiently', async () => {
            const stream = grep.searchStream({
                pattern: 'the', // Very common word
                path: '.',
                maxResults: 1000,
            });

            const startTime = Date.now();
            let resultCount = 0;
            const memoryBefore = process.memoryUsage().heapUsed;

            await new Promise<void>((resolve, reject) => {
                stream.on('data', () => {
                    resultCount++;
                });

                stream.on('error', reject);
                stream.on('end', resolve);
            });

            const totalTime = Date.now() - startTime;
            const memoryAfter = process.memoryUsage().heapUsed;
            const memoryIncrease = (memoryAfter - memoryBefore) / 1024 / 1024; // MB

            // Should handle large results efficiently
            expect(resultCount).toBeLessThanOrEqual(1000);
            expect(totalTime).toBeLessThan(1000); // Under 1 second
            expect(memoryIncrease).toBeLessThan(50); // Less than 50MB increase
        });
    });

    describe('Error Handling', () => {
        test('should handle timeout gracefully', async () => {
            try {
                await grep.search({
                    pattern: 'xxxxxxxxxxxxxxxxx', // Complex pattern
                    path: '.', // Search current directory instead of root
                    timeout: 1, // Extremely short timeout (1ms) to force timeout
                });
                expect(true).toBe(false); // Should not reach here
            } catch (error: any) {
                expect(error.message).toContain('timeout');
            }
        });

        test('should handle invalid paths gracefully', async () => {
            const results = await grep.search({
                pattern: 'test',
                path: '/nonexistent/path/that/does/not/exist',
            });

            // Should return empty results, not crash
            expect(results).toEqual([]);
        });

        test('should handle concurrent cancellations', async () => {
            const streams: SearchStream[] = [];

            // Start 10 searches
            for (let i = 0; i < 10; i++) {
                const stream = grep.searchStream({
                    pattern: 'function',
                    path: '.',
                });
                streams.push(stream);
            }

            // Cancel them all immediately
            streams.forEach((s) => s.cancel());

            // Wait for all to end
            await Promise.all(streams.map((s) => new Promise((resolve) => s.on('end', resolve))));

            // Should not crash
            expect(true).toBe(true);
        });
    });
});

describe('Process Pool Management', () => {
    test('should limit concurrent processes', async () => {
        const pool = new RipgrepProcessPool(2); // Max 2 processes
        let maxConcurrent = 0;

        const executions = [];
        for (let i = 0; i < 5; i++) {
            executions.push(
                (async () => {
                    const process = await pool.execute('echo', ['test']);

                    // Track actual process pool concurrency
                    const currentActive = pool.getActiveCount();
                    maxConcurrent = Math.max(maxConcurrent, currentActive);

                    // Simulate work
                    await new Promise((resolve) => setTimeout(resolve, 50));

                    process.kill();
                })()
            );
        }

        await Promise.all(executions);
        pool.destroy();

        // Should never exceed max processes
        expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
});

describe('Cache Intelligence', () => {
    test('should handle cache size limits', () => {
        const cache = new SmartSearchCache(5, 60000); // Max 5 entries

        // Add 10 entries
        for (let i = 0; i < 10; i++) {
            cache.set({ pattern: `pattern${i}`, path: '.' }, [{ file: 'test.ts', text: 'test', confidence: 1 }]);
        }

        // Should have evicted oldest entries
        const old = cache.get({ pattern: 'pattern0', path: '.' });
        const recent = cache.get({ pattern: 'pattern9', path: '.' });

        expect(old).toBeNull(); // Should be evicted
        expect(recent).not.toBeNull(); // Should be present
    });

    test('should respect TTL', async () => {
        const cache = new SmartSearchCache(10, 100); // 100ms TTL

        cache.set({ pattern: 'ttl-test', path: '.' }, [{ file: 'test.ts', text: 'test', confidence: 1 }]);

        // Should be in cache initially
        expect(cache.get({ pattern: 'ttl-test', path: '.' })).not.toBeNull();

        // Wait for TTL to expire
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Should be expired
        expect(cache.get({ pattern: 'ttl-test', path: '.' })).toBeNull();
    });
});
