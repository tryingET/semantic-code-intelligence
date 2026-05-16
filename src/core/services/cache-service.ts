/**
 * CacheService - Unified caching layer supporting memory and Redis/Valkey
 * Provides high-performance caching for all layers with LRU eviction
 */

import { type CacheConfig, type CacheEntry, type CacheKey, CoreError, type EventBus } from '../types.js';

/**
 * Memory cache implementation with LRU eviction
 */
class MemoryCache {
    private cache = new Map<CacheKey, CacheEntry<any>>();
    private accessOrder = new Map<CacheKey, number>();
    private accessCounter = 0;
    private maxSize: number;
    private defaultTtl: number;

    constructor(maxSize: number, defaultTtl: number) {
        this.maxSize = maxSize;
        this.defaultTtl = defaultTtl;
    }

    get<T>(key: CacheKey): T | null {
        const entry = this.cache.get(key);
        if (!entry) {
            return null;
        }

        // Check TTL
        const now = Date.now();
        if (now - entry.timestamp > entry.ttl * 1000) {
            this.cache.delete(key);
            this.accessOrder.delete(key);
            return null;
        }

        // Update access order for LRU
        this.accessOrder.set(key, ++this.accessCounter);
        entry.hits++;

        return entry.data;
    }

    set<T>(key: CacheKey, data: T, ttl?: number): void {
        const now = Date.now();
        const entryTtl = ttl || this.defaultTtl;

        // Calculate approximate size (rough estimation)
        const size = this.estimateSize(data);

        const entry: CacheEntry<T> = {
            data,
            timestamp: now,
            ttl: entryTtl,
            hits: 0,
            size,
        };

        // Evict if necessary before adding
        this.evictIfNecessary();

        this.cache.set(key, entry);
        this.accessOrder.set(key, ++this.accessCounter);
    }

    delete(key: CacheKey): boolean {
        const deleted = this.cache.delete(key);
        this.accessOrder.delete(key);
        return deleted;
    }

    clear(): void {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;
    }

    size(): number {
        return this.cache.size;
    }

    getStats(): {
        size: number;
        totalHits: number;
        avgHits: number;
        oldestEntry: number;
        newestEntry: number;
    } {
        const entries = Array.from(this.cache.values());
        const totalHits = entries.reduce((sum, e) => sum + e.hits, 0);
        const timestamps = entries.map((e) => e.timestamp);

        return {
            size: this.cache.size,
            totalHits,
            avgHits: entries.length > 0 ? totalHits / entries.length : 0,
            oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : 0,
            newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : 0,
        };
    }

    private evictIfNecessary(): void {
        if (this.cache.size < this.maxSize) {
            return;
        }

        // Find LRU entry
        let lruKey: CacheKey | null = null;
        let lruAccess = Infinity;

        for (const [key, access] of this.accessOrder.entries()) {
            if (access < lruAccess) {
                lruAccess = access;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
            this.accessOrder.delete(lruKey);
        }
    }

    private estimateSize(data: any): number {
        // Rough size estimation
        if (typeof data === 'string') {
            return data.length * 2; // UTF-16
        }
        if (typeof data === 'object') {
            return JSON.stringify(data).length * 2;
        }
        return 8; // Default for primitives
    }
}

/**
 * Redis/Valkey cache implementation (future enhancement)
 */
class RedisCache {
    private connected = false;

    async get<T>(key: CacheKey): Promise<T | null> {
        // TODO: Implement Redis connection
        throw new CoreError('Redis cache not implemented yet', 'NOT_IMPLEMENTED');
    }

    async set<T>(key: CacheKey, data: T, ttl?: number): Promise<void> {
        // TODO: Implement Redis connection
        throw new CoreError('Redis cache not implemented yet', 'NOT_IMPLEMENTED');
    }

    async delete(key: CacheKey): Promise<boolean> {
        throw new CoreError('Redis cache not implemented yet', 'NOT_IMPLEMENTED');
    }

    async clear(): Promise<void> {
        throw new CoreError('Redis cache not implemented yet', 'NOT_IMPLEMENTED');
    }
}

/**
 * Unified cache service that manages memory and distributed caching
 */
export class CacheService {
    private memoryCache: MemoryCache;
    private redisCache?: RedisCache;
    private config: CacheConfig;
    private eventBus: EventBus;
    private hitCount = 0;
    private missCount = 0;
    private initialized = false;
    private memoryWarningThreshold = 0.8; // 80% of max memory
    private lastMemoryCheck = 0;
    private memoryCheckInterval = 30000; // 30 seconds

    constructor(config: CacheConfig, eventBus: EventBus) {
        // Normalize potentially partial configs passed by tests or older callers
        const normalized: CacheConfig = {
            enabled: (config as any)?.enabled ?? true,
            strategy: (config as any)?.strategy ?? 'memory',
            memory: {
                maxSize: (config as any)?.memory?.maxSize ?? 100 * 1024 * 1024, // 100MB default
                ttl: (config as any)?.memory?.ttl ?? 300, // 5 minutes
            },
            redis: (config as any)?.redis,
        };

        this.config = normalized;
        this.eventBus = eventBus;

        this.memoryCache = new MemoryCache(
            Math.floor(normalized.memory.maxSize / 1024), // Convert bytes to approximate entries
            normalized.memory.ttl
        );

        if (normalized.strategy === 'redis' || normalized.strategy === 'hybrid') {
            if (normalized.redis) {
                this.redisCache = new RedisCache();
            } else {
                console.warn('Redis cache requested but no Redis configuration provided');
            }
        }
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            // Initialize Redis if configured
            if (this.redisCache && this.config.redis) {
                // TODO: Initialize Redis connection
                console.log('Redis cache will be implemented in future version');
            }

            this.initialized = true;

            this.eventBus.emit('cache-service:initialized', {
                strategy: this.config.strategy,
                memoryMaxSize: this.config.memory.maxSize,
                redisConfigured: !!this.config.redis,
                timestamp: Date.now(),
            });
        } catch (error) {
            this.eventBus.emit('cache-service:error', {
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    async dispose(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        this.memoryCache.clear();

        if (this.redisCache) {
            await this.redisCache.clear().catch((error) => {
                console.error('Error clearing Redis cache:', error);
            });
        }

        this.initialized = false;

        this.eventBus.emit('cache-service:disposed', {
            finalStats: this.getStats(),
            timestamp: Date.now(),
        });
    }

    async get<T>(key: CacheKey): Promise<T | null> {
        if (!this.initialized) {
            return null;
        }

        try {
            // Try memory cache first (fastest)
            const memoryResult = this.memoryCache.get<T>(key);
            if (memoryResult !== null) {
                this.hitCount++;
                this.eventBus.emit('cache-service:hit', {
                    key,
                    source: 'memory',
                    timestamp: Date.now(),
                });
                return memoryResult;
            }

            // Try Redis cache if available and configured
            if (this.redisCache && this.config.strategy !== 'memory') {
                try {
                    const redisResult = await this.redisCache.get<T>(key);
                    if (redisResult !== null) {
                        // Cache in memory for faster future access
                        this.memoryCache.set(key, redisResult, this.config.redis?.ttl);
                        this.hitCount++;
                        this.eventBus.emit('cache-service:hit', {
                            key,
                            source: 'redis',
                            timestamp: Date.now(),
                        });
                        return redisResult;
                    }
                } catch (error) {
                    console.warn('Redis cache error:', error);
                    // Continue to miss count
                }
            }

            this.missCount++;
            this.eventBus.emit('cache-service:miss', {
                key,
                timestamp: Date.now(),
            });
            return null;
        } catch (error) {
            this.eventBus.emit('cache-service:error', {
                operation: 'get',
                key,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            return null;
        }
    }

    async set<T>(key: CacheKey, data: T, ttl?: number): Promise<void> {
        if (!this.initialized) {
            return;
        }

        try {
            // Check memory usage before setting
            this.checkMemoryUsage();

            // Always cache in memory
            this.memoryCache.set(key, data, ttl);

            // Also cache in Redis if available and configured
            if (this.redisCache && this.config.strategy !== 'memory') {
                try {
                    await this.redisCache.set(key, data, ttl || this.config.redis?.ttl);
                } catch (error) {
                    console.warn('Redis cache set error:', error);
                    // Memory cache still works
                }
            }

            this.eventBus.emit('cache-service:set', {
                key,
                ttl: ttl || this.config.memory.ttl,
                timestamp: Date.now(),
            });
        } catch (error) {
            this.eventBus.emit('cache-service:error', {
                operation: 'set',
                key,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    async delete(key: CacheKey): Promise<boolean> {
        if (!this.initialized) {
            return false;
        }

        try {
            let deleted = false;

            // Delete from memory
            if (this.memoryCache.delete(key)) {
                deleted = true;
            }

            // Delete from Redis if available
            if (this.redisCache && this.config.strategy !== 'memory') {
                try {
                    if (await this.redisCache.delete(key)) {
                        deleted = true;
                    }
                } catch (error) {
                    console.warn('Redis cache delete error:', error);
                }
            }

            if (deleted) {
                this.eventBus.emit('cache-service:delete', {
                    key,
                    timestamp: Date.now(),
                });
            }

            return deleted;
        } catch (error) {
            this.eventBus.emit('cache-service:error', {
                operation: 'delete',
                key,
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            return false;
        }
    }

    async clear(): Promise<void> {
        if (!this.initialized) {
            return;
        }

        try {
            this.memoryCache.clear();

            if (this.redisCache && this.config.strategy !== 'memory') {
                try {
                    await this.redisCache.clear();
                } catch (error) {
                    console.warn('Redis cache clear error:', error);
                }
            }

            this.hitCount = 0;
            this.missCount = 0;

            this.eventBus.emit('cache-service:clear', {
                timestamp: Date.now(),
            });
        } catch (error) {
            this.eventBus.emit('cache-service:error', {
                operation: 'clear',
                error: error instanceof Error ? error.message : String(error),
                timestamp: Date.now(),
            });
            throw error;
        }
    }

    getStats(): {
        hitCount: number;
        missCount: number;
        hitRate: number;
        memoryStats: any;
        redisConnected: boolean;
        strategy: string;
        currentMemoryUsage: number;
        memoryThreshold: number;
        memoryUtilization: number;
    } {
        const totalRequests = this.hitCount + this.missCount;
        const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;
        const currentMemory = this.getCurrentMemoryUsage();
        const maxMemory = this.config.memory.maxSize;

        return {
            hitCount: this.hitCount,
            missCount: this.missCount,
            hitRate,
            memoryStats: this.memoryCache.getStats(),
            redisConnected: !!this.redisCache,
            strategy: this.config.strategy,
            currentMemoryUsage: currentMemory,
            memoryThreshold: maxMemory * this.memoryWarningThreshold,
            memoryUtilization: maxMemory > 0 ? currentMemory / maxMemory : 0,
        };
    }

    isHealthy(): boolean {
        if (!this.initialized) {
            return false;
        }

        // Memory cache should always be available
        if (this.memoryCache.size() >= 0) {
            // Check hit rate - should be reasonable
            const stats = this.getStats();
            if (stats.hitRate < 0.1 && stats.hitCount + stats.missCount > 100) {
                // Very low hit rate with significant traffic might indicate issues
                return false;
            }
            return true;
        }

        return false;
    }

    getDiagnostics(): Record<string, any> {
        return {
            initialized: this.initialized,
            config: this.config,
            stats: this.getStats(),
            healthy: this.isHealthy(),
            timestamp: Date.now(),
        };
    }

    /**
     * Get current memory usage in bytes
     */
    private getCurrentMemoryUsage(): number {
        let totalSize = 0;

        // Calculate size from memory cache
        for (const entry of this.memoryCache['cache'].values()) {
            totalSize += entry.size || 0;
        }

        return totalSize;
    }

    /**
     * Check memory usage and emit warnings if necessary
     */
    private checkMemoryUsage(): void {
        const now = Date.now();

        // Only check memory usage periodically
        if (now - this.lastMemoryCheck < this.memoryCheckInterval) {
            return;
        }

        this.lastMemoryCheck = now;
        const currentMemory = this.getCurrentMemoryUsage();
        const maxMemory = this.config.memory.maxSize;
        const utilization = maxMemory > 0 ? currentMemory / maxMemory : 0;

        if (utilization >= this.memoryWarningThreshold) {
            this.eventBus.emit('cache-service:memory-warning', {
                currentUsage: currentMemory,
                maxMemory,
                utilization,
                threshold: this.memoryWarningThreshold,
                timestamp: now,
            });

            // Trigger more aggressive eviction if we're at 90%+
            if (utilization >= 0.9) {
                this.eventBus.emit('cache-service:memory-critical', {
                    currentUsage: currentMemory,
                    maxMemory,
                    utilization,
                    timestamp: now,
                });

                // Force eviction of 25% of entries
                this.forceEviction(0.25);
            }
        }
    }

    /**
     * Force eviction of a percentage of cache entries
     */
    private forceEviction(percentage: number): void {
        const currentSize = this.memoryCache.size();
        const toEvict = Math.floor(currentSize * percentage);

        if (toEvict > 0) {
            // Access the private cache and accessOrder maps
            const cache = this.memoryCache['cache'];
            const accessOrder = this.memoryCache['accessOrder'];

            // Get LRU entries
            const accessEntries = Array.from(accessOrder.entries()).sort((a, b) => a[1] - b[1]); // Sort by access order (oldest first)

            let evicted = 0;
            for (const [key] of accessEntries) {
                if (evicted >= toEvict) break;

                cache.delete(key);
                accessOrder.delete(key);
                evicted++;
            }

            this.eventBus.emit('cache-service:forced-eviction', {
                entriesEvicted: evicted,
                reason: 'memory-pressure',
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Optimize cache configuration based on current usage patterns
     */
    optimizeConfiguration(): void {
        const stats = this.getStats();

        // If hit rate is very low, consider reducing cache size
        if (stats.hitRate < 0.1 && stats.hitCount + stats.missCount > 100) {
            this.eventBus.emit('cache-service:optimization-suggestion', {
                type: 'reduce-size',
                reason: 'low-hit-rate',
                currentHitRate: stats.hitRate,
                suggestion: 'Consider reducing cache size due to low hit rate',
                timestamp: Date.now(),
            });
        }

        // If memory utilization is consistently low, suggest reducing max size
        if (stats.memoryUtilization < 0.3) {
            this.eventBus.emit('cache-service:optimization-suggestion', {
                type: 'reduce-memory-allocation',
                reason: 'low-utilization',
                currentUtilization: stats.memoryUtilization,
                suggestion: 'Consider reducing memory allocation due to low utilization',
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Warm cache with frequently accessed data
     */
    async warmCache(warmingData: Array<{ key: CacheKey; data: any; ttl?: number }>): Promise<void> {
        if (!this.initialized) {
            return;
        }

        let warmed = 0;
        const startTime = Date.now();

        for (const { key, data, ttl } of warmingData) {
            try {
                await this.set(key, data, ttl);
                warmed++;
            } catch (error) {
                console.warn(`Cache warming failed for key ${key}:`, error);
            }
        }

        this.eventBus.emit('cache-service:warmed', {
            entriesWarmed: warmed,
            totalRequested: warmingData.length,
            duration: Date.now() - startTime,
            timestamp: Date.now(),
        });
    }

    /**
     * Pre-warm cache with common query patterns
     */
    async prewarmCommonPatterns(commonIdentifiers: string[]): Promise<void> {
        if (!this.initialized) {
            return;
        }

        const warmingData = commonIdentifiers.map((identifier) => ({
            key: `prewarmed:${identifier}` as CacheKey,
            data: {
                identifier,
                prewarmed: true,
                timestamp: Date.now(),
            },
            ttl: this.config.memory.ttl * 2, // Longer TTL for prewarmed data
        }));

        await this.warmCache(warmingData);
    }

    /**
     * Check if a key exists in cache (without affecting LRU order)
     */
    async has(key: CacheKey): Promise<boolean> {
        if (!this.initialized) {
            return false;
        }

        try {
            const entry = this.memoryCache['cache'].get(key);
            if (!entry) {
                return false;
            }

            // Check TTL without updating access order
            const now = Date.now();
            if (now - entry.timestamp > entry.ttl * 1000) {
                // Entry is expired, remove it
                this.memoryCache.delete(key);
                return false;
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get cache keys matching a pattern (for cache management)
     */
    getKeysMatching(pattern: RegExp): CacheKey[] {
        if (!this.initialized) {
            return [];
        }

        const keys: CacheKey[] = [];
        const cache = this.memoryCache['cache'];

        for (const key of cache.keys()) {
            if (pattern.test(key)) {
                keys.push(key);
            }
        }

        return keys;
    }

    /**
     * Invalidate cache entries matching a pattern
     */
    async invalidatePattern(pattern: RegExp): Promise<number> {
        if (!this.initialized) {
            return 0;
        }

        const keysToDelete = this.getKeysMatching(pattern);
        let deleted = 0;

        for (const key of keysToDelete) {
            if (await this.delete(key)) {
                deleted++;
            }
        }

        if (deleted > 0) {
            this.eventBus.emit('cache-service:pattern-invalidated', {
                pattern: pattern.source,
                keysDeleted: deleted,
                timestamp: Date.now(),
            });
        }

        return deleted;
    }
}
