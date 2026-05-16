/**
 * Smart Cache - Intelligent file-aware caching with modification time checking
 * and file watching for Enhanced Tools
 *
 * Features:
 * - File modification time validation
 * - File watchers for real-time invalidation
 * - Different cache zones with configurable TTLs
 * - Git operation detection
 * - Smart cache key generation including file metadata
 */

import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import type * as fsSync from 'fs';
import { watch } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

// Cache zone configuration
export interface CacheZone {
    name: string;
    patterns: string[]; // Glob patterns for paths
    ttl: number; // TTL in milliseconds
    checkFileModTime: boolean; // Whether to check file modification times
    watchFiles: boolean; // Whether to watch files in this zone
    description: string;
}

// Cache entry with file metadata
export interface SmartCacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    hits: number;
    size: number;
    hash: string;
    // File-specific metadata
    filePath?: string;
    fileModTime?: number;
    fileSize?: number;
    fileHash?: string;
    dependencies?: string[]; // Other files this cache entry depends on
}

// Cache configuration
export interface SmartCacheConfig {
    maxSize: number;
    maxMemory: number; // bytes
    defaultTtl: number; // milliseconds
    zones: CacheZone[];
    gitAware: boolean; // Invalidate on git operations
    watcherDebounceMs: number; // File watcher debounce time
    maxWatchers: number; // Limit on number of file watchers
    enableMetrics: boolean;
}

// Cache statistics
export interface CacheStats {
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    fileInvalidations: number;
    watcherEvents: number;
    zonesStats: Record<
        string,
        {
            entries: number;
            hits: number;
            avgTtl: number;
        }
    >;
}

// File watcher management
interface FileWatcher {
    path: string;
    watcher: fsSync.FSWatcher;
    zone: string;
    lastEvent: number;
    eventCount: number;
}

/**
 * Smart Cache implementation with file awareness and zone-based TTLs
 */
export class SmartCache<T> extends EventEmitter {
    private cache = new Map<string, SmartCacheEntry<T>>();
    private accessOrder = new Map<string, number>();
    private fileWatchers = new Map<string, FileWatcher>();
    private gitWatcher?: fsSync.FSWatcher;

    private stats: CacheStats = {
        hits: 0,
        misses: 0,
        hitRate: 0,
        evictions: 0,
        fileInvalidations: 0,
        watcherEvents: 0,
        zonesStats: {},
    };

    private accessCounter = 0;
    private disposed = false;
    private cleanupTimer?: NodeJS.Timeout;

    constructor(private config: SmartCacheConfig) {
        super();

        // Initialize zone stats
        for (const zone of config.zones) {
            this.stats.zonesStats[zone.name] = {
                entries: 0,
                hits: 0,
                avgTtl: zone.ttl,
            };
        }

        // Setup git monitoring if enabled
        if (config.gitAware) {
            this.setupGitWatcher();
        }

        // Periodic cleanup
        this.cleanupTimer = setInterval(() => void this.cleanup(), 60000); // Every minute
        this.cleanupTimer?.unref?.();
    }

    /**
     * Get cache entry with file validation
     */
    async get(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        if (!entry) {
            this.stats.misses++;
            this.updateHitRate();
            return null;
        }

        try {
            // Check TTL
            const now = Date.now();
            if (now - entry.timestamp > entry.ttl) {
                await this.invalidate(key, 'ttl_expired');
                this.stats.misses++;
                this.updateHitRate();
                return null;
            }

            // Check file modification time if applicable
            if (entry.filePath && entry.fileModTime) {
                const zone = this.getZoneForPath(entry.filePath);
                if (zone?.checkFileModTime) {
                    try {
                        const stat = await fs.stat(entry.filePath);
                        const currentModTime = stat.mtime.getTime();

                        if (currentModTime > entry.fileModTime) {
                            await this.invalidate(key, 'file_modified');
                            this.stats.fileInvalidations++;
                            this.stats.misses++;
                            this.updateHitRate();
                            return null;
                        }

                        // Also check file size for quick change detection
                        if (stat.size !== entry.fileSize) {
                            await this.invalidate(key, 'file_size_changed');
                            this.stats.fileInvalidations++;
                            this.stats.misses++;
                            this.updateHitRate();
                            return null;
                        }
                    } catch (error) {
                        // File doesn't exist or can't be accessed
                        await this.invalidate(key, 'file_missing');
                        this.stats.fileInvalidations++;
                        this.stats.misses++;
                        this.updateHitRate();
                        return null;
                    }
                }
            }

            // Check dependencies if any
            if (entry.dependencies && entry.dependencies.length > 0) {
                const dependencyInvalid = await this.checkDependencies(entry.dependencies);
                if (dependencyInvalid) {
                    await this.invalidate(key, 'dependency_changed');
                    this.stats.fileInvalidations++;
                    this.stats.misses++;
                    this.updateHitRate();
                    return null;
                }
            }

            // Valid entry - update access order and stats
            this.accessOrder.set(key, ++this.accessCounter);
            entry.hits++;
            this.stats.hits++;

            // Update zone stats
            if (entry.filePath) {
                const zone = this.getZoneForPath(entry.filePath);
                if (zone) {
                    this.stats.zonesStats[zone.name].hits++;
                }
            }

            this.updateHitRate();
            this.emit('cache:hit', {
                key,
                zone: entry.filePath ? this.getZoneForPath(entry.filePath)?.name : 'unknown',
            });

            return entry.data;
        } catch (error) {
            this.emit('cache:error', { operation: 'get', key, error });
            this.stats.misses++;
            this.updateHitRate();
            return null;
        }
    }

    /**
     * Set cache entry with file metadata
     */
    async set(
        key: string,
        data: T,
        options: {
            filePath?: string;
            dependencies?: string[];
            ttl?: number;
        } = {}
    ): Promise<void> {
        if (this.disposed) return;

        try {
            const now = Date.now();
            let ttl = options.ttl || this.config.defaultTtl;
            let fileModTime: number | undefined;
            let fileSize: number | undefined;
            let fileHash: string | undefined;

            // Get file metadata if path provided
            if (options.filePath) {
                const zone = this.getZoneForPath(options.filePath);
                if (zone) {
                    ttl = zone.ttl; // Use zone-specific TTL

                    try {
                        const stat = await fs.stat(options.filePath);
                        fileModTime = stat.mtime.getTime();
                        fileSize = stat.size;

                        // Quick hash for small files
                        if (fileSize < 1024 * 1024) {
                            // 1MB
                            const content = await fs.readFile(options.filePath, 'utf8');
                            fileHash = this.quickHash(content);
                        }
                    } catch (error) {
                        // File doesn't exist or can't be read - still cache but without file metadata
                        this.emit('cache:warning', {
                            message: 'Could not read file metadata for cache entry',
                            filePath: options.filePath,
                            error,
                        });
                    }
                }
            }

            const size = this.estimateSize(data);

            // Evict if necessary
            await this.evictIfNecessary(size);

            const entry: SmartCacheEntry<T> = {
                data,
                timestamp: now,
                ttl,
                hits: 0,
                size,
                hash: this.quickHash(key),
                filePath: options.filePath,
                fileModTime,
                fileSize,
                fileHash,
                dependencies: options.dependencies,
            };

            this.cache.set(key, entry);
            this.accessOrder.set(key, ++this.accessCounter);

            // Setup file watcher if applicable
            if (options.filePath && fileModTime) {
                const zone = this.getZoneForPath(options.filePath);
                if (zone?.watchFiles) {
                    await this.setupFileWatcher(options.filePath, zone.name);
                }
            }

            // Update zone stats
            if (options.filePath) {
                const zone = this.getZoneForPath(options.filePath);
                if (zone) {
                    this.stats.zonesStats[zone.name].entries++;
                }
            }

            this.emit('cache:set', { key, ttl, filePath: options.filePath });
        } catch (error) {
            this.emit('cache:error', { operation: 'set', key, error });
            throw error;
        }
    }

    /**
     * Invalidate cache entry
     */
    async invalidate(key: string, reason: string): Promise<boolean> {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Update zone stats - decrement entries
        if (entry.filePath) {
            const zone = this.getZoneForPath(entry.filePath);
            if (zone && this.stats.zonesStats[zone.name] && this.stats.zonesStats[zone.name].entries > 0) {
                this.stats.zonesStats[zone.name].entries--;
            }
        }

        const deleted = this.cache.delete(key);
        this.accessOrder.delete(key);

        this.emit('cache:invalidate', { key, reason, filePath: entry.filePath });
        return deleted;
    }

    /**
     * Invalidate all entries for a specific file path
     */
    async invalidateByPath(filePath: string): Promise<number> {
        const normalizedPath = path.resolve(filePath);
        const keysToInvalidate: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (
                entry.filePath === normalizedPath ||
                (entry.dependencies && entry.dependencies.includes(normalizedPath))
            ) {
                keysToInvalidate.push(key);
            }
        }

        for (const key of keysToInvalidate) {
            await this.invalidate(key, 'path_invalidation');
        }

        return keysToInvalidate.length;
    }

    /**
     * Invalidate entries by zone
     */
    async invalidateByZone(zoneName: string): Promise<number> {
        const keysToInvalidate: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (entry.filePath) {
                const zone = this.getZoneForPath(entry.filePath);
                if (zone?.name === zoneName) {
                    keysToInvalidate.push(key);
                }
            }
        }

        for (const key of keysToInvalidate) {
            await this.invalidate(key, `zone_invalidation:${zoneName}`);
        }

        return keysToInvalidate.length;
    }

    /**
     * Clear all cache entries
     */
    async clear(): Promise<void> {
        this.cache.clear();
        this.accessOrder.clear();
        this.accessCounter = 0;

        // Reset stats
        this.stats.hits = 0;
        this.stats.misses = 0;
        this.stats.evictions = 0;
        this.stats.fileInvalidations = 0;
        this.stats.watcherEvents = 0;

        for (const zoneName of Object.keys(this.stats.zonesStats)) {
            this.stats.zonesStats[zoneName] = {
                entries: 0,
                hits: 0,
                avgTtl: this.config.zones.find((z) => z.name === zoneName)?.ttl || this.config.defaultTtl,
            };
        }

        this.emit('cache:clear');
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return {
            ...this.stats,
            hitRate:
                this.stats.hits + this.stats.misses > 0 ? this.stats.hits / (this.stats.hits + this.stats.misses) : 0,
        };
    }

    /**
     * Get cache size information
     */
    getSize(): { entries: number; memoryBytes: number; watchers: number } {
        let memoryBytes = 0;
        for (const entry of this.cache.values()) {
            memoryBytes += entry.size;
        }

        return {
            entries: this.cache.size,
            memoryBytes,
            watchers: this.fileWatchers.size,
        };
    }

    /**
     * Check if cache is healthy
     */
    isHealthy(): boolean {
        const size = this.getSize();
        const stats = this.getStats();

        return (
            !this.disposed &&
            size.entries < this.config.maxSize &&
            size.memoryBytes < this.config.maxMemory &&
            size.watchers < this.config.maxWatchers &&
            (stats.hits + stats.misses === 0 || stats.hitRate > 0.1)
        );
    }

    /**
     * Dispose cache and cleanup resources
     */
    async dispose(): Promise<void> {
        if (this.disposed) return;

        this.disposed = true;

        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        // Close all file watchers
        for (const watcher of this.fileWatchers.values()) {
            try {
                watcher.watcher.close();
            } catch (error) {
                this.emit('cache:warning', { message: 'Error closing file watcher', error });
            }
        }
        this.fileWatchers.clear();

        // Close git watcher
        if (this.gitWatcher) {
            try {
                this.gitWatcher.close();
            } catch (error) {
                this.emit('cache:warning', { message: 'Error closing git watcher', error });
            }
        }

        await this.clear();
        this.emit('cache:disposed');
    }

    // Private helper methods

    private getZoneForPath(filePath: string): CacheZone | null {
        const normalizedPath = path.resolve(filePath);

        for (const zone of this.config.zones) {
            for (const pattern of zone.patterns) {
                if (this.matchesPattern(normalizedPath, pattern)) {
                    return zone;
                }
            }
        }

        return null;
    }

    private matchesPattern(filePath: string, pattern: string): boolean {
        const normalizedPath = path.resolve(filePath);

        // Handle patterns with ** (recursive)
        if (pattern.includes('**')) {
            const basePattern = pattern.split('**')[0];
            const basePath = path.resolve(basePattern || '.');
            return normalizedPath.startsWith(basePath);
        }

        // Convert glob pattern to regex for exact matching
        const regexPattern = pattern
            .replace(/\./g, '\\.') // Escape dots first
            .replace(/\*\*/g, '.*') // ** matches any path
            .replace(/\*/g, '[^/]*') // * matches any filename chars except /
            .replace(/\?/g, '.'); // ? matches any single char

        const regex = new RegExp(`^${regexPattern}$`);
        return regex.test(normalizedPath) || regex.test(path.basename(normalizedPath));
    }

    private async setupFileWatcher(filePath: string, zoneName: string): Promise<void> {
        if (this.fileWatchers.has(filePath) || this.fileWatchers.size >= this.config.maxWatchers) {
            return;
        }

        try {
            const watcher = watch(filePath, { persistent: false }, (eventType, filename) => {
                this.handleFileWatcherEvent(filePath, eventType, filename, zoneName);
            });

            this.fileWatchers.set(filePath, {
                path: filePath,
                watcher,
                zone: zoneName,
                lastEvent: Date.now(),
                eventCount: 0,
            });
        } catch (error) {
            this.emit('cache:warning', {
                message: 'Could not setup file watcher',
                filePath,
                error,
            });
        }
    }

    private handleFileWatcherEvent(
        filePath: string,
        eventType: string,
        filename: string | null,
        zoneName: string
    ): void {
        const watcherInfo = this.fileWatchers.get(filePath);
        if (!watcherInfo) return;

        const now = Date.now();

        // Debounce events
        if (now - watcherInfo.lastEvent < this.config.watcherDebounceMs) {
            return;
        }

        watcherInfo.lastEvent = now;
        watcherInfo.eventCount++;
        this.stats.watcherEvents++;

        // Invalidate cache entries for this file
        setTimeout(async () => {
            const invalidated = await this.invalidateByPath(filePath);
            this.emit('cache:file_changed', {
                filePath,
                eventType,
                filename,
                zoneName,
                invalidatedEntries: invalidated,
            });
        }, this.config.watcherDebounceMs);
    }

    private async setupGitWatcher(): Promise<void> {
        const gitDir = await this.findGitDirectory();
        if (!gitDir) return;

        try {
            const gitHeadPath = path.join(gitDir, 'HEAD');
            this.gitWatcher = watch(gitHeadPath, { persistent: false }, () => {
                // Git operation detected - invalidate everything
                setTimeout(async () => {
                    const size = this.cache.size;
                    await this.clear();
                    this.emit('cache:git_operation', { invalidatedEntries: size });
                }, 100); // Small delay to let git operation complete
            });
        } catch (error) {
            this.emit('cache:warning', { message: 'Could not setup git watcher', error });
        }
    }

    private async findGitDirectory(): Promise<string | null> {
        let dir = process.cwd();
        const root = path.parse(dir).root;

        while (dir !== root) {
            const gitDir = path.join(dir, '.git');
            try {
                const stat = await fs.stat(gitDir);
                if (stat.isDirectory()) {
                    return gitDir;
                }
            } catch {
                // Not a git directory, continue searching
            }
            dir = path.dirname(dir);
        }

        return null;
    }

    private async checkDependencies(dependencies: string[]): Promise<boolean> {
        for (const dep of dependencies) {
            try {
                const stat = await fs.stat(dep);

                // Check if dependency was modified after any cache entry that depends on it
                for (const [key, entry] of this.cache.entries()) {
                    if (entry.dependencies && entry.dependencies.includes(dep)) {
                        // Compare current file modification time with when the cache entry was created
                        if (stat.mtime.getTime() > entry.timestamp) {
                            return true; // Dependency has been modified since cache entry was created
                        }
                    }
                }
            } catch {
                return true; // Dependency missing or inaccessible
            }
        }
        return false;
    }

    private async evictIfNecessary(newEntrySize: number): Promise<void> {
        const currentSize = this.getSize();

        // Check if we need to evict based on entry count or memory usage
        if (
            currentSize.entries >= this.config.maxSize ||
            currentSize.memoryBytes + newEntrySize > this.config.maxMemory
        ) {
            // Find LRU entries to evict
            const accessEntries = Array.from(this.accessOrder.entries()).sort((a, b) => a[1] - b[1]); // Sort by access order (oldest first)

            const toEvict = Math.max(1, Math.floor(this.config.maxSize * 0.1)); // Evict 10%

            for (let i = 0; i < toEvict && i < accessEntries.length; i++) {
                const key = accessEntries[i][0];
                await this.invalidate(key, 'lru_eviction');
                this.stats.evictions++;
            }
        }
    }

    private cleanup(): void {
        if (this.disposed) return;

        const now = Date.now();
        const expiredKeys: string[] = [];

        // Find expired entries
        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > entry.ttl) {
                expiredKeys.push(key);
            }
        }

        // Remove expired entries
        for (const key of expiredKeys) {
            this.invalidate(key, 'cleanup_expired');
        }

        // Cleanup unused file watchers
        const watchersToRemove: string[] = [];
        for (const [path, watcher] of this.fileWatchers.entries()) {
            let hasReferences = false;
            for (const entry of this.cache.values()) {
                if (entry.filePath === path) {
                    hasReferences = true;
                    break;
                }
            }

            if (!hasReferences && now - watcher.lastEvent > 300000) {
                // 5 minutes inactive
                watchersToRemove.push(path);
            }
        }

        for (const path of watchersToRemove) {
            const watcher = this.fileWatchers.get(path);
            if (watcher) {
                try {
                    watcher.watcher.close();
                } catch (error) {
                    this.emit('cache:warning', { message: 'Error closing unused watcher', path, error });
                }
                this.fileWatchers.delete(path);
            }
        }

        this.emit('cache:cleanup', {
            expiredEntries: expiredKeys.length,
            removedWatchers: watchersToRemove.length,
        });
    }

    private updateHitRate(): void {
        const total = this.stats.hits + this.stats.misses;
        this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
    }

    private quickHash(str: string): string {
        let hash = 0;
        if (str.length === 0) return hash.toString(16);

        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = (hash << 5) - hash + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16);
    }

    private estimateSize(data: T): number {
        if (typeof data === 'string') {
            return data.length * 2; // UTF-16
        }
        if (typeof data === 'object' && data !== null) {
            try {
                return JSON.stringify(data).length * 2;
            } catch {
                return 1024; // Default for non-serializable objects
            }
        }
        return 8; // Default for primitives
    }
}

// Default cache zones configuration
export const DEFAULT_CACHE_ZONES: CacheZone[] = [
    {
        name: 'stable',
        patterns: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/target/**'],
        ttl: 3600000, // 1 hour
        checkFileModTime: false, // These rarely change
        watchFiles: false,
        description: 'Stable directories that rarely change',
    },
    {
        name: 'source',
        patterns: ['**/src/**', '**/lib/**', '**/app/**'],
        ttl: 10000, // 10 seconds during active development
        checkFileModTime: true,
        watchFiles: true,
        description: 'Source code that changes frequently',
    },
    {
        name: 'config',
        patterns: ['**/*.json', '**/*.yaml', '**/*.yml', '**/*.toml', '**/*.ini', '**/.*rc*'],
        ttl: 30000, // 30 seconds
        checkFileModTime: true,
        watchFiles: true,
        description: 'Configuration files',
    },
    {
        name: 'tests',
        patterns: ['**/test/**', '**/tests/**', '**/*.test.*', '**/*.spec.*', '**/__tests__/**'],
        ttl: 15000, // 15 seconds
        checkFileModTime: true,
        watchFiles: true,
        description: 'Test files',
    },
    {
        name: 'docs',
        patterns: ['**/*.md', '**/docs/**', '**/*.rst', '**/*.txt'],
        ttl: 60000, // 1 minute
        checkFileModTime: true,
        watchFiles: false, // Don't watch docs as aggressively
        description: 'Documentation files',
    },
    {
        name: 'volatile',
        patterns: ['**/tmp/**', '**/temp/**', '**/.cache/**', '**/logs/**'],
        ttl: 1000, // 1 second - very short for volatile files
        checkFileModTime: true,
        watchFiles: false, // Too volatile for watchers
        description: 'Temporary and volatile files',
    },
];

// Factory function to create smart cache with sensible defaults
export function createSmartCache<T>(overrides: Partial<SmartCacheConfig> = {}): SmartCache<T> {
    const config: SmartCacheConfig = {
        maxSize: 1000,
        maxMemory: 100 * 1024 * 1024, // 100MB
        defaultTtl: 300000, // 5 minutes
        zones: DEFAULT_CACHE_ZONES,
        gitAware: true,
        watcherDebounceMs: 100,
        maxWatchers: 100,
        enableMetrics: true,
        ...overrides,
    };

    return new SmartCache<T>(config);
}
