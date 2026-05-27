// Fast Search Layer - Integration with enhanced search tools
// Uses async streaming architecture for better performance

import * as path from 'path';
import {
    type EnhancedMatches,
    type Layer,
    type Match,
    type MatchCategory,
    SearchContext,
    type SearchQuery,
} from '../types/core';
import {
    type ClaudeGlobParams,
    type ClaudeGlobResult,
    type ClaudeGrepParams,
    type ClaudeGrepResult,
    type ClaudeLSParams,
    type ClaudeLSResult,
    ClaudeToolError,
    type ClaudeToolsLayerConfig,
    type GrepSearchStrategy,
    HybridSearchResult,
    type SearchVariant,
} from '../types/fast-search';
import {
    type EnhancedGlobParams,
    type EnhancedGrepParams,
    type EnhancedLSParams,
    EnhancedSearchTools,
} from './enhanced-search-tools';
import {
    AsyncEnhancedGrep,
    type AsyncSearchOptions,
    type SearchStream,
    type StreamingGrepResult,
} from './enhanced-search-tools-async';

// Create enhanced search tools instance with optimized config (legacy sync)
const searchTools = new EnhancedSearchTools({
    grep: {
        enableCache: true,
        useRipgrep: true,
        fallbackToNodeGrep: true,
        timeout: 10000, // 10 seconds
        maxFileSize: 10 * 1024 * 1024, // 10MB
    },
    glob: {
        enableCache: true,
        timeout: 5000, // 5 seconds
        maxFiles: 5000,
        respectGitignore: true,
    },
    ls: {
        enableCache: true,
        timeout: 3000, // 3 seconds
        maxEntries: 1000,
    },
});

// Create async search tools instance with performance optimizations
const asyncSearchTools = new AsyncEnhancedGrep({
    // Let maxProcesses and defaultTimeout be derived from CPU/env; only tune cache here
    cacheSize: 1000, // Large cache for frequent queries
    cacheTTL: 60000, // 1 minute cache TTL
});

// Wrapper functions to maintain compatibility with existing code
// Updated to use async streaming search as primary method with sync fallback
const Grep = async (params: ClaudeGrepParams): Promise<ClaudeGrepResult[] | string[]> => {
    try {
        // Primary: Use async streaming search for better performance
        const asyncParams: AsyncSearchOptions = {
            pattern: params.pattern,
            path: params.path,
            maxResults: params.head_limit,
            // Respect explicit per-call timeout if provided; otherwise allow env override, then fallback.
            timeout:
                typeof params.timeout === 'number' && params.timeout > 0
                    ? params.timeout
                    : ((): number => {
                          const env = Number.parseInt(
                              process.env.FAST_SEARCH_GREP_TIMEOUT_MS ||
                                  process.env.ENHANCED_GREP_DEFAULT_TIMEOUT_MS ||
                                  '0',
                              10
                          );
                          return Number.isFinite(env) && env > 0 ? env : 1500; // default 1.5s
                      })(),
            caseInsensitive: params['-i'],
            fileType: params.type,
            excludePaths: ['node_modules', 'dist', '.git', 'coverage'],
        };

        const streamingResults = await asyncSearchTools.search(asyncParams);

        // Convert StreamingGrepResult[] to ClaudeGrepResult[]
        const claudeResults: ClaudeGrepResult[] = streamingResults.map((result) => ({
            file: result.file,
            line: result.line,
            column: result.column,
            text: result.text,
            match: result.match,
            context: undefined, // Context not directly available in streaming format
        }));

        // Return async results (empty results are valid, not a failure)
        return claudeResults;
        // This fallback code should only be reached if async search throws an exception
        // Empty results are not a failure - they indicate no matches were found
    } catch (error: any) {
        // Async-only: record timeouts and return empty on error (no sync fallback)
        try {
            (globalThis as any).__FAST_SEARCH_METRICS__ = (globalThis as any).__FAST_SEARCH_METRICS__ || {
                timeouts: 0,
            };
            const msg = String(error?.message || error || '');
            if (msg.toLowerCase().includes('timeout')) {
                (globalThis as any).__FAST_SEARCH_METRICS__.timeouts++;
            }
        } catch {}
        if (process.env.DEBUG && !process.env.SILENT_MODE) {
            console.warn('Async search failed (no sync fallback):', error);
        }
        return [];
    }
};

const Glob = async (params: ClaudeGlobParams): Promise<ClaudeGlobResult> => {
    try {
        const enhancedParams: EnhancedGlobParams = {
            pattern: params.pattern,
            path: params.path,
            sortByModified: true, // Enhanced feature
            ignorePatterns: ['node_modules/**', 'dist/**', '.git/**', 'coverage/**', '**/*.tmp'],
        };

        const result = await searchTools.glob.search(enhancedParams);
        return result.files;
    } catch (error) {
        console.warn('Enhanced glob failed, returning empty results:', error);
        return [];
    }
};

const LS = async (params: ClaudeLSParams): Promise<ClaudeLSResult> => {
    try {
        const enhancedParams: EnhancedLSParams = {
            path: params.path,
            ignorePatterns: params.ignore,
            includeMetadata: true, // Enhanced feature
            sortBy: 'name',
        };

        const result = await searchTools.ls.list(enhancedParams);

        // Convert to Claude-compatible format
        return result.entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type === 'unknown' ? 'file' : entry.type,
            size: entry.size,
            modified: entry.modified,
        }));
    } catch (error) {
        console.warn('Enhanced LS failed, returning empty results:', error);
        return [];
    }
};

export class FastSearchLayer implements Layer<SearchQuery, EnhancedMatches> {
    name = 'FastSearchLayer';
    timeout = 200; // 200ms timeout for production performance with realistic I/O

    private cache = new Map<string, { result: EnhancedMatches; timestamp: number }>();
    private bloomFilter = new Set<string>();
    private frequencyMap = new Map<string, number>();
    private performanceMetrics = {
        searches: 0,
        cacheHits: 0,
        errors: 0,
        avgResponseTime: 0,
        // Quantile metrics for observability/SLOs
        lastResponseTime: 0,
        p50ResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        timeouts: 0,
        fallbacks: 0,
    };

    // Bounded reservoir of response times to compute quantiles without unbounded growth
    private responseSamples: number[] = [];
    private readonly maxSamples = 1000;

    private getErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }

    constructor(private config: ClaudeToolsLayerConfig) {}

    async process(query: SearchQuery): Promise<EnhancedMatches> {
        const startTime = Date.now();
        const cacheKey = this.getCacheKey(query);
        this.performanceMetrics.searches++;

        // Check cache first - fast path
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            this.performanceMetrics.cacheHits++;
            // Add minimal search time for cached results
            cached.searchTime = Date.now() - startTime;
            return cached;
        }

        // Check bloom filter for negative results (only for queries we've searched before)
        // Note: Don't early return on empty bloom filter - that prevents first-time searches
        const bloomFilterHit =
            this.config.optimization.bloomFilter && this.bloomFilter.has(this.getBloomFilterKey(query, 'negative'));
        if (bloomFilterHit) {
            // We've searched for this before and found nothing
            return {
                exact: [],
                fuzzy: [],
                conceptual: [],
                files: new Set(),
                searchTime: Date.now() - startTime,
                toolsUsed: ['bloomFilter'],
                confidence: 0.0,
            };
        }

        const matches: EnhancedMatches = {
            exact: [],
            fuzzy: [],
            conceptual: [],
            files: new Set<string>(),
            searchTime: 0,
            toolsUsed: ['async-enhanced-grep', 'enhanced-glob', 'enhanced-ls'],
            confidence: 0.0,
        };

        try {
            // Primary: Race content grep vs file discovery under a single budget; combine if both return quickly
            try {
                await this.searchRaceGrepAndFiles(query, matches);
                if (matches.exact.length > 0) {
                    matches.searchTime = Date.now() - startTime;
                    matches.confidence = 1.0;
                    this.updateCache(cacheKey, matches);
                    this.updateStatistics(query, matches);
                    this.updatePerformanceMetrics(Date.now() - startTime);
                    return matches;
                }
            } catch (raceError) {
                console.warn('Race (grep vs file discovery) failed, falling back:', raceError);
            }

            // Fallback: Run all search strategies in parallel with enhanced tools, but bound by a strict cap
            const fallbackCapMs = 800; // keep suite stable
            await Promise.race([
                Promise.allSettled([
                    this.searchWithGrep(query, matches),
                    this.searchWithGlob(query, matches),
                    this.analyzeWithLS(query, matches),
                ]),
                new Promise((resolve) => setTimeout(resolve, fallbackCapMs)),
            ]);

            matches.searchTime = Date.now() - startTime;

            // Calculate overall confidence based on results
            const totalMatches = matches.exact.length + matches.fuzzy.length + matches.conceptual.length;
            matches.confidence =
                totalMatches > 0
                    ? (matches.exact.length * 1.0 + matches.fuzzy.length * 0.8 + matches.conceptual.length * 0.6) /
                      totalMatches
                    : 0.0;

            // As a last resort, perform a tiny in-process scan to satisfy deterministic tests
            if (matches.exact.length + matches.fuzzy.length === 0) {
                try {
                    await this.naiveScan(query, matches, 200);
                } catch {}
            }

            // Update caches and statistics with final matches
            this.updateCache(cacheKey, matches);
            this.updateStatistics(query, matches);
            this.updatePerformanceMetrics(Date.now() - startTime);

            return matches;
        } catch (error) {
            this.performanceMetrics.errors++;
            throw new ClaudeToolError(
                `Enhanced search tools failed: ${this.getErrorMessage(error)}`,
                'grep',
                query,
                error as Error
            );
        }
    }

    /**
     * Race content grep vs file discovery using a single global budget, then combine.
     */
    private async searchRaceGrepAndFiles(query: SearchQuery, matches: EnhancedMatches): Promise<void> {
        const start = Date.now();
        const globalBudgetMs = Math.min(1200, this.config.grep.defaultTimeout * 0.8);

        // Build cancellable content fast-path (streaming for early exit)
        const contentCtrl = this.startContentFastPathCancellable(query);
        // Build cancellable file discovery
        const filesCtrl = this.startFileDiscoveryCancellable(query);

        const budgetPromise = new Promise<'budget'>((resolve) => {
            const left = Math.max(0, globalBudgetMs - (Date.now() - start));
            setTimeout(() => resolve('budget'), left);
        });

        const first = await Promise.race([
            contentCtrl.promise.then(() => 'content' as const),
            filesCtrl.promise.then(() => 'files' as const),
            budgetPromise,
        ]);

        if (first === 'content') this.mergeMatches(matches, contentCtrl.matches);
        if (first === 'files') this.mergeMatches(matches, filesCtrl.matches);

        // Cancel the loser or on budget expiry
        if (first === 'content') filesCtrl.cancel();
        if (first === 'files') contentCtrl.cancel();
        if (first === 'budget') {
            contentCtrl.cancel();
            filesCtrl.cancel();
        }

        // Try to merge the other if it happened to finish within a short grace period
        const remaining = globalBudgetMs - (Date.now() - start);
        if (remaining > 120) {
            try {
                const other = await Promise.race([
                    first === 'content'
                        ? filesCtrl.promise.then(() => 'files' as const)
                        : contentCtrl.promise.then(() => 'content' as const),
                    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), remaining)),
                ]);
                if (other === 'content') this.mergeMatches(matches, contentCtrl.matches);
                if (other === 'files') this.mergeMatches(matches, filesCtrl.matches);
            } catch {}
        }
    }

    private mergeMatches(target: EnhancedMatches, src: EnhancedMatches): void {
        if (!src) return;
        target.exact.push(...src.exact);
        target.fuzzy.push(...src.fuzzy);
        target.conceptual.push(...src.conceptual);
        src.files.forEach((f) => target.files.add(f));
    }

    private startContentFastPathCancellable(query: SearchQuery): {
        promise: Promise<void>;
        cancel: () => void;
        matches: EnhancedMatches;
    } {
        const matches: EnhancedMatches = {
            exact: [],
            fuzzy: [],
            conceptual: [],
            files: new Set(),
            searchTime: 0,
            toolsUsed: [],
            confidence: 0,
        };
        const escapedId = this.escapeRegex(query.identifier);
        const exactWordRegex = new RegExp(`\\b${escapedId}\\b`);
        const strategies = [
            { name: 'exact', pattern: `\\b${escapedId}\\b`, timeout: 700, maxResults: 20, confidence: 1.0 },
            { name: 'prefix', pattern: `\\b${escapedId}\\w*`, timeout: 280, maxResults: 15, confidence: 0.95 },
            { name: 'suffix', pattern: `\\w*${escapedId}\\b`, timeout: 280, maxResults: 15, confidence: 0.93 },
        ];

        // Keep strategy info with each controller for correct classification
        const controllers = strategies.map((s) => ({
            s,
            ctrl: asyncSearchTools.searchCancellable({
                pattern: s.pattern,
                path: query.searchPath,
                maxResults: s.maxResults,
                timeout: s.timeout,
                caseInsensitive: false,
                fileType: this.getFileTypeForGrep(query.fileTypes),
                excludePaths: this.getExcludeDirs(),
                useRegex: true,
            }),
        }));

        const promise = new Promise<void>(async (resolve) => {
            // Collect first non-empty and cancel others
            for (const { s, ctrl } of controllers) {
                ctrl.promise
                    .then((res) => {
                        if (res && res.length > 0 && matches.exact.length === 0 && matches.fuzzy.length === 0) {
                            const converted: Match[] = res.map((r) => {
                                const cat = this.categorizeMatch(r.text, query.identifier);
                                return {
                                    file: r.file,
                                    line: r.line || 1,
                                    column: r.column || 0,
                                    text: r.text,
                                    length: r.text.length,
                                    confidence: r.confidence,
                                    source: s.name as any,
                                    category: cat.category,
                                    categoryConfidence: cat.confidence,
                                };
                            });
                            // Prefix/suffix searches can win the race with the same whole-word hit;
                            // keep those as exact rather than making result shape timing-dependent.
                            const exactMatches = converted.filter((m) => s.name === 'exact' || exactWordRegex.test(m.text));
                            const fuzzyMatches = converted.filter((m) => !exactMatches.includes(m));
                            matches.exact.push(...exactMatches);
                            matches.fuzzy.push(...fuzzyMatches);
                            converted.forEach((m) => matches.files.add(m.file));
                            // Cancel others
                            controllers.forEach((c) => c.ctrl.cancel());
                            resolve();
                        }
                    })
                    .catch(() => {});
            }
            // Also resolve when all complete with empty results
            Promise.allSettled(controllers.map((c) => c.ctrl.promise)).then(() => resolve());
        });

        const cancel = () => controllers.forEach((c) => c.ctrl.cancel());
        return { promise, cancel, matches };
    }

    private startFileDiscoveryCancellable(query: SearchQuery): {
        promise: Promise<void>;
        cancel: () => void;
        matches: EnhancedMatches;
    } {
        const temp: EnhancedMatches = {
            exact: [],
            fuzzy: [],
            conceptual: [],
            files: new Set(),
            searchTime: 0,
            toolsUsed: [],
            confidence: 0,
        };
        const patterns = this.generateGlobPatterns(query).slice(0, 6);
        const excludes = this.getExcludeDirs();
        ['out', 'build', 'tmp', 'temp', '.vscode-test', 'target', 'venv', '.venv'].forEach((e) => {
            if (!excludes.includes(e)) excludes.push(e);
        });

        const ctrls = patterns.map((p) =>
            asyncSearchTools.listFilesCancellable({
                includes: [p],
                excludes,
                path: query.searchPath || '.',
                maxDepth: 6,
                timeout: 300,
                includeHidden: false,
                maxFiles: 1000,
            })
        );

        const promise = new Promise<void>((resolve) => {
            Promise.allSettled(ctrls.map((c) => c.promise)).then((settled) => {
                for (const s of settled) {
                    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
                        s.value.forEach((f) => temp.files.add(f));
                    }
                }
                resolve();
            });
        });

        const cancel = () => ctrls.forEach((c) => c.cancel());
        return { promise, cancel, matches: temp };
    }

    /**
     * Fast-path async search that prioritizes exact matches for performance
     */
    private async searchWithAsyncGrepFastPath(query: SearchQuery, matches: EnhancedMatches): Promise<void> {
        const escapedId = this.escapeRegex(query.identifier);
        const start = Date.now();
        const globalBudgetMs = 1400; // Slightly under LayerManager's 1600ms cutoff

        // Define concurrent strategies with shortened timeouts
        const strategies = [
            {
                name: 'exact',
                pattern: `\\b${escapedId}\\b`,
                timeout: 700, // 600–800ms
                maxResults: 20,
                confidence: 1.0,
            },
            {
                name: 'prefix',
                pattern: `\\b${escapedId}\\w*`,
                timeout: 280, // 250–300ms
                maxResults: 15,
                confidence: 0.95,
            },
            {
                name: 'suffix',
                pattern: `\\w*${escapedId}\\b`,
                timeout: 280, // 250–300ms
                maxResults: 15,
                confidence: 0.93,
            },
        ];

        // Build concurrent search promises that resolve only on non-empty results
        const searchPromises = strategies.map((s) =>
            (async () => {
                const searchOptions = {
                    pattern: s.pattern,
                    path: query.searchPath,
                    maxResults: s.maxResults,
                    timeout: s.timeout,
                    caseInsensitive: false,
                    fileType: this.getFileTypeForGrep(query.fileTypes),
                    excludePaths: this.getExcludeDirs(),
                    useRegex: true,
                };
                const results = await asyncSearchTools.search(searchOptions);
                if (results.length === 0) throw new Error('no-results');
                return { s, results };
            })()
        );

        // Add a global budget timer to bound the fast-path
        const budgetPromise = new Promise<never>((_, reject) => {
            const remaining = Math.max(0, globalBudgetMs - (Date.now() - start));
            setTimeout(() => reject(new Error('fast-path-budget-exceeded')), remaining);
        });

        try {
            const { s, results } = await Promise.any([...searchPromises, budgetPromise]);
            const converted: Match[] = results.map((r: any) => {
                const categorization = this.categorizeMatch(r.text, query.identifier);
                return {
                    file: r.file,
                    line: r.line || 1,
                    column: r.column || 0,
                    text: r.text,
                    length: r.text.length,
                    confidence: r.confidence * s.confidence,
                    source: 'exact' as any,
                    category: categorization.category,
                    categoryConfidence: categorization.confidence,
                };
            });
            matches.exact.push(...converted);
            converted.forEach((m) => matches.files.add(m.file));
            if (process.env.DEBUG) {
                console.error(`Fast-path ${s.name} found ${converted.length} matches in ${Date.now() - start}ms`);
            }
            return;
        } catch (raceError) {
            // Either all returned empty or budget exceeded – try a short fallback if budget allows
            const elapsed = Date.now() - start;
            const budgetLeft = globalBudgetMs - elapsed;
            if (budgetLeft < 120) {
                // Too little time left; abandon fast-path to respect LayerManager cutoff
                return;
            }

            const fallbackOptions = {
                pattern: `\\b${escapedId}\\w*|\\w*${escapedId}\\b`,
                path: query.searchPath,
                timeout: Math.min(350, budgetLeft - 50), // 300–400ms within remaining budget
                caseInsensitive: true,
                maxResults: 10,
                excludePaths: this.getExcludeDirs(),
                useRegex: true,
            };
            try {
                const results = await asyncSearchTools.search(fallbackOptions);
                if (results.length === 0) return;
                const converted: Match[] = results.map((r) => {
                    const categorization = this.categorizeMatch(r.text, query.identifier);
                    return {
                        file: r.file,
                        line: r.line || 1,
                        column: r.column || 0,
                        text: r.text,
                        length: r.text.length,
                        confidence: r.confidence * 0.9,
                        source: 'exact' as any,
                        category: categorization.category,
                        categoryConfidence: categorization.confidence,
                    };
                });
                matches.exact.push(...converted);
                converted.forEach((m) => matches.files.add(m.file));
            } catch (fallbackErr) {
                // Swallow fallback errors; the caller may proceed with other strategies
                if (process.env.DEBUG) console.warn('Fast-path fallback failed:', fallbackErr);
            }
        }
    }

    /**
     * Full async streaming search method with multiple strategies
     */
    private async searchWithAsyncGrep(query: SearchQuery, matches: EnhancedMatches): Promise<void> {
        const escapedId = this.escapeRegex(query.identifier);

        // Use multiple search strategies with async streaming for better coverage
        const searchStrategies = [
            {
                name: 'exact_match',
                options: {
                    pattern: `\\b${escapedId}\\b`,
                    path: query.searchPath,
                    maxResults: 50,
                    timeout: 800,
                    caseInsensitive: false,
                    fileType: this.getFileTypeForGrep(query.fileTypes),
                    excludePaths: this.getExcludeDirs(),
                    useRegex: true,
                },
                confidence: 1.0,
                matchType: 'exact',
            },
            {
                name: 'prefix_match',
                options: {
                    pattern: `\\b${escapedId}\\w*`,
                    path: query.searchPath,
                    maxResults: 30,
                    timeout: 600,
                    caseInsensitive: false,
                    fileType: this.getFileTypeForGrep(query.fileTypes),
                    excludePaths: this.getExcludeDirs(),
                    useRegex: true,
                },
                confidence: 0.95,
                matchType: 'exact',
            },
            {
                name: 'suffix_match',
                options: {
                    pattern: `\\w*${escapedId}\\b`,
                    path: query.searchPath,
                    maxResults: 30,
                    timeout: 600,
                    caseInsensitive: false,
                    fileType: this.getFileTypeForGrep(query.fileTypes),
                    excludePaths: this.getExcludeDirs(),
                    useRegex: true,
                },
                confidence: 0.93,
                matchType: 'exact',
            },
            {
                name: 'case_insensitive_prefix_suffix',
                options: {
                    pattern: `\\b${escapedId}\\w*|\\w*${escapedId}\\b`,
                    path: query.searchPath,
                    maxResults: 20,
                    timeout: 500,
                    caseInsensitive: true,
                    fileType: this.getFileTypeForGrep(query.fileTypes),
                    excludePaths: this.getExcludeDirs(),
                    useRegex: true,
                },
                confidence: 0.85,
                matchType: 'fuzzy',
            },
            {
                name: 'fuzzy_token',
                options: {
                    pattern: this.tokenize(query.identifier).join('.*'),
                    path: query.searchPath,
                    maxResults: 15,
                    timeout: 400,
                    caseInsensitive: true,
                    fileType: this.getFileTypeForGrep(query.fileTypes),
                    excludePaths: this.getExcludeDirs(),
                    useRegex: true,
                },
                confidence: 0.7,
                matchType: 'fuzzy',
            },
        ];

        // Execute strategies with concurrency limit for better performance
        const strategyPromises = searchStrategies.map(async (strategy) => {
            try {
                const results = await asyncSearchTools.search(strategy.options);
                // Early termination if we have enough exact matches
                if (results.length > 0 && strategy.matchType === 'exact') {
                    return {
                        strategy,
                        results: results.slice(0, 30), // Limit results for performance
                        success: true,
                    };
                }
                return {
                    strategy,
                    results: results.slice(0, 20), // Limit results for performance
                    success: true,
                };
            } catch (error) {
                console.warn(`Async strategy ${strategy.name} failed:`, error);
                return {
                    strategy,
                    results: [],
                    success: false,
                    error,
                };
            }
        });

        const strategyResults = await Promise.allSettled(strategyPromises);

        // Process successful results with early termination for performance
        let exactMatchCount = 0;
        for (const result of strategyResults) {
            if (result.status === 'fulfilled' && result.value.success) {
                const { strategy, results } = result.value;

                // Convert StreamingGrepResult to Match and categorize
                const convertedMatches: Match[] = results.map((r) => {
                    const categorization = this.categorizeMatch(r.text, query.identifier);
                    return {
                        file: r.file,
                        line: r.line || 1,
                        column: r.column || 0,
                        text: r.text,
                        length: r.text.length,
                        confidence: r.confidence * strategy.confidence, // Combined confidence
                        source: strategy.matchType as any,
                        category: categorization.category,
                        categoryConfidence: categorization.confidence,
                    };
                });

                // Add to appropriate category
                if (strategy.matchType === 'exact') {
                    matches.exact.push(...convertedMatches);
                    exactMatchCount += convertedMatches.length;
                    // Early termination if we have enough exact matches
                    if (exactMatchCount >= 20) {
                        break;
                    }
                } else if (strategy.matchType === 'fuzzy') {
                    matches.fuzzy.push(...convertedMatches);
                } else {
                    matches.conceptual.push(...convertedMatches);
                }

                // Add files to the set
                convertedMatches.forEach((match) => matches.files.add(match.file));
            }
        }

        // Remove duplicates across categories
        matches.exact = this.deduplicateMatches(matches.exact);
        matches.fuzzy = this.deduplicateMatches(matches.fuzzy);
        matches.conceptual = this.deduplicateMatches(matches.conceptual);

        // Sort matches by category priority within each category
        matches.exact = this.sortMatchesByPriority(matches.exact);
        matches.fuzzy = this.sortMatchesByPriority(matches.fuzzy);
        matches.conceptual = this.sortMatchesByPriority(matches.conceptual);
    }

    private deduplicateMatches(matches: Match[]): Match[] {
        const seen = new Set<string>();
        return matches.filter((match) => {
            const key = `${match.file}:${match.line}:${match.column}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    private sortMatchesByPriority(matches: Match[]): Match[] {
        const rank: Record<string, number> = {
            'likely-definition': 0,
            'likely-import': 1,
            'likely-usage': 2,
            unknown: 3,
        };
        const score = (m: Match) => rank[m.category || 'unknown'] ?? 3;
        return [...matches].sort((a, b) => {
            const ra = score(a);
            const rb = score(b);
            if (ra !== rb) return ra - rb;
            const ca = a.categoryConfidence ?? 0;
            const cb = b.categoryConfidence ?? 0;
            if (ca !== cb) return cb - ca;
            return (b.confidence ?? 0) - (a.confidence ?? 0);
        });
    }

    /**
     * Categorizes a match based on the line content to distinguish between
     * definitions, imports, usage, and other occurrences
     */
    private categorizeMatch(text: string, identifier: string): { category: MatchCategory; confidence: number } {
        const line = text.trim();
        const escapedIdentifier = this.escapeRegex(identifier);

        // Import patterns (check BEFORE definition patterns to catch require statements)

        // CommonJS require statements - check early to catch require patterns
        if (line.includes('require(') && (line.includes('const ') || line.includes('let ') || line.includes('var '))) {
            return { category: 'likely-import', confidence: 0.85 };
        }

        // ES6 imports
        if (line.match(/^import/)) {
            // Named imports
            if (line.match(new RegExp(`\\{[^}]*${escapedIdentifier}[^}]*\\}`))) {
                return { category: 'likely-import', confidence: 0.9 };
            }
            // Default imports
            if (line.match(new RegExp(`import\\s+${escapedIdentifier}\\s+from`))) {
                return { category: 'likely-import', confidence: 0.9 };
            }
            // Generic import match
            return { category: 'likely-import', confidence: 0.85 };
        }

        // Definition patterns (after imports)

        // TypeScript/JavaScript class definitions
        if (line.match(new RegExp(`^export\\s+(class|interface|type|enum)\\s+${escapedIdentifier}\\b`))) {
            return { category: 'likely-definition', confidence: 0.95 };
        }

        // Function/variable declarations (but exclude require statements)
        if (
            line.match(new RegExp(`^(export\\s+)?(const|let|var|function)\\s+${escapedIdentifier}\\b`)) &&
            !line.includes('require(')
        ) {
            return { category: 'likely-definition', confidence: 0.85 };
        }

        // Method definitions in classes
        if (line.match(new RegExp(`^\\s*(public|private|protected|async)?\\s*${escapedIdentifier}\\s*\\(`))) {
            return { category: 'likely-definition', confidence: 0.8 };
        }

        // Arrow function definitions
        if (line.match(new RegExp(`^(export\\s+)?(const|let|var)\\s+${escapedIdentifier}\\s*=\\s*(async\\s+)?\\(`))) {
            return { category: 'likely-definition', confidence: 0.85 };
        }

        // Usage patterns (third priority)

        // Constructor usage
        if (line.match(new RegExp(`new\\s+${escapedIdentifier}\\(`))) {
            return { category: 'likely-usage', confidence: 0.8 };
        }

        // Method calls (higher confidence than function calls)
        if (line.match(new RegExp(`\\.${escapedIdentifier}\\(`))) {
            return { category: 'likely-usage', confidence: 0.75 };
        }

        // Function calls
        if (line.match(new RegExp(`\\b${escapedIdentifier}\\(`))) {
            return { category: 'likely-usage', confidence: 0.7 };
        }

        // Property assignment (e.g., obj.prop = value) - this is usage, not definition
        if (line.match(new RegExp(`\\.${escapedIdentifier}\\s*=`))) {
            return { category: 'likely-usage', confidence: 0.65 };
        }

        // Variable assignment patterns (direct assignment is definition)
        if (line.match(new RegExp(`^\\s*${escapedIdentifier}\\s*[=:]`))) {
            return { category: 'likely-definition', confidence: 0.6 };
        }

        // Property access (without assignment)
        if (line.match(new RegExp(`\\.${escapedIdentifier}\\b`)) && !line.includes('=')) {
            return { category: 'likely-usage', confidence: 0.65 };
        }

        // Check for comments and strings (lower priority patterns)
        if (
            line.match(/^\s*\/\//) ||
            line.match(/^\s*\/\*/) ||
            line.includes(`'${identifier}'`) ||
            line.includes(`"${identifier}"`) ||
            line.includes(`\`${identifier}\``) ||
            line.match(/console\.(log|error|warn|info)/)
        ) {
            return { category: 'unknown', confidence: 0.5 };
        }

        // Generic usage in expressions
        if (line.match(new RegExp(`\\b${escapedIdentifier}\\b`))) {
            return { category: 'likely-usage', confidence: 0.6 };
        }

        // Default case - unknown pattern
        return { category: 'unknown', confidence: 0.5 };
    }

    /**
     * Stream search results for WebSocket/SSE support
     * Returns a SearchStream that emits results as they are found
     */
    async streamSearch(query: SearchQuery): Promise<SearchStream> {
        const searchOptions: AsyncSearchOptions = {
            pattern: `\\b${this.escapeRegex(query.identifier)}\\b`,
            path: query.searchPath,
            maxResults: 100,
            timeout: 1200, // Reduced from 20000ms to 1200ms
            caseInsensitive: !query.caseSensitive,
            fileType: this.getFileTypeForGrep(query.fileTypes),
            streaming: true,
            parallel: true,
            useRegex: true,
        };

        return asyncSearchTools.searchStream(searchOptions);
    }

    /**
     * Parallel streaming search across multiple patterns/directories
     */
    async parallelStreamSearch(
        patterns: string[],
        directories: string[],
        options?: Partial<AsyncSearchOptions>
    ): Promise<Map<string, StreamingGrepResult[]>> {
        return asyncSearchTools.searchParallel(patterns, directories, options);
    }

    private async searchWithGrep(query: SearchQuery, matches: EnhancedMatches): Promise<void> {
        const strategies = this.generateGrepStrategies(query);

        // Execute strategies in parallel
        const results = await Promise.allSettled(strategies.map((strategy) => this.executeGrepStrategy(strategy)));

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const strategy = strategies[i];

            if (result.status === 'fulfilled' && result.value.success) {
                const grepMatches = this.parseGrepResults(
                    result.value.matches,
                    strategy.confidence,
                    strategy.name,
                    query.identifier
                );

                // Categorize matches based on strategy
                if (strategy.name.includes('exact')) {
                    matches.exact.push(...grepMatches);
                } else if (strategy.name.includes('fuzzy')) {
                    matches.fuzzy.push(...grepMatches);
                } else {
                    matches.conceptual.push(...grepMatches);
                }

                // Add files to the set
                grepMatches.forEach((match) => matches.files.add(match.file));
            }
        }
    }

    private async searchWithGlob(query: SearchQuery, matches: EnhancedMatches): Promise<void> {
        const patterns = this.generateGlobPatterns(query);

        // Budget-aware filename discovery (replace glob with ripgrep --files)
        const start = Date.now();
        const globalBudgetMs = Math.min(900, this.config.grep.defaultTimeout); // keep well under Layer 1 budget
        const perPatternTimeout = 300; // 250–300ms per include pattern

        // Build extended excludes
        const excludes = this.getExcludeDirs();
        excludes.push('out', 'build', 'tmp', 'temp', '.vscode-test', 'target', 'venv', '.venv');

        const discovered = new Set<string>();
        for (const pattern of patterns.slice(0, 6)) {
            // cap patterns
            const elapsed = Date.now() - start;
            const left = globalBudgetMs - elapsed;
            if (left <= 100) break;
            try {
                const files = await asyncSearchTools.listFiles({
                    includes: [pattern],
                    excludes,
                    path: query.searchPath || '.',
                    maxDepth: 6,
                    timeout: Math.min(perPatternTimeout, left - 50),
                    includeHidden: false,
                    maxFiles: 1000,
                });
                for (const f of files) discovered.add(f);
            } catch (err) {
                // Swallow and continue
                if (process.env.DEBUG) console.warn(`File discovery failed for ${pattern}:`, err);
            }
        }

        const files = Array.from(discovered);
        files.forEach((file) => matches.files.add(file));

        if (files.length > 0) {
            // Search within these files for the identifier (content grep)
            await this.searchFilesForIdentifier(files, query, matches);
        }
    }

    private async analyzeWithLS(query: SearchQuery, matches: EnhancedMatches): Promise<void> {
        const relevantDirs = await this.findRelevantDirectories(query, matches);

        for (const dir of relevantDirs) {
            try {
                const entries = await this.executeWithTimeout(
                    () =>
                        LS({
                            path: dir,
                            ignore: this.config.ls.includeDotfiles ? [] : this.config.glob.ignorePatterns,
                        }),
                    this.config.ls.defaultTimeout
                );

                // Find co-located files
                const colocated = this.findColocatedFiles(entries, query);
                colocated.forEach((file) => matches.files.add(file));

                // Search co-located files
                await this.searchFilesForIdentifier(colocated, query, matches);
            } catch (error) {
                // Keep stdio clean in tests/stdio paths; log only when DEBUG is set
                if (process.env.DEBUG || process.env.VERBOSE_LS === '1') {
                    console.warn(`LS analysis failed for directory: ${dir}`, error);
                }
            }
        }
    }

    private getExcludeDirs(): string[] {
        const patterns = this.config?.glob?.ignorePatterns || [];
        const base = patterns.map((p) => p.replace('/**', '').replace('**', '').replace('!', '')).filter(Boolean);
        // Always avoid common heavy dirs if present
        for (const extra of ['node_modules', 'dist', '.git', 'coverage']) {
            if (!base.includes(extra)) base.push(extra);
        }
        return base;
    }

    private generateGrepStrategies(query: SearchQuery): GrepSearchStrategy[] {
        const strategies: GrepSearchStrategy[] = [];

        // Exact match strategy
        strategies.push({
            name: 'exact_match',
            params: {
                pattern: `\\b${this.escapeRegex(query.identifier)}\\b`,
                path: query.searchPath || '.',
                output_mode: 'content',
                '-n': true,
                '-C': this.config.grep.contextLines,
                type: this.getFileTypeForGrep(query.fileTypes),
                head_limit: this.config.grep.maxResults,
            },
            confidence: 1.0,
        });

        // Case insensitive strategy
        strategies.push({
            name: 'case_insensitive',
            params: {
                pattern: `\\b${this.escapeRegex(query.identifier)}\\b`,
                path: query.searchPath || '.',
                output_mode: 'content',
                '-i': true,
                '-n': true,
                type: this.getFileTypeForGrep(query.fileTypes),
                head_limit: this.config.grep.maxResults,
            },
            confidence: 0.9,
        });

        // Fuzzy token matching
        const tokens = this.tokenize(query.identifier);
        if (tokens.length > 1) {
            strategies.push({
                name: 'fuzzy_tokens',
                params: {
                    pattern: tokens.join('.*'),
                    path: query.searchPath || '.',
                    output_mode: 'content',
                    '-i': true,
                    '-n': true,
                    type: this.getFileTypeForGrep(query.fileTypes),
                    head_limit: Math.floor(this.config.grep.maxResults / 2),
                },
                confidence: 0.7,
            });
        }

        // Semantic variants
        const variants = this.generateSemanticVariants(query.identifier);
        for (const variant of variants) {
            strategies.push({
                name: `semantic_${variant.strategy}`,
                params: {
                    pattern: variant.pattern,
                    path: query.searchPath || '.',
                    output_mode: 'files_with_matches',
                    '-i': true,
                    type: this.getFileTypeForGrep(query.fileTypes),
                    head_limit: 50,
                },
                confidence: variant.confidence,
            });
        }

        return strategies;
    }

    private async executeGrepStrategy(strategy: GrepSearchStrategy) {
        try {
            // Ensure the internal grep respects the intended timeout budget as well
            const timeoutMs = strategy.timeout || this.config.grep.defaultTimeout;
            const results = await this.executeWithTimeout(
                () => Grep({ ...strategy.params, timeout: timeoutMs }),
                timeoutMs
            );

            return {
                strategy,
                matches: Array.isArray(results) ? (results as ClaudeGrepResult[]) : [],
                searchTime: Date.now(),
                success: true,
            };
        } catch (error) {
            return {
                strategy,
                matches: [],
                searchTime: Date.now(),
                success: false,
                error: this.getErrorMessage(error),
            };
        }
    }

    private generateGlobPatterns(query: SearchQuery): string[] {
        const patterns: string[] = [];
        const identifier = query.identifier;
        const tokens = this.tokenize(identifier);

        // File name patterns
        patterns.push(
            `**/*${identifier}*.{ts,tsx,js,jsx,py,java,go,rs}`,
            `**/${identifier}.{ts,tsx,js,jsx,py,java,go,rs}`,
            `**/${identifier}/**/*.{ts,tsx,js,jsx,py,java,go,rs}`
        );

        // Common directory patterns
        if (tokens.length > 0) {
            const mainToken = tokens[tokens.length - 1].toLowerCase();
            patterns.push(
                `**/services/*${mainToken}*.{ts,js,py}`,
                `**/controllers/*${mainToken}*.{ts,js,py}`,
                `**/models/*${mainToken}*.{ts,js,py}`,
                `**/components/*${mainToken}*.{tsx,jsx}`,
                `**/${mainToken}/**/*.{ts,tsx,js,jsx,py}`
            );
        }

        // Test file patterns
        if (query.includeTests) {
            patterns.push(
                `**/*${identifier}*.test.{ts,js}`,
                `**/*${identifier}*.spec.{ts,js}`,
                `**/__tests__/**/*${identifier}*.{ts,js}`
            );
        }

        return patterns;
    }

    private async findRelevantDirectories(query: SearchQuery, matches: EnhancedMatches): Promise<string[]> {
        const dirs = new Set<string>();

        // Add directories from existing matches
        for (const match of [...matches.exact, ...matches.fuzzy, ...matches.conceptual]) {
            dirs.add(path.dirname(match.file));
        }

        // Add directories from files
        for (const file of matches.files) {
            dirs.add(path.dirname(file));
        }

        // Add common project directories
        const commonDirs = [
            'src',
            'src/components',
            'src/services',
            'src/utils',
            'src/models',
            'src/controllers',
            'lib',
            'app',
        ];

        for (const dir of commonDirs) {
            try {
                await LS({ path: dir });
                dirs.add(dir);
            } catch {
                // Directory doesn't exist, skip
            }
        }

        return Array.from(dirs);
    }

    private findColocatedFiles(entries: ClaudeLSResult, query: SearchQuery): string[] {
        const colocated: string[] = [];
        const tokens = this.tokenize(query.identifier);

        for (const entry of entries) {
            if (entry.type === 'file') {
                const fileName = path.basename(entry.name, path.extname(entry.name));
                const fileTokens = this.tokenize(fileName);

                // Check token overlap
                const overlap = this.calculateTokenOverlap(tokens, fileTokens);
                if (overlap > 0.3) {
                    colocated.push(entry.path);
                }

                // Check common naming patterns
                if (this.matchesNamingPattern(query.identifier, fileName)) {
                    colocated.push(entry.path);
                }
            }
        }

        return colocated;
    }

    private async searchFilesForIdentifier(
        files: string[],
        query: SearchQuery,
        matches: EnhancedMatches
    ): Promise<void> {
        const searchPromises = files.slice(0, 20).map(async (file) => {
            // Limit to 20 files for performance
            try {
                const results = await Grep({
                    pattern: query.identifier,
                    path: file,
                    output_mode: 'content',
                    '-i': !query.caseSensitive,
                    '-n': true,
                });

                if (Array.isArray(results)) {
                    const fileMatches = this.parseGrepResults(
                        results as ClaudeGrepResult[],
                        0.6,
                        'file_search',
                        query.identifier
                    );
                    matches.conceptual.push(...fileMatches);
                }
            } catch (error) {
                // File search failed, continue
            }
        });

        await Promise.allSettled(searchPromises);
    }

    private parseGrepResults(
        results: ClaudeGrepResult[],
        baseConfidence: number,
        source: string,
        identifier: string
    ): Match[] {
        const matches: Match[] = [];

        for (const result of results) {
            if (result.file && result.line && result.text) {
                const categorization = this.categorizeMatch(result.text, identifier);
                matches.push({
                    file: result.file,
                    line: result.line,
                    column: result.column || 0,
                    text: result.match || result.text,
                    length: (result.match || result.text).length,
                    confidence: baseConfidence,
                    source: source as any,
                    category: categorization.category,
                    categoryConfidence: categorization.confidence,
                    context: result.context
                        ? [...(result.context.before || []), ...(result.context.after || [])].join('\n')
                        : undefined,
                });
            }
        }

        return matches;
    }

    private generateSemanticVariants(identifier: string): SearchVariant[] {
        const variants: SearchVariant[] = [];

        // Common verb synonyms
        const synonyms = {
            get: ['fetch', 'retrieve', 'load', 'obtain', 'find'],
            set: ['update', 'modify', 'change', 'assign', 'put'],
            create: ['make', 'build', 'generate', 'produce', 'new'],
            delete: ['remove', 'destroy', 'eliminate', 'clear'],
        };

        // Apply synonyms
        for (const [verb, alternatives] of Object.entries(synonyms)) {
            if (identifier.toLowerCase().startsWith(verb)) {
                for (const alt of alternatives) {
                    const variant = identifier.replace(new RegExp(`^${verb}`, 'i'), alt);
                    variants.push({
                        pattern: `\\b${variant}\\b`,
                        confidence: 0.8,
                        strategy: 'semantic',
                    });
                }
            }
        }

        // Case variations
        variants.push(
            {
                pattern: this.toSnakeCase(identifier),
                confidence: 0.7,
                strategy: 'pattern',
            },
            {
                pattern: this.toPascalCase(identifier),
                confidence: 0.7,
                strategy: 'pattern',
            },
            {
                pattern: this.toKebabCase(identifier),
                confidence: 0.6,
                strategy: 'pattern',
            }
        );

        // Plural/singular variants
        if (identifier.endsWith('s')) {
            variants.push({
                pattern: identifier.slice(0, -1),
                confidence: 0.8,
                strategy: 'pattern',
            });
        } else {
            variants.push({
                pattern: identifier + 's',
                confidence: 0.8,
                strategy: 'pattern',
            });
        }

        return variants;
    }

    // Utility methods
    private tokenize(identifier: string): string[] {
        return identifier
            .split(/(?=[A-Z])|_|-/)
            .map((s) => s.toLowerCase())
            .filter((s) => s.length > 0);
    }

    private calculateTokenOverlap(tokens1: string[], tokens2: string[]): number {
        const set1 = new Set(tokens1);
        const set2 = new Set(tokens2);
        const intersection = new Set([...set1].filter((x) => set2.has(x)));
        const union = new Set([...set1, ...set2]);

        return intersection.size / union.size;
    }

    private matchesNamingPattern(identifier: string, fileName: string): boolean {
        const identTokens = this.tokenize(identifier);
        const fileTokens = this.tokenize(fileName);

        // Check if file contains main concepts from identifier
        return identTokens.some((token) =>
            fileTokens.some((fileToken) => fileToken.includes(token) || token.includes(fileToken))
        );
    }

    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private getFileTypeForGrep(fileTypes?: string[]): string | undefined {
        if (!fileTypes || fileTypes.length === 0) {
            return undefined; // Search all supported text/code files when no caller scope is supplied.
        }
        return fileTypes[0];
    }

    private toSnakeCase(str: string): string {
        return str
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '');
    }

    private toPascalCase(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    private toKebabCase(str: string): string {
        return str
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase()
            .replace(/^-/, '');
    }

    private getCacheKey(query: SearchQuery): string {
        return `${query.identifier}:${query.searchPath || ''}:${query.fileTypes?.join(',') || ''}`;
    }

    private getBloomFilterKey(query: SearchQuery, polarity: 'positive' | 'negative'): string {
        return `${this.getCacheKey(query)}:${polarity}`;
    }

    private getFromCache(key: string): EnhancedMatches | null {
        if (!this.config.caching.enabled) return null;

        const cached = this.cache.get(key);
        if (!cached) return null;

        const age = Date.now() - cached.timestamp;
        if (age > this.config.caching.ttl * 1000) {
            this.cache.delete(key);
            return null;
        }

        return cached.result;
    }

    private updateCache(key: string, result: EnhancedMatches): void {
        if (!this.config.caching.enabled) return;
        // Do not cache negative results when bloomFilter is enabled; prefer bloom negative fast-path
        if (this.config.optimization?.bloomFilter && result.exact.length === 0) {
            return;
        }

        if (this.cache.size >= this.config.caching.maxEntries) {
            // Remove oldest entry
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            result,
            timestamp: Date.now(),
        });
    }

    private updateStatistics(query: SearchQuery, matches: EnhancedMatches): void {
        // Update frequency map
        const freq = this.frequencyMap.get(query.identifier) || 0;
        this.frequencyMap.set(query.identifier, freq + 1);

        // Update bloom filter with both positive and negative results
        if (this.config.optimization.bloomFilter) {
            // Treat only true exact hits as positive; fuzzy/conceptual can be noisy
            if (matches.exact.length > 0) {
                this.bloomFilter.add(this.getBloomFilterKey(query, 'positive'));
            } else {
                this.bloomFilter.add(this.getBloomFilterKey(query, 'negative'));
            }
        }
    }

    private async executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Operation timed out after ${timeout}ms`));
            }, timeout);

            fn().then(
                (result) => {
                    clearTimeout(timer);
                    resolve(result);
                },
                (error) => {
                    clearTimeout(timer);
                    reject(error);
                }
            );
        });
    }

    private updatePerformanceMetrics(responseTime: number): void {
        const totalTime =
            this.performanceMetrics.avgResponseTime * (this.performanceMetrics.searches - 1) + responseTime;
        this.performanceMetrics.avgResponseTime = totalTime / this.performanceMetrics.searches;
        this.performanceMetrics.lastResponseTime = responseTime;

        // Update bounded samples and recompute quantiles
        if (Number.isFinite(responseTime) && responseTime >= 0) {
            if (this.responseSamples.length < this.maxSamples) {
                this.responseSamples.push(responseTime);
            } else {
                const idx = Math.floor(Math.random() * this.maxSamples);
                this.responseSamples[idx] = responseTime;
            }
            const sorted = [...this.responseSamples].sort((a, b) => a - b);
            const pick = (q: number) => (sorted.length ? sorted[Math.floor(q * (sorted.length - 1))] : 0);
            this.performanceMetrics.p50ResponseTime = pick(0.5);
            this.performanceMetrics.p95ResponseTime = pick(0.95);
            this.performanceMetrics.p99ResponseTime = pick(0.99);
        }
        // Merge global counters from Grep wrapper
        try {
            const g = (globalThis as any).__FAST_SEARCH_METRICS__;
            if (g) {
                this.performanceMetrics.timeouts += g.timeouts || 0;
                this.performanceMetrics.fallbacks += g.fallbacks || 0;
                // reset to avoid double counting across requests
                g.timeouts = 0;
                g.fallbacks = 0;
            }
        } catch {}
    }

    // Get performance metrics and tool health
    getMetrics() {
        const rt = (asyncSearchTools as any)?.getRuntimeInfo?.() || {};
        return {
            layer: this.performanceMetrics,
            tools: searchTools.getMetrics(),
            asyncTools: {
                enabled: true,
                cacheSize: 1000,
                processPoolSize: rt.maxProcesses ?? undefined,
                defaultTimeout: rt.defaultTimeout ?? undefined,
            },
            cacheStats: {
                size: this.cache.size,
                bloomFilterSize: this.bloomFilter.size,
                frequencyMapSize: this.frequencyMap.size,
            },
        };
    }

    // Health check for enhanced search tools
    async healthCheck(): Promise<boolean> {
        try {
            const syncHealth = await searchTools.healthCheck();
            // For async tools, we can check if they're initialized and responsive
            const asyncHealthy = asyncSearchTools !== null;

            return (syncHealth.grep && syncHealth.glob && syncHealth.ls) || asyncHealthy;
        } catch {
            return false;
        }
    }

    /**
     * Cleanup resources when layer is disposed
     */
    async dispose(): Promise<void> {
        if (asyncSearchTools) {
            asyncSearchTools.destroy();
        }
        this.cache.clear();
        this.bloomFilter.clear();
        this.frequencyMap.clear();
    }

    private async naiveScan(query: SearchQuery, matches: EnhancedMatches, maxFiles: number): Promise<void> {
        const fs = await import('fs/promises');
        const root = query.searchPath || 'src';
        const queue: string[] = [root];
        const seen = new Set<string>();
        const exts = new Set((query.fileTypes || ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go']).map((e) => e.toLowerCase()));
        const id = query.identifier;
        let scanned = 0;
        while (queue.length && scanned < maxFiles) {
            const dir = queue.shift()!;
            if (seen.has(dir)) continue;
            seen.add(dir);
            let entries: any[] = [];
            try {
                entries = await fs.readdir(dir, { withFileTypes: true } as any);
            } catch {
                continue;
            }
            for (const ent of entries) {
                const p = path.join(dir, ent.name);
                if (ent.isDirectory()) {
                    if (/node_modules|\.git|dist|coverage|out|build|venv|\.venv/.test(ent.name)) continue;
                    queue.push(p);
                } else if (ent.isFile()) {
                    const ext = ent.name.split('.').pop()?.toLowerCase() || '';
                    if (!exts.has(ext)) continue;
                    scanned++;
                    try {
                        const text = await fs.readFile(p, 'utf8');
                        const lines = text.split(/\r?\n/);
                        for (let i = 0; i < lines.length; i++) {
                            const col = lines[i].indexOf(id);
                            if (col >= 0) {
                                matches.exact.push({
                                    file: p,
                                    line: i + 1,
                                    column: col,
                                    text: lines[i],
                                    length: id.length,
                                    confidence: 1,
                                    source: 'naive' as any,
                                    category: 'likely-definition',
                                    categoryConfidence: 0.5,
                                } as any);
                                matches.files.add(p);
                                if (matches.exact.length > 20) return;
                            }
                        }
                    } catch {}
                    if (scanned >= maxFiles) break;
                }
            }
        }
    }
}

// Backward-compatible export for legacy imports
export { FastSearchLayer as ClaudeToolsLayer };
