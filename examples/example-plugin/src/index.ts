/**
 * Enhanced Search Plugin - Example Layer 1 Enhancement
 * Demonstrates how to create a high-performance plugin that enhances existing functionality
 */

import Fuse from 'fuse.js';
import { LRUCache } from 'lru-cache';

import {
  BasePlugin,
  LayerPlugin,
  PluginContext,
  PluginConfig,
  PluginHealthStatus,
  PluginState,
  LayerInput,
  LayerOutput,
  LayerContext,
  LogLevel
} from '../../../src/plugins/plugin-api.js';

// ============================================================================
// Plugin Configuration Interface
// ============================================================================

export interface EnhancedSearchConfig {
  fuzzyThreshold: number;
  maxResults: number;
  cacheSize: number;
  enableAdvancedPatterns: boolean;
}

// ============================================================================
// Search Result Interfaces
// ============================================================================

interface SearchResult {
  identifier: string;
  uri: string;
  line: number;
  character: number;
  content: string;
  score: number;
}

interface CachedResult {
  results: SearchResult[];
  timestamp: number;
  hitCount: number;
}

// ============================================================================
// Enhanced Search Plugin Implementation
// ============================================================================

export default class EnhancedSearchPlugin implements LayerPlugin {
  // Plugin metadata (required by BasePlugin)
  readonly manifest = require('../plugin.json');
  readonly id = this.manifest.id;
  readonly version = this.manifest.version;
  
  // Layer plugin specific properties
  readonly type = 'layer' as const;
  readonly targetLayer = 'layer1' as const;
  readonly enhanceExisting = true;
  
  // Plugin state
  public state: PluginState = PluginState.UNLOADED;
  
  // Internal components
  private context?: PluginContext;
  private config?: EnhancedSearchConfig;
  private searchEngine?: Fuse<SearchResult>;
  private resultCache?: LRUCache<string, CachedResult>;
  private indexedFiles: Map<string, SearchResult[]> = new Map();
  
  // Performance metrics
  private metrics = {
    searchCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    indexUpdates: 0,
    averageSearchTime: 0
  };

  // ============================================================================
  // Plugin Lifecycle Implementation
  // ============================================================================

  async onLoad(context: PluginContext): Promise<void> {
    this.context = context;
    this.state = PluginState.LOADING;
    
    context.logger.info('Enhanced Search Plugin loading...');
    
    // Initialize cache with configuration
    const cacheSize = context.config.custom?.cacheSize || 1000;
    this.resultCache = new LRUCache<string, CachedResult>({
      max: cacheSize,
      ttl: 5 * 60 * 1000, // 5 minutes TTL
      updateAgeOnGet: true,
      updateAgeOnHas: true
    });
    
    // Set up file watching for index updates
    if (context.config.custom?.enableFileWatching !== false) {
      await this.setupFileWatching();
    }
    
    this.state = PluginState.LOADED;
    context.logger.info('Enhanced Search Plugin loaded successfully');
  }

  async onInitialize(config: PluginConfig): Promise<void> {
    if (!this.context) {
      throw new Error('Plugin context not available during initialization');
    }
    
    this.state = PluginState.INITIALIZING;
    this.config = config.custom as EnhancedSearchConfig;
    
    this.context.logger.info('Initializing Enhanced Search Plugin...', {
      fuzzyThreshold: this.config.fuzzyThreshold,
      maxResults: this.config.maxResults,
      cacheSize: this.config.cacheSize
    });
    
    // Initialize fuzzy search engine
    await this.initializeSearchEngine();
    
    // Build initial index
    await this.buildInitialIndex();
    
    this.state = PluginState.READY;
    this.context.logger.info('Enhanced Search Plugin initialized successfully');
  }

  async onActivate(): Promise<void> {
    if (!this.context) return;
    
    this.state = PluginState.ACTIVE;
    this.context.logger.info('Enhanced Search Plugin activated');
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
  }

  async onDeactivate(): Promise<void> {
    if (!this.context) return;
    
    this.state = PluginState.READY;
    this.context.logger.info('Enhanced Search Plugin deactivated');
    
    // Stop performance monitoring
    this.stopPerformanceMonitoring();
  }

  async onUnload(): Promise<void> {
    if (!this.context) return;
    
    this.context.logger.info('Unloading Enhanced Search Plugin...');
    
    // Clear caches and indexes
    this.resultCache?.clear();
    this.indexedFiles.clear();
    
    this.state = PluginState.UNLOADED;
    this.context.logger.info('Enhanced Search Plugin unloaded');
  }

  async onConfigChange(newConfig: PluginConfig): Promise<void> {
    if (!this.context) return;
    
    this.context.logger.info('Enhanced Search Plugin config changed', newConfig.custom);
    
    const oldConfig = this.config;
    this.config = newConfig.custom as EnhancedSearchConfig;
    
    // Reinitialize if significant config changes
    if (this.hasSignificantConfigChanges(oldConfig, this.config)) {
      await this.reinitialize();
    }
  }

  onHealthCheck(): PluginHealthStatus {
    const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // MB
    const cacheStats = this.getCacheStats();
    
    return {
      status: this.state === PluginState.ACTIVE ? 'healthy' : 'degraded',
      latency: this.metrics.averageSearchTime,
      errorRate: 0, // Would track actual errors in production
      memoryUsage,
      cpuUsage: 0, // Would measure actual CPU usage
      cacheHitRate: this.getCacheHitRate(),
      lastCheck: Date.now(),
      details: `Indexed ${this.indexedFiles.size} files, ${cacheStats.size} cached results`,
      metrics: {
        searchCount: this.metrics.searchCount,
        cacheHits: this.metrics.cacheHits,
        cacheMisses: this.metrics.cacheMisses,
        indexSize: this.indexedFiles.size,
        cacheSize: cacheStats.size
      }
    };
  }

  // ============================================================================
  // Layer Plugin Interface Implementation  
  // ============================================================================

  getTargetLatency(): number {
    return this.manifest.performance.maxLatencyMs;
  }

  canHandle(input: LayerInput): boolean {
    // Handle definition and reference searches
    return input.type === 'definition' || input.type === 'reference';
  }

  async process(input: LayerInput, context: LayerContext): Promise<LayerOutput> {
    if (!this.context || !this.config || !this.searchEngine) {
      throw new Error('Enhanced Search Plugin not properly initialized');
    }

    const timer = this.context.createTimer('search-operation');
    timer.start();

    try {
      // Check cache first
      const cacheKey = this.createCacheKey(input);
      const cached = await this.getCachedResult(cacheKey);
      
      if (cached) {
        const duration = timer.stop();
        this.metrics.cacheHits++;
        this.updateAverageSearchTime(duration);
        
        return {
          results: cached.results.map(r => this.convertToDefinitionOrReference(r, input.type)),
          confidence: 0.9, // High confidence for cached results
          source: 'enhanced-search-cache',
          processingTime: duration,
          cacheHit: true,
          metadata: {
            cacheAge: Date.now() - cached.timestamp,
            hitCount: cached.hitCount
          }
        };
      }

      // Perform enhanced search
      const results = await this.performEnhancedSearch(input);
      
      // Cache the results
      await this.cacheResult(cacheKey, results);
      
      const duration = timer.stop();
      this.metrics.cacheMisses++;
      this.metrics.searchCount++;
      this.updateAverageSearchTime(duration);

      return {
        results: results.map(r => this.convertToDefinitionOrReference(r, input.type)),
        confidence: 0.8, // Good confidence for fuzzy search
        source: 'enhanced-search-fuzzy',
        processingTime: duration,
        cacheHit: false,
        metadata: {
          fuzzyThreshold: this.config.fuzzyThreshold,
          totalCandidates: results.length
        }
      };

    } catch (error) {
      const duration = timer.stop();
      this.context.logger.error('Enhanced search failed', error as Error);
      
      throw error;
    }
  }

  // ============================================================================
  // Search Engine Implementation
  // ============================================================================

  private async initializeSearchEngine(): Promise<void> {
    if (!this.config) {
      throw new Error('Config not available for search engine initialization');
    }

    const fuseOptions = {
      keys: [
        { name: 'identifier', weight: 0.7 },
        { name: 'content', weight: 0.3 }
      ],
      threshold: this.config.fuzzyThreshold,
      includeScore: true,
      includeMatches: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
      useExtendedSearch: this.config.enableAdvancedPatterns
    };

    this.searchEngine = new Fuse<SearchResult>([], fuseOptions);
  }

  private async buildInitialIndex(): Promise<void> {
    if (!this.context) return;

    this.context.logger.info('Building initial search index...');
    
    try {
      // Get all workspace files
      const workspaceFiles = await this.context.core.getWorkspaceFiles('**/*.{ts,js,json}');
      
      let totalIndexed = 0;
      
      for (const filePath of workspaceFiles) {
        try {
          const results = await this.indexFile(filePath);
          if (results.length > 0) {
            this.indexedFiles.set(filePath, results);
            this.searchEngine?.add(results);
            totalIndexed += results.length;
          }
        } catch (error) {
          this.context.logger.warn(`Failed to index file: ${filePath}`, error as Error);
        }
      }
      
      this.metrics.indexUpdates++;
      this.context.logger.info(`Search index built: ${totalIndexed} symbols from ${workspaceFiles.length} files`);
      
    } catch (error) {
      this.context.logger.error('Failed to build initial index', error as Error);
    }
  }

  private async indexFile(filePath: string): Promise<SearchResult[]> {
    if (!this.context) return [];

    try {
      const document = await this.context.core.getDocument(filePath);
      if (!document) return [];

      const results: SearchResult[] = [];
      
      // Extract symbols from the document
      if (document.symbols) {
        for (const symbol of document.symbols) {
          results.push({
            identifier: symbol.name,
            uri: filePath,
            line: symbol.range.start.line,
            character: symbol.range.start.character,
            content: this.extractContextContent(document.content, symbol.range.start.line),
            score: 1.0 // Will be updated by fuzzy search
          });
        }
      }

      return results;

    } catch (error) {
      this.context?.logger.debug(`Error indexing file ${filePath}:`, error as Error);
      return [];
    }
  }

  private async performEnhancedSearch(input: LayerInput): Promise<SearchResult[]> {
    if (!this.searchEngine || !this.config) {
      return [];
    }

    const query = input.identifier || input.query || '';
    if (!query.trim()) {
      return [];
    }

    // Perform fuzzy search
    const fuseResults = this.searchEngine.search(query, {
      limit: this.config.maxResults
    });

    // Convert Fuse results to SearchResult format
    const results = fuseResults.map(result => ({
      ...result.item,
      score: 1 - (result.score || 0) // Invert score (higher is better)
    }));

    // Sort by score and relevance
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, this.config.maxResults);
  }

  // ============================================================================
  // Caching Implementation
  // ============================================================================

  private createCacheKey(input: LayerInput): string {
    const parts = [
      input.type,
      input.identifier || '',
      input.query || '',
      input.uri || '',
      input.position ? `${input.position.line}:${input.position.character}` : ''
    ];
    return parts.join('|');
  }

  private async getCachedResult(key: string): Promise<CachedResult | undefined> {
    if (!this.resultCache) return undefined;

    const cached = this.resultCache.get(key);
    if (cached) {
      cached.hitCount++;
      return cached;
    }
    
    return undefined;
  }

  private async cacheResult(key: string, results: SearchResult[]): Promise<void> {
    if (!this.resultCache) return;

    const cached: CachedResult = {
      results,
      timestamp: Date.now(),
      hitCount: 0
    };

    this.resultCache.set(key, cached);
  }

  // ============================================================================
  // File Watching and Index Updates
  // ============================================================================

  private async setupFileWatching(): Promise<void> {
    if (!this.context) return;

    try {
      // Watch TypeScript and JavaScript files
      const watcher = await this.context.core.watchFiles('**/*.{ts,js}', (event, filePath) => {
        this.handleFileChange(event, filePath);
      });

      this.context.logger.debug('File watching enabled for search index updates');

    } catch (error) {
      this.context.logger.warn('Failed to setup file watching', error as Error);
    }
  }

  private async handleFileChange(event: 'add' | 'change' | 'unlink', filePath: string): Promise<void> {
    if (!this.context) return;

    try {
      switch (event) {
        case 'add':
        case 'change':
          // Reindex the file
          const results = await this.indexFile(filePath);
          
          // Remove old entries
          const oldResults = this.indexedFiles.get(filePath) || [];
          for (const oldResult of oldResults) {
            this.searchEngine?.remove(r => r.uri === filePath && r.identifier === oldResult.identifier);
          }
          
          // Add new entries
          this.indexedFiles.set(filePath, results);
          this.searchEngine?.add(results);
          
          // Invalidate related cache entries
          this.invalidateCacheForFile(filePath);
          
          this.context.logger.debug(`Updated index for ${filePath}: ${results.length} symbols`);
          break;

        case 'unlink':
          // Remove from index
          const removedResults = this.indexedFiles.get(filePath) || [];
          for (const result of removedResults) {
            this.searchEngine?.remove(r => r.uri === filePath);
          }
          this.indexedFiles.delete(filePath);
          
          // Invalidate cache
          this.invalidateCacheForFile(filePath);
          
          this.context.logger.debug(`Removed ${filePath} from index`);
          break;
      }

      this.metrics.indexUpdates++;

    } catch (error) {
      this.context.logger.warn(`Failed to handle file change for ${filePath}`, error as Error);
    }
  }

  private invalidateCacheForFile(filePath: string): void {
    if (!this.resultCache) return;

    // Remove all cache entries that might be affected by this file change
    for (const key of this.resultCache.keys()) {
      if (key.includes(filePath)) {
        this.resultCache.delete(key);
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  private convertToDefinitionOrReference(result: SearchResult, type: string): any {
    const base = {
      identifier: result.identifier,
      uri: result.uri,
      range: {
        start: { line: result.line, character: result.character },
        end: { line: result.line, character: result.character + result.identifier.length }
      },
      confidence: result.score,
      source: 'fuzzy' as const
    };

    if (type === 'definition') {
      return {
        ...base,
        kind: this.inferDefinitionKind(result.identifier),
        context: result.content
      };
    } else {
      return {
        ...base,
        kind: 'usage' as const,
        isDeclaration: false,
        context: result.content
      };
    }
  }

  private inferDefinitionKind(identifier: string): string {
    // Simple heuristics for definition kind inference
    if (identifier.startsWith('class ') || /^[A-Z]/.test(identifier)) {
      return 'class';
    } else if (identifier.includes('(') || identifier.endsWith('()')) {
      return 'function';
    } else if (identifier.startsWith('interface ')) {
      return 'interface';
    } else {
      return 'variable';
    }
  }

  private extractContextContent(content: string, line: number): string {
    const lines = content.split('\n');
    const start = Math.max(0, line - 1);
    const end = Math.min(lines.length, line + 2);
    return lines.slice(start, end).join('\n').trim();
  }

  private hasSignificantConfigChanges(
    oldConfig: EnhancedSearchConfig | undefined, 
    newConfig: EnhancedSearchConfig
  ): boolean {
    if (!oldConfig) return true;
    
    return (
      oldConfig.fuzzyThreshold !== newConfig.fuzzyThreshold ||
      oldConfig.maxResults !== newConfig.maxResults ||
      oldConfig.enableAdvancedPatterns !== newConfig.enableAdvancedPatterns
    );
  }

  private async reinitialize(): Promise<void> {
    if (!this.context) return;

    this.context.logger.info('Reinitializing Enhanced Search Plugin due to config changes...');
    
    // Clear existing state
    this.resultCache?.clear();
    this.indexedFiles.clear();
    
    // Reinitialize search engine
    await this.initializeSearchEngine();
    
    // Rebuild index
    await this.buildInitialIndex();
    
    this.context.logger.info('Enhanced Search Plugin reinitialized successfully');
  }

  // ============================================================================
  // Performance Monitoring
  // ============================================================================

  private performanceTimer?: NodeJS.Timeout;

  private startPerformanceMonitoring(): void {
    this.performanceTimer = setInterval(() => {
      this.reportPerformanceMetrics();
    }, 30000); // Report every 30 seconds
  }

  private stopPerformanceMonitoring(): void {
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = undefined;
    }
  }

  private reportPerformanceMetrics(): void {
    if (!this.context) return;

    const metrics = {
      searchCount: this.metrics.searchCount,
      cacheHitRate: this.getCacheHitRate(),
      averageSearchTime: this.metrics.averageSearchTime,
      indexSize: this.indexedFiles.size,
      cacheSize: this.resultCache?.size || 0
    };

    this.context.reportMetrics(metrics);
  }

  private getCacheHitRate(): number {
    const totalRequests = this.metrics.cacheHits + this.metrics.cacheMisses;
    return totalRequests > 0 ? this.metrics.cacheHits / totalRequests : 0;
  }

  private getCacheStats() {
    return {
      size: this.resultCache?.size || 0,
      maxSize: this.resultCache?.maxSize || 0,
      itemCount: this.resultCache?.calculatedSize || 0
    };
  }

  private updateAverageSearchTime(newTime: number): void {
    if (this.metrics.searchCount === 0) {
      this.metrics.averageSearchTime = newTime;
    } else {
      this.metrics.averageSearchTime = 
        (this.metrics.averageSearchTime * this.metrics.searchCount + newTime) / 
        (this.metrics.searchCount + 1);
    }
  }
}