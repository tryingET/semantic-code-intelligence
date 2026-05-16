/**
 * Unified Cache Service
 * Provides in-memory and persistent caching for all operations
 */

import { LRUCache } from 'lru-cache'

export interface CacheOptions {
  ttl?: number  // Time to live in seconds
  updateAgeOnGet?: boolean
}

export interface CacheEntry {
  value: any
  timestamp: number
  ttl?: number
}

export class CacheService {
  private memoryCache: LRUCache<string, CacheEntry>
  private persistentCache?: Map<string, CacheEntry>  // Could be Redis/SQLite later
  
  constructor(options?: {
    maxSize?: number
    maxAge?: number
    persistent?: boolean
  }) {
    // Initialize in-memory LRU cache
    this.memoryCache = new LRUCache<string, CacheEntry>({
      max: options?.maxSize || 1000,  // Max 1000 items
      ttl: (options?.maxAge || 3600) * 1000,  // Default 1 hour
      updateAgeOnGet: true,
      updateAgeOnHas: true,
    })
    
    // Initialize persistent cache if needed
    if (options?.persistent) {
      this.persistentCache = new Map()
      // In production, this would connect to Redis/SQLite
    }
  }
  
  /**
   * Get value from cache
   */
  async get(key: string): Promise<any> {
    // Try memory cache first
    const memEntry = this.memoryCache.get(key)
    if (memEntry && !this.isExpired(memEntry)) {
      return memEntry.value
    }
    
    // Try persistent cache if available
    if (this.persistentCache) {
      const persistEntry = this.persistentCache.get(key)
      if (persistEntry && !this.isExpired(persistEntry)) {
        // Promote to memory cache
        this.memoryCache.set(key, persistEntry)
        return persistEntry.value
      }
    }
    
    return null
  }
  
  /**
   * Set value in cache
   */
  async set(key: string, value: any, options?: CacheOptions): Promise<void> {
    const entry: CacheEntry = {
      value,
      timestamp: Date.now(),
      ttl: options?.ttl
    }
    
    // Set in memory cache
    this.memoryCache.set(key, entry)
    
    // Set in persistent cache if available
    if (this.persistentCache) {
      this.persistentCache.set(key, entry)
    }
  }
  
  /**
   * Delete from cache
   */
  async delete(key: string): Promise<void> {
    this.memoryCache.delete(key)
    if (this.persistentCache) {
      this.persistentCache.delete(key)
    }
  }
  
  /**
   * Clear entire cache
   */
  async clear(): Promise<void> {
    this.memoryCache.clear()
    if (this.persistentCache) {
      this.persistentCache.clear()
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats(): {
    size: number
    hits: number
    misses: number
    hitRate: number
  } {
    const size = this.memoryCache.size
    // LRUCache doesn't track hits/misses by default
    // In production, we'd track these manually
    return {
      size,
      hits: 0,
      misses: 0,
      hitRate: 0
    }
  }
  
  /**
   * Check if many keys exist
   */
  async has(key: string): Promise<boolean> {
    if (this.memoryCache.has(key)) {
      const entry = this.memoryCache.get(key)
      if (entry && !this.isExpired(entry)) {
        return true
      }
    }
    
    if (this.persistentCache && this.persistentCache.has(key)) {
      const entry = this.persistentCache.get(key)
      if (entry && !this.isExpired(entry)) {
        return true
      }
    }
    
    return false
  }
  
  /**
   * Get multiple values at once
   */
  async getMany(keys: string[]): Promise<Map<string, any>> {
    const results = new Map<string, any>()
    
    for (const key of keys) {
      const value = await this.get(key)
      if (value !== null) {
        results.set(key, value)
      }
    }
    
    return results
  }
  
  /**
   * Set multiple values at once
   */
  async setMany(entries: Map<string, any>, options?: CacheOptions): Promise<void> {
    for (const [key, value] of entries) {
      await this.set(key, value, options)
    }
  }
  
  /**
   * Invalidate cache entries matching pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    const regex = new RegExp(pattern)
    
    // Invalidate in memory cache
    for (const key of this.memoryCache.keys()) {
      if (regex.test(key)) {
        this.memoryCache.delete(key)
      }
    }
    
    // Invalidate in persistent cache
    if (this.persistentCache) {
      for (const key of this.persistentCache.keys()) {
        if (regex.test(key)) {
          this.persistentCache.delete(key)
        }
      }
    }
  }
  
  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    if (!entry.ttl) {
      return false  // No TTL means never expires
    }
    
    const age = (Date.now() - entry.timestamp) / 1000  // Age in seconds
    return age > entry.ttl
  }
  
  /**
   * Warm up cache with precomputed values
   */
  async warmUp(data: Map<string, any>): Promise<void> {
    for (const [key, value] of data) {
      await this.set(key, value, { ttl: 7200 })  // 2 hours for warmed data
    }
  }
  
  /**
   * Create namespaced cache key
   */
  static createKey(namespace: string, ...parts: string[]): string {
    return `${namespace}:${parts.join(':')}`
  }
}