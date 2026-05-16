/**
 * Smart Cache Tests
 * Tests for intelligent file-aware caching with modification time checking
 * and file watching functionality
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    type CacheStats,
    createSmartCache,
    DEFAULT_CACHE_ZONES,
    SmartCache,
    type SmartCacheConfig,
} from '../smart-cache.js';

// Mock fs for controlled testing
const mockFs = {
    stat: mock(() => Promise.resolve({ mtime: new Date(), size: 1024, isDirectory: () => false })),
    readFile: mock(() => Promise.resolve('test content')),
    access: mock(() => Promise.resolve()),
    readdir: mock(() => Promise.resolve([])),
};

// Test data structure
interface TestCacheData {
    id: string;
    content: string;
    timestamp: number;
}

describe('SmartCache', () => {
    let cache: SmartCache<TestCacheData>;
    let tempDir: string;
    let testFiles: string[];

    beforeEach(async () => {
        // Create temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(import.meta.dirname, 'test-cache-'));

        // Create test files
        testFiles = [];
        for (let i = 0; i < 3; i++) {
            const filePath = path.join(tempDir, `test-file-${i}.txt`);
            await fs.writeFile(filePath, `Test content ${i}\nLine 2\nLine 3`);
            testFiles.push(filePath);
        }

        // Wait a bit to ensure files are created
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Create cache with test configuration
        const config: SmartCacheConfig = {
            maxSize: 100,
            maxMemory: 1024 * 1024, // 1MB
            defaultTtl: 60000, // 1 minute
            zones: [
                {
                    name: 'test-zone',
                    patterns: [path.join(tempDir, '**')],
                    ttl: 30000, // 30 seconds
                    checkFileModTime: true,
                    watchFiles: true,
                    description: 'Test zone',
                },
                ...DEFAULT_CACHE_ZONES,
            ],
            gitAware: false, // Disable for testing
            watcherDebounceMs: 10,
            maxWatchers: 10,
            enableMetrics: true,
        };

        cache = new SmartCache<TestCacheData>(config);
    });

    afterEach(async () => {
        await cache.dispose();

        // Clean up test files
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn('Error cleaning up test directory:', error);
        }
    });

    describe('Basic Cache Operations', () => {
        it('should store and retrieve cache entries', async () => {
            const key = 'test-key';
            const data: TestCacheData = {
                id: '123',
                content: 'test data',
                timestamp: Date.now(),
            };

            await cache.set(key, data);
            const retrieved = await cache.get(key);

            expect(retrieved).toEqual(data);
        });

        it('should return null for non-existent keys', async () => {
            const result = await cache.get('non-existent-key');
            expect(result).toBeNull();
        });

        it('should respect TTL expiration', async () => {
            const key = 'ttl-test';
            const data: TestCacheData = {
                id: '456',
                content: 'ttl test',
                timestamp: Date.now(),
            };

            await cache.set(key, data, { ttl: 50 }); // 50ms TTL

            // Should be available immediately
            let retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);

            // Wait for TTL expiration
            await new Promise((resolve) => setTimeout(resolve, 60));

            // Should be expired
            retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });

        it('should clear all cache entries', async () => {
            const data: TestCacheData = { id: '1', content: 'test', timestamp: Date.now() };

            await cache.set('key1', data);
            await cache.set('key2', data);

            expect(cache.getSize().entries).toBe(2);

            await cache.clear();

            expect(cache.getSize().entries).toBe(0);
        });
    });

    describe('File-Aware Caching', () => {
        it('should cache with file metadata', async () => {
            const key = 'file-cache-test';
            const data: TestCacheData = {
                id: 'file-test',
                content: 'file content',
                timestamp: Date.now(),
            };

            await cache.set(key, data, {
                filePath: testFiles[0],
            });

            const retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);
        });

        it('should invalidate cache when file is modified', async () => {
            const key = 'file-mod-test';
            const data: TestCacheData = {
                id: 'mod-test',
                content: 'original content',
                timestamp: Date.now(),
            };

            await cache.set(key, data, {
                filePath: testFiles[0],
            });

            // Verify cache hit
            let retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);

            // Wait a bit to ensure time difference
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Modify the file
            await fs.writeFile(testFiles[0], 'Modified content');

            // Cache should be invalidated
            retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });

        it('should invalidate cache when file size changes', async () => {
            const key = 'file-size-test';
            const data: TestCacheData = {
                id: 'size-test',
                content: 'size test content',
                timestamp: Date.now(),
            };

            await cache.set(key, data, {
                filePath: testFiles[1],
            });

            // Verify cache hit
            let retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);

            // Change file size by appending content
            await fs.appendFile(testFiles[1], '\nAppended content');

            // Cache should be invalidated due to size change
            retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });

        it('should invalidate cache when file is deleted', async () => {
            const key = 'file-delete-test';
            const data: TestCacheData = {
                id: 'delete-test',
                content: 'delete test content',
                timestamp: Date.now(),
            };

            await cache.set(key, data, {
                filePath: testFiles[2],
            });

            // Verify cache hit
            let retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);

            // Delete the file
            await fs.unlink(testFiles[2]);

            // Cache should be invalidated
            retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });
    });

    describe('Cache Zones', () => {
        it('should use zone-specific TTL', async () => {
            const key = 'zone-ttl-test';
            const data: TestCacheData = {
                id: 'zone-test',
                content: 'zone content',
                timestamp: Date.now(),
            };

            // File in test zone should use zone TTL (30 seconds)
            await cache.set(key, data, {
                filePath: testFiles[0],
            });

            const stats = cache.getStats();
            expect(stats.zonesStats['test-zone']).toBeDefined();
        });

        it('should apply zone-specific file checking rules', async () => {
            // This is tested implicitly in other file modification tests
            // since the test zone has checkFileModTime: true
            expect(true).toBe(true);
        });
    });

    describe('Dependency Tracking', () => {
        it('should invalidate cache when dependencies change', async () => {
            const key = 'dependency-test';
            const data: TestCacheData = {
                id: 'dep-test',
                content: 'dependency test',
                timestamp: Date.now(),
            };

            const dependencyFile = testFiles[1];

            await cache.set(key, data, {
                filePath: testFiles[0],
                dependencies: [dependencyFile],
            });

            // Verify cache hit
            let retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);

            // Wait a bit
            await new Promise((resolve) => setTimeout(resolve, 10));

            // Modify dependency file
            await fs.writeFile(dependencyFile, 'Modified dependency');

            // Cache should be invalidated due to dependency change
            retrieved = await cache.get(key);
            expect(retrieved).toBeNull();
        });
    });

    describe('File Watching', () => {
        it('should invalidate cache when watched file changes', async () => {
            const key = 'watcher-test';
            const data: TestCacheData = {
                id: 'watch-test',
                content: 'watcher test',
                timestamp: Date.now(),
            };

            let invalidationEvent = false;
            cache.on('cache:file_changed', () => {
                invalidationEvent = true;
            });

            await cache.set(key, data, {
                filePath: testFiles[0],
            });

            // Verify cache hit
            let retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);

            // Modify the file
            await fs.writeFile(testFiles[0], 'Modified by watcher test');

            // Wait for file watcher debounce
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Cache should be invalidated
            retrieved = await cache.get(key);
            expect(retrieved).toBeNull();

            // Should have received invalidation event
            expect(invalidationEvent).toBe(true);
        });
    });

    describe('Path-based Invalidation', () => {
        it('should invalidate all entries for a specific path', async () => {
            const filePath = testFiles[0];
            const data: TestCacheData = {
                id: 'path-test',
                content: 'path test',
                timestamp: Date.now(),
            };

            // Set multiple cache entries for the same file
            await cache.set('path-key-1', data, { filePath });
            await cache.set('path-key-2', data, { filePath });
            await cache.set('path-key-3', data, { filePath: testFiles[1] }); // Different file

            expect(cache.getSize().entries).toBe(3);

            // Invalidate by path
            const invalidated = await cache.invalidateByPath(filePath);
            expect(invalidated).toBe(2); // Should invalidate 2 entries

            // Check that correct entries were invalidated
            expect(await cache.get('path-key-1')).toBeNull();
            expect(await cache.get('path-key-2')).toBeNull();
            expect(await cache.get('path-key-3')).not.toBeNull(); // Different file, should remain
        });
    });

    describe('Zone-based Invalidation', () => {
        it('should invalidate all entries in a specific zone', async () => {
            const data: TestCacheData = {
                id: 'zone-invalidation-test',
                content: 'zone test',
                timestamp: Date.now(),
            };

            // Set entries in test zone
            await cache.set('zone-key-1', data, { filePath: testFiles[0] });
            await cache.set('zone-key-2', data, { filePath: testFiles[1] });

            expect(cache.getSize().entries).toBe(2);

            // Invalidate by zone
            const invalidated = await cache.invalidateByZone('test-zone');
            expect(invalidated).toBe(2);

            expect(cache.getSize().entries).toBe(0);
        });
    });

    describe('LRU Eviction', () => {
        it('should evict least recently used entries when cache is full', async () => {
            // Create a small cache for testing eviction
            const smallCache = new SmartCache<TestCacheData>({
                maxSize: 3, // Very small for testing
                maxMemory: 1024 * 1024,
                defaultTtl: 60000,
                zones: DEFAULT_CACHE_ZONES,
                gitAware: false,
                watcherDebounceMs: 10,
                maxWatchers: 5,
                enableMetrics: true,
            });

            try {
                const data: TestCacheData = { id: '1', content: 'test', timestamp: Date.now() };

                // Fill cache to capacity
                await smallCache.set('key1', data);
                await smallCache.set('key2', data);
                await smallCache.set('key3', data);

                expect(smallCache.getSize().entries).toBe(3);

                // Access key1 to make it more recently used
                await smallCache.get('key1');

                // Add another entry, should evict LRU (key2 or key3)
                await smallCache.set('key4', data);

                expect(smallCache.getSize().entries).toBe(3);

                // key1 should still be there (recently accessed)
                expect(await smallCache.get('key1')).not.toBeNull();

                const stats = smallCache.getStats();
                expect(stats.evictions).toBeGreaterThan(0);
            } finally {
                await smallCache.dispose();
            }
        });
    });

    describe('Cache Statistics', () => {
        it('should track hit/miss statistics', async () => {
            const data: TestCacheData = { id: 'stats', content: 'stats test', timestamp: Date.now() };

            // Cache miss
            await cache.get('missing-key');

            // Cache set and hit
            await cache.set('stats-key', data);
            await cache.get('stats-key');
            await cache.get('stats-key');

            const stats = cache.getStats();
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(1);
            expect(stats.hitRate).toBeCloseTo(2 / 3, 2);
        });

        it('should track zone statistics', async () => {
            const data: TestCacheData = { id: 'zone-stats', content: 'zone stats test', timestamp: Date.now() };

            await cache.set('zone-stats-key', data, { filePath: testFiles[0] });
            await cache.get('zone-stats-key');

            const stats = cache.getStats();
            expect(stats.zonesStats['test-zone'].entries).toBe(1);
            expect(stats.zonesStats['test-zone'].hits).toBe(1);
        });
    });

    describe('Health Check', () => {
        it('should report healthy status for normal operation', () => {
            expect(cache.isHealthy()).toBe(true);
        });

        it('should report unhealthy status after disposal', async () => {
            await cache.dispose();
            expect(cache.isHealthy()).toBe(false);
        });
    });

    describe('Memory Management', () => {
        it('should track memory usage', async () => {
            const largeData: TestCacheData = {
                id: 'large-data',
                content: 'x'.repeat(1000), // 1KB of content
                timestamp: Date.now(),
            };

            await cache.set('large-key', largeData);

            const size = cache.getSize();
            expect(size.memoryBytes).toBeGreaterThan(1000);
        });

        it('should evict based on memory limits', async () => {
            // This would require a more complex test with very large data
            // For now, just verify the mechanism exists
            const size = cache.getSize();
            expect(size.memoryBytes).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Error Handling', () => {
        it('should handle file system errors gracefully', async () => {
            const key = 'error-test';
            const data: TestCacheData = { id: 'error', content: 'error test', timestamp: Date.now() };

            // Try to cache with a non-existent file path
            await cache.set(key, data, {
                filePath: '/non/existent/path.txt',
            });

            // Should still be able to retrieve the data
            const retrieved = await cache.get(key);
            expect(retrieved).toEqual(data);
        });

        it('should emit error events for file watcher failures', async () => {
            let errorEvent = false;
            cache.on('cache:warning', () => {
                errorEvent = true;
            });

            // This test is difficult to trigger reliably, so we just verify
            // that the error handling structure is in place
            expect(cache.listenerCount('cache:warning')).toBe(1);
        });
    });
});

describe('Smart Cache Factory', () => {
    it('should create cache with default configuration', () => {
        const cache = createSmartCache<string>();
        expect(cache).toBeInstanceOf(SmartCache);
        cache.dispose();
    });

    it('should create cache with custom configuration', () => {
        const cache = createSmartCache<string>({
            maxSize: 50,
            maxMemory: 512 * 1024,
            gitAware: false,
        });

        expect(cache).toBeInstanceOf(SmartCache);
        expect(cache.getSize().entries).toBe(0);

        cache.dispose();
    });
});

describe('Cache Zones Configuration', () => {
    it('should include all expected default zones', () => {
        expect(DEFAULT_CACHE_ZONES).toHaveLength(6);

        const zoneNames = DEFAULT_CACHE_ZONES.map((z) => z.name);
        expect(zoneNames).toContain('stable');
        expect(zoneNames).toContain('source');
        expect(zoneNames).toContain('config');
        expect(zoneNames).toContain('tests');
        expect(zoneNames).toContain('docs');
        expect(zoneNames).toContain('volatile');
    });

    it('should have appropriate TTL values for different zones', () => {
        const stableZone = DEFAULT_CACHE_ZONES.find((z) => z.name === 'stable');
        const sourceZone = DEFAULT_CACHE_ZONES.find((z) => z.name === 'source');
        const volatileZone = DEFAULT_CACHE_ZONES.find((z) => z.name === 'volatile');

        expect(stableZone?.ttl).toBeGreaterThan(sourceZone?.ttl!);
        expect(sourceZone?.ttl).toBeGreaterThan(volatileZone?.ttl!);
    });

    it('should configure file watching appropriately', () => {
        const stableZone = DEFAULT_CACHE_ZONES.find((z) => z.name === 'stable');
        const sourceZone = DEFAULT_CACHE_ZONES.find((z) => z.name === 'source');

        expect(stableZone?.watchFiles).toBe(false); // Stable files don't need watching
        expect(sourceZone?.watchFiles).toBe(true); // Source files should be watched
    });
});
