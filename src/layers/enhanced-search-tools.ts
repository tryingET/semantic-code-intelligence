// Enhanced Search Tools - Independent implementations of Grep, Glob, and LS
// These tools provide advanced functionality without relying on Claude CLI
// Now with smart caching that handles file changes intelligently

import { spawn } from 'child_process';
// Import Dirent from fs for TypeScript compatibility
import type { Dirent } from 'fs';
import * as fsSync from 'fs';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import { glob as fastGlob } from 'glob';
import * as path from 'path';
import { createInterface } from 'readline';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';
import { createSmartCache, type SmartCache, type SmartCacheConfig } from './smart-cache.js';

const activeChildProcesses = new Set<ReturnType<typeof spawn>>();
let exitHookInstalled = false;
const ensureExitHook = () => {
    if (exitHookInstalled) return;
    exitHookInstalled = true;
    process.once('exit', () => {
        for (const p of activeChildProcesses) {
            try {
                p.kill();
            } catch {}
        }
    });
};

// Types for enhanced search tools
export interface EnhancedGrepParams {
    pattern: string;
    path?: string;
    outputMode?: 'content' | 'files_with_matches' | 'count';
    type?: string;
    caseInsensitive?: boolean;
    lineNumbers?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    multiline?: boolean;
    headLimit?: number;
    timeout?: number;
    maxFileSize?: number;
    encoding?: string;
}

export interface EnhancedGrepResult {
    file: string;
    line?: number;
    column?: number;
    text?: string;
    match?: string;
    context?: {
        before?: string[];
        after?: string[];
    };
    confidence?: number;
    metadata?: {
        fileSize?: number;
        modified?: Date;
        encoding?: string;
    };
}

export interface EnhancedGlobParams {
    pattern: string;
    path?: string;
    sortByModified?: boolean;
    followSymlinks?: boolean;
    maxDepth?: number;
    ignorePatterns?: string[];
    includeHidden?: boolean;
    includeDirectories?: boolean;
    timeout?: number;
}

export interface EnhancedGlobResult {
    files: string[];
    directories?: string[];
    metadata?: {
        totalFiles: number;
        searchTime: number;
        skippedFiles: number;
        errors: string[];
    };
}

export interface EnhancedLSParams {
    path: string;
    recursive?: boolean;
    maxDepth?: number;
    includeHidden?: boolean;
    followSymlinks?: boolean;
    ignorePatterns?: string[];
    includeMetadata?: boolean;
    sortBy?: 'name' | 'size' | 'modified';
    sortOrder?: 'asc' | 'desc';
    timeout?: number;
}

export interface EnhancedLSEntry {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'symlink' | 'unknown';
    size?: number;
    modified?: Date;
    permissions?: string;
    isExecutable?: boolean;
    isReadable?: boolean;
    isWritable?: boolean;
    extension?: string;
    mimeType?: string;
}

export interface EnhancedLSResult {
    entries: EnhancedLSEntry[];
    metadata?: {
        totalEntries: number;
        searchTime: number;
        errors: string[];
        path: string;
    };
}

// Smart cache configuration for enhanced tools
export interface EnhancedToolsConfig {
    enableSmartCache: boolean;
    cacheConfig?: Partial<SmartCacheConfig>;
    // Legacy config for backward compatibility
    enableCache?: boolean;
    maxFileSize?: number;
    timeout?: number;
    maxConcurrentFiles?: number;
    useRipgrep?: boolean;
    fallbackToNodeGrep?: boolean;
}

// Performance monitoring
export interface PerformanceMetrics {
    searchCount: number;
    totalTime: number;
    averageTime: number;
    cacheHits: number;
    errors: number;
}

// Legacy cache interface for backward compatibility
interface LegacySearchCache<T> {
    get(key: string): T | null;
    set(key: string, data: T, ttl?: number, filePath?: string): void;
    clear(): void;
    size(): number;
    getStats(): { hits: number; misses: number; hitRate: number; evictions?: number };
}

// Smart cache adapter that wraps SmartCache to provide legacy synchronous semantics.
class SmartCacheAdapter<T> implements LegacySearchCache<T> {
    private syncCache = new Map<
        string,
        {
            data: T;
            timestamp: number;
            ttl: number;
            filePath?: string;
            fileModTime?: number;
            fileSize?: number;
            dependencies?: Array<{ path: string; fileModTime: number; fileSize: number }>;
        }
    >();
    private stats = { hits: 0, misses: 0, evictions: 0 };

    constructor(private smartCache: SmartCache<T>) {}

    get(key: string): T | null {
        const entry = this.syncCache.get(key);
        if (!entry) {
            this.stats.misses++;
            return null;
        }

        if (Date.now() - entry.timestamp > entry.ttl || this.hasFileChanged(entry)) {
            this.syncCache.delete(key);
            void this.smartCache.invalidate(key, 'sync_cache_invalidated');
            this.stats.misses++;
            return null;
        }

        this.stats.hits++;
        return entry.data;
    }

    set(key: string, data: T, ttl?: number, filePath?: string): void {
        const actualTtl = ttl || 300000; // 5 minutes default
        const metadata = this.readFileMetadata(filePath);
        if (metadata.uncacheable) {
            return;
        }

        this.evictIfNecessary();
        this.syncCache.set(key, {
            data,
            timestamp: Date.now(),
            ttl: actualTtl,
            filePath: metadata.filePath,
            fileModTime: metadata.fileModTime,
            fileSize: metadata.fileSize,
            dependencies: metadata.dependencies,
        });

        this.smartCache.set(key, data, { ttl: actualTtl, filePath: metadata.filePath }).catch((error) => {
            console.warn('SmartCache set failed:', error);
        });
    }

    clear(): void {
        this.syncCache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0 };

        this.smartCache.clear().catch((error) => {
            console.warn('SmartCache clear failed:', error);
        });
    }

    size(): number {
        return this.syncCache.size;
    }

    getStats(): { hits: number; misses: number; hitRate: number; evictions?: number } {
        const total = this.stats.hits + this.stats.misses;
        return {
            ...this.stats,
            hitRate: total > 0 ? this.stats.hits / total : 0,
        };
    }

    private readFileMetadata(filePath?: string): {
        filePath?: string;
        fileModTime?: number;
        fileSize?: number;
        dependencies?: Array<{ path: string; fileModTime: number; fileSize: number }>;
        uncacheable?: boolean;
    } {
        if (!filePath) return {};
        const normalized = path.resolve(filePath);
        try {
            const stat = fsSync.statSync(normalized);
            if (stat.isDirectory()) {
                const dependencies = this.snapshotDirectory(normalized);
                return dependencies
                    ? { filePath: normalized, fileModTime: stat.mtimeMs, fileSize: stat.size, dependencies }
                    : { filePath: normalized, uncacheable: true };
            }
            return { filePath: normalized, fileModTime: stat.mtimeMs, fileSize: stat.size };
        } catch {
            return { filePath: normalized };
        }
    }

    private snapshotDirectory(root: string): Array<{ path: string; fileModTime: number; fileSize: number }> | null {
        const maxDependencies = 2000;
        const dependencies: Array<{ path: string; fileModTime: number; fileSize: number }> = [];
        const visit = (candidate: string): boolean => {
            if (dependencies.length >= maxDependencies) return false;
            let stat: fsSync.Stats;
            try {
                stat = fsSync.lstatSync(candidate);
            } catch {
                return true;
            }

            dependencies.push({ path: candidate, fileModTime: stat.mtimeMs, fileSize: stat.size });
            if (!stat.isDirectory() || stat.isSymbolicLink()) return true;

            let entries: string[];
            try {
                entries = fsSync.readdirSync(candidate);
            } catch {
                return true;
            }

            for (const entry of entries) {
                if (!visit(path.join(candidate, entry))) return false;
            }
            return true;
        };

        return visit(root) ? dependencies : null;
    }

    private hasFileChanged(entry: {
        filePath?: string;
        fileModTime?: number;
        fileSize?: number;
        dependencies?: Array<{ path: string; fileModTime: number; fileSize: number }>;
    }): boolean {
        if (entry.dependencies) {
            for (const dependency of entry.dependencies) {
                try {
                    const stat = fsSync.lstatSync(dependency.path);
                    if (stat.mtimeMs !== dependency.fileModTime || stat.size !== dependency.fileSize) {
                        return true;
                    }
                } catch {
                    return true;
                }
            }
            return false;
        }

        if (!entry.filePath || entry.fileModTime === undefined) return false;
        try {
            const stat = fsSync.statSync(entry.filePath);
            return stat.mtimeMs !== entry.fileModTime || stat.size !== entry.fileSize;
        } catch {
            return true;
        }
    }

    private evictIfNecessary(): void {
        const maxEntries = (this.smartCache as any)?.config?.maxSize || 1000;
        while (this.syncCache.size >= maxEntries) {
            const oldest = this.syncCache.keys().next().value;
            if (!oldest) break;
            this.syncCache.delete(oldest);
            this.stats.evictions++;
            void this.smartCache.invalidate(oldest, 'sync_cache_lru_eviction');
        }
    }
}

// Enhanced Grep implementation with smart caching
export class EnhancedGrep {
    public cache: LegacySearchCache<EnhancedGrepResult[]>;
    public smartCache?: SmartCache<EnhancedGrepResult[]>;
    private config: EnhancedToolsConfig;
    private metrics: PerformanceMetrics = {
        searchCount: 0,
        totalTime: 0,
        averageTime: 0,
        cacheHits: 0,
        errors: 0,
    };

    constructor(config: Partial<EnhancedToolsConfig> = {}) {
        // Merge with defaults
        this.config = {
            enableSmartCache: true,
            enableCache: true,
            maxFileSize: 50 * 1024 * 1024, // 50MB
            timeout: 30000, // 30 seconds
            maxConcurrentFiles: 10,
            useRipgrep: true,
            fallbackToNodeGrep: true,
            ...config, // User config overrides defaults
        };

        if (this.config.enableSmartCache) {
            this.smartCache = createSmartCache<EnhancedGrepResult[]>(this.config.cacheConfig);
            this.cache = new SmartCacheAdapter(this.smartCache);
        } else {
            // Fallback to a simple in-memory cache for backward compatibility
            this.cache = this.createLegacyCache();
        }
    }

    private createLegacyCache(): LegacySearchCache<EnhancedGrepResult[]> {
        const cache = new Map<string, { data: EnhancedGrepResult[]; timestamp: number }>();
        const stats = { hits: 0, misses: 0 };
        const TTL = 5 * 60 * 1000; // 5 minutes default TTL

        return {
            get(key: string): EnhancedGrepResult[] | null {
                const entry = cache.get(key);
                if (!entry) {
                    stats.misses++;
                    return null;
                }

                // Check if expired
                if (Date.now() - entry.timestamp > TTL) {
                    cache.delete(key);
                    stats.misses++;
                    return null;
                }

                stats.hits++;
                return entry.data;
            },

            set(key: string, data: EnhancedGrepResult[], ttl?: number): void {
                cache.set(key, {
                    data,
                    timestamp: Date.now(),
                });

                // Limit cache size to prevent memory issues
                if (cache.size > 1000) {
                    const firstKey = cache.keys().next().value;
                    if (firstKey) cache.delete(firstKey);
                }
            },

            clear(): void {
                cache.clear();
            },

            size(): number {
                return cache.size;
            },

            getStats(): { hits: number; misses: number; hitRate: number; evictions?: number } {
                const total = stats.hits + stats.misses;
                return {
                    ...stats,
                    hitRate: total > 0 ? stats.hits / total : 0,
                    evictions: 0, // Legacy cache doesn't track evictions
                };
            },
        };
    }

    async search(params: EnhancedGrepParams): Promise<EnhancedGrepResult[]> {
        const startTime = Date.now();
        this.metrics.searchCount++;
        const normalizedParams = this.normalizeParams(params);

        try {
            // Generate cache key
            const cacheKey = this.generateCacheKey(normalizedParams);

            // Check cache
            if (this.config.enableCache) {
                const cached = this.cache.get(cacheKey);
                if (cached) {
                    this.metrics.cacheHits++;
                    return cached;
                }
            }

            // Determine search strategy
            const results = await this.executeSearch(normalizedParams);

            // Cache positive and negative results; repeated no-match searches are
            // useful work to avoid and need to participate in cache accounting.
            if (this.config.enableCache) {
                this.cache.set(cacheKey, results, undefined, normalizedParams.path);
            }

            this.updateMetrics(Date.now() - startTime);
            return results;
        } catch (error) {
            this.metrics.errors++;
            this.updateMetrics(Date.now() - startTime);
            throw new Error(`Enhanced grep failed: ${this.getErrorMessage(error)}`);
        }
    }

    private async executeSearch(params: EnhancedGrepParams): Promise<EnhancedGrepResult[]> {
        // Try ripgrep first if available and enabled
        if (this.config.useRipgrep) {
            try {
                return await this.searchWithRipgrep(params);
            } catch (error) {
                if (!this.config.fallbackToNodeGrep) {
                    throw error;
                }
            }
        }

        // Fallback to Node.js implementation
        return await this.searchWithNode(params);
    }

    private async searchWithRipgrep(params: EnhancedGrepParams): Promise<EnhancedGrepResult[]> {
        // Prefer async spawn-based execution (non-blocking) unless explicitly disabled
        if (process.env.FAST_SEARCH_PREFER_ASYNC_FALLBACK !== '0') {
            const args = this.buildRipgrepArgsForSpawn(params);
            return await new Promise<EnhancedGrepResult[]>((resolve, reject) => {
                const proc = spawn('rg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
                ensureExitHook();
                activeChildProcesses.add(proc);
                const chunks: string[] = [];
                let stderr = '';
                let settled = false;
                const to = setTimeout(() => {
                    if (settled) return;
                    settled = true;
                    try {
                        proc.kill('SIGTERM');
                    } catch {}
                    setTimeout(() => {
                        try {
                            proc.kill('SIGKILL');
                        } catch {}
                    }, 250);
                    reject(new Error(`Ripgrep timeout after ${params.timeout || 5000}ms`));
                }, params.timeout || 5000);

                proc.stdout.on('data', (d) => chunks.push(d.toString('utf8')));
                proc.stderr.on('data', (d) => (stderr += d.toString('utf8')));
                proc.on('error', (err) => {
                    clearTimeout(to);
                    activeChildProcesses.delete(proc);
                    settled = true;
                    reject(new Error(`Ripgrep spawn failed: ${err.message}`));
                });
                proc.on('close', (code) => {
                    clearTimeout(to);
                    activeChildProcesses.delete(proc);
                    if (settled) return;
                    settled = true;
                    // rg exit codes: 0 = matches, 1 = no matches, >1 = error
                    if (code === 0) {
                        resolve(this.parseRipgrepOutput(chunks.join(''), params));
                    } else if (code === 1) {
                        resolve([]);
                    } else {
                        reject(new Error(`Ripgrep failed with code ${code}: ${stderr.trim()}`));
                    }
                });
            });
        }

        // No legacy sync fallback; prefer async-only architecture
        throw new Error('Ripgrep spawn disabled or unavailable');
    }

    // Spawn-friendly args (no embedded quotes)
    private buildRipgrepArgsForSpawn(params: EnhancedGrepParams): string[] {
        const args: string[] = [];
        // Basic pattern first (compatible with previous layout)
        args.push(params.pattern);
        // Respect project ignores and add defaults
        args.push('--no-ignore-parent');
        args.push('--glob', '!node_modules/**');
        args.push('--glob', '!dist/**');
        args.push('--glob', '!.git/**');
        args.push('--glob', '!coverage/**');
        args.push('--glob', '!*.min.js');
        args.push('--glob', '!package-lock.json');
        args.push('--max-depth', '5');
        args.push('--with-filename');

        if (params.caseInsensitive) args.push('-i');
        if (params.outputMode !== 'files_with_matches' && params.outputMode !== 'count') args.push('-n');
        if (params.multiline) args.push('-U', '--multiline-dotall');
        if (typeof params.contextBefore === 'number') args.push('-B', String(params.contextBefore));
        if (typeof params.contextAfter === 'number') args.push('-A', String(params.contextAfter));
        if (typeof params.contextAround === 'number') args.push('-C', String(params.contextAround));
        if (params.outputMode === 'files_with_matches') args.push('-l');
        else if (params.outputMode === 'count') args.push('-c');

        if (params.type) {
            const map: Record<string, string> = {
                javascript: 'js',
                typescript: 'ts',
                python: 'py',
                rust: 'rust',
                go: 'go',
                java: 'java',
            };
            args.push('--type', map[(params.type || '').toLowerCase()] || params.type);
        }

        if (typeof params.headLimit === 'number') args.push('-m', String(params.headLimit));
        if (params.path) args.push(params.path);
        else args.push(process.cwd());
        return args;
    }

    // Legacy buildRipgrepArgs removed in favor of spawn-friendly version

    private parseRipgrepOutput(output: string, params: EnhancedGrepParams): EnhancedGrepResult[] {
        if (!output.trim()) return [];

        const results: EnhancedGrepResult[] = [];
        const lines = output.trim().split('\n');

        for (const line of lines) {
            try {
                // Try to parse as JSON first (when using --json)
                const json = JSON.parse(line);
                if (json.type === 'match') {
                    results.push({
                        file: json.data.path.text,
                        line: json.data.line_number,
                        column: json.data.submatches?.[0]?.start,
                        text: json.data.lines.text.trim(),
                        match: json.data.submatches?.[0]?.match?.text,
                        confidence: 1.0,
                    });
                }
            } catch {
                // Fallback to plain text parsing
                const match = this.parsePlainTextLine(line, params);
                if (match) results.push(match);
            }
        }

        return results;
    }

    private async searchWithNode(params: EnhancedGrepParams): Promise<EnhancedGrepResult[]> {
        const searchPath = params.path || process.cwd();
        const results: EnhancedGrepResult[] = [];

        // Get files to search
        const files = await this.getFilesToSearch(searchPath, params);

        // Search files concurrently with limit
        const chunks = this.chunkArray(files, this.config.maxConcurrentFiles ?? 10);

        for (const chunk of chunks) {
            const chunkResults = await Promise.allSettled(chunk.map((file) => this.searchFile(file, params)));

            for (const result of chunkResults) {
                if (result.status === 'fulfilled' && result.value.length > 0) {
                    results.push(...result.value);
                }
            }
        }

        return this.applyNodeOutputMode(results, params);
    }

    private applyNodeOutputMode(results: EnhancedGrepResult[], params: EnhancedGrepParams): EnhancedGrepResult[] {
        if (params.outputMode === 'files_with_matches') {
            return Array.from(new Set(results.map((result) => result.file))).map((file) => ({ file, confidence: 0.8 }));
        }

        if (params.outputMode === 'count') {
            const counts = new Map<string, number>();
            for (const result of results) {
                counts.set(result.file, (counts.get(result.file) || 0) + 1);
            }
            return Array.from(counts.entries()).map(([file, count]) => ({
                file,
                text: String(count),
                match: String(count),
                confidence: 0.8,
            }));
        }

        return results;
    }

    private async getFilesToSearch(searchPath: string, params: EnhancedGrepParams): Promise<string[]> {
        const files: string[] = [];
        const stat = await fs.stat(searchPath);

        if (stat.isFile()) {
            return [searchPath];
        }

        if (stat.isDirectory()) {
            const entries = await fs.readdir(searchPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name.startsWith('.') && !params.path?.includes(entry.name)) {
                    continue; // Skip hidden files unless explicitly included in path
                }

                const fullPath = path.join(searchPath, entry.name);

                if (entry.isFile()) {
                    // Check file type filter
                    if (params.type && !this.matchesFileType(fullPath, params.type)) {
                        continue;
                    }

                    // Check file size
                    const stats = await fs.stat(fullPath);
                    const maxFileSize = params.maxFileSize || this.config.maxFileSize || 50 * 1024 * 1024; // 50MB default
                    if (stats.size > maxFileSize) {
                        continue;
                    }

                    files.push(fullPath);
                }
            }
        }

        return files;
    }

    private async searchFile(filePath: string, params: EnhancedGrepParams): Promise<EnhancedGrepResult[]> {
        const results: EnhancedGrepResult[] = [];

        try {
            const fileStream = createReadStream(filePath, {
                encoding: (params.encoding as BufferEncoding) || 'utf8',
            });
            const rl = createInterface({ input: fileStream });

            let lineNumber = 0;
            const contextBuffer: string[] = [];
            const contextSize = params.contextBefore || params.contextAround || 0;

            for await (const line of rl) {
                lineNumber++;
                contextBuffer.push(line);

                if (contextBuffer.length > contextSize) {
                    contextBuffer.shift();
                }

                // Apply pattern matching
                if (this.matchesPattern(line, params.pattern, params.caseInsensitive)) {
                    const match: EnhancedGrepResult = {
                        file: filePath,
                        line: lineNumber,
                        text: line.trim(),
                        match: this.extractMatch(line, params.pattern, params.caseInsensitive),
                        confidence: 0.9,
                    };

                    // Add context if requested
                    if (contextSize > 0) {
                        match.context = {
                            before: contextBuffer.slice(0, -1), // All but current line
                            after: [], // We don't have future lines yet
                        };
                    }

                    results.push(match);

                    // Check head limit
                    if (params.headLimit && results.length >= params.headLimit) {
                        break;
                    }
                }
            }
        } catch (error) {
            // Skip files that can't be read
        }

        return results;
    }

    private matchesPattern(text: string, pattern: string, caseInsensitive = false): boolean {
        try {
            const flags = caseInsensitive ? 'i' : '';
            const regex = new RegExp(pattern, flags);
            return regex.test(text);
        } catch {
            // Fallback to simple string matching if regex is invalid
            const searchText = caseInsensitive ? text.toLowerCase() : text;
            const searchPattern = caseInsensitive ? pattern.toLowerCase() : pattern;
            return searchText.includes(searchPattern);
        }
    }

    private extractMatch(text: string, pattern: string, caseInsensitive = false): string {
        try {
            const flags = caseInsensitive ? 'i' : '';
            const regex = new RegExp(pattern, flags);
            const match = text.match(regex);
            return match?.[0] || '';
        } catch {
            return '';
        }
    }

    private matchesFileType(filePath: string, type: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        const typeMap: Record<string, string[]> = {
            ts: ['.ts', '.tsx'],
            js: ['.js', '.jsx'],
            py: ['.py', '.pyw'],
            java: ['.java'],
            go: ['.go'],
            rs: ['.rs'],
            cpp: ['.cpp', '.cc', '.cxx', '.c++'],
            c: ['.c', '.h'],
        };

        return typeMap[type]?.includes(ext) || false;
    }

    private parsePlainTextLine(line: string, params: EnhancedGrepParams): EnhancedGrepResult | null {
        if (!line) return null;

        if (params.outputMode === 'files_with_matches') {
            return { file: line, confidence: 0.8 };
        }

        if (params.outputMode === 'count') {
            const countMatch = line.match(/^(.*):(\d+)$/);
            if (!countMatch) return null;
            return {
                file: countMatch[1],
                text: countMatch[2],
                match: countMatch[2],
                confidence: 0.8,
            };
        }

        const match = line.match(/^(.*):(\d+):(.*)$/);
        if (!match) return null;

        return {
            file: match[1],
            line: parseInt(match[2], 10) || undefined,
            text: match[3].trim(),
            confidence: 0.8,
        };
    }

    private chunkArray<T>(array: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    private escapeShellArg(arg: string): string {
        return arg.replace(/['"\\$`]/g, '\\$&');
    }

    private normalizeParams(params: EnhancedGrepParams): EnhancedGrepParams {
        return {
            ...params,
            path: path.resolve(params.path || process.cwd()),
            outputMode: params.outputMode || 'content',
        };
    }

    private generateCacheKey(params: EnhancedGrepParams): string {
        return `grep:${JSON.stringify(params)}`;
    }

    private updateMetrics(executionTime: number): void {
        this.metrics.totalTime += executionTime;
        this.metrics.averageTime = this.metrics.totalTime / this.metrics.searchCount;
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    getCacheStats() {
        return this.cache.getStats();
    }

    clearCache(): void {
        this.cache.clear();
    }

    async dispose(): Promise<void> {
        if (this.smartCache) {
            await this.smartCache.dispose();
        }
    }
}

// Enhanced Glob implementation
export class EnhancedGlob {
    public cache: LegacySearchCache<EnhancedGlobResult>;
    public smartCache?: SmartCache<EnhancedGlobResult>;
    private config: {
        enableSmartCache?: boolean;
        cacheConfig?: Partial<SmartCacheConfig>;
        enableCache?: boolean;
        timeout?: number;
        maxFiles?: number;
        respectGitignore?: boolean;
        followSymlinks?: boolean;
    };
    private metrics: PerformanceMetrics = {
        searchCount: 0,
        totalTime: 0,
        averageTime: 0,
        cacheHits: 0,
        errors: 0,
    };

    constructor(
        config: {
            enableSmartCache?: boolean;
            cacheConfig?: Partial<SmartCacheConfig>;
            enableCache?: boolean;
            timeout?: number;
            maxFiles?: number;
            respectGitignore?: boolean;
            followSymlinks?: boolean;
        } = {}
    ) {
        // Merge with defaults
        this.config = {
            enableSmartCache: true,
            enableCache: true,
            timeout: 30000,
            maxFiles: 10000,
            respectGitignore: true,
            followSymlinks: false,
            ...config, // User config overrides defaults
        };

        if (this.config.enableSmartCache) {
            this.smartCache = createSmartCache<EnhancedGlobResult>(this.config.cacheConfig);
            this.cache = new SmartCacheAdapter(this.smartCache);
        } else {
            this.cache = this.createLegacyCache();
        }
    }

    async search(params: EnhancedGlobParams): Promise<EnhancedGlobResult> {
        const startTime = Date.now();
        this.metrics.searchCount++;

        try {
            const cacheKey = this.generateCacheKey(params);

            if (this.config.enableCache) {
                const cached = this.cache.get(cacheKey);
                if (cached) {
                    this.metrics.cacheHits++;
                    return cached;
                }
            }

            const result = await this.executeGlob(params);

            if (this.config.enableCache) {
                this.cache.set(cacheKey, result, undefined, params.path || process.cwd());
            }

            this.updateMetrics(Date.now() - startTime);
            return result;
        } catch (error) {
            this.metrics.errors++;
            this.updateMetrics(Date.now() - startTime);
            throw new Error(`Enhanced glob failed: ${this.getErrorMessage(error)}`);
        }
    }

    private async executeGlob(params: EnhancedGlobParams): Promise<EnhancedGlobResult> {
        const options = {
            cwd: params.path || process.cwd(),
            ignore: params.ignorePatterns || ['node_modules/**', '.git/**'],
            followSymlinks: params.followSymlinks || false,
            maxDepth: params.maxDepth,
            dot: params.includeHidden || false,
            onlyFiles: !params.includeDirectories,
            absolute: true,
            suppressErrors: true,
        };

        const files = await fastGlob(params.pattern, options);

        // Sort by modification time if requested
        if (params.sortByModified) {
            await this.sortByModificationTime(files);
        }

        // Separate files and directories if needed
        const result: EnhancedGlobResult = {
            files: [],
            directories: params.includeDirectories ? [] : undefined,
            metadata: {
                totalFiles: files.length,
                searchTime: 0, // Will be set by caller
                skippedFiles: 0,
                errors: [],
            },
        };

        for (const file of files) {
            try {
                const stat = await fs.stat(file);
                if (stat.isFile()) {
                    result.files.push(file);
                } else if (stat.isDirectory() && params.includeDirectories) {
                    result.directories?.push(file);
                }
            } catch {
                result.metadata!.skippedFiles++;
            }
        }

        return result;
    }

    private async sortByModificationTime(files: string[]): Promise<void> {
        const stats = await Promise.allSettled(
            files.map(async (file) => ({
                file,
                mtime: (await fs.stat(file)).mtime,
            }))
        );

        const validStats = stats
            .filter((s): s is PromiseFulfilledResult<{ file: string; mtime: Date }> => s.status === 'fulfilled')
            .map((s) => s.value)
            .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

        files.splice(0, files.length, ...validStats.map((s) => s.file));
    }

    private generateCacheKey(params: EnhancedGlobParams): string {
        return `glob:${JSON.stringify(params)}`;
    }

    private updateMetrics(executionTime: number): void {
        this.metrics.totalTime += executionTime;
        this.metrics.averageTime = this.metrics.totalTime / this.metrics.searchCount;
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    getCacheStats() {
        return this.cache.getStats();
    }

    clearCache(): void {
        this.cache.clear();
    }

    async dispose(): Promise<void> {
        if (this.smartCache) {
            await this.smartCache.dispose();
        }
    }

    private createLegacyCache(): LegacySearchCache<EnhancedGlobResult> {
        const cache = new Map<string, { data: EnhancedGlobResult; timestamp: number }>();
        const stats = { hits: 0, misses: 0 };
        const TTL = 5 * 60 * 1000; // 5 minutes default TTL

        return {
            get(key: string): EnhancedGlobResult | null {
                const entry = cache.get(key);
                if (!entry) {
                    stats.misses++;
                    return null;
                }

                // Check if expired
                if (Date.now() - entry.timestamp > TTL) {
                    cache.delete(key);
                    stats.misses++;
                    return null;
                }

                stats.hits++;
                return entry.data;
            },

            set(key: string, data: EnhancedGlobResult, ttl?: number): void {
                cache.set(key, {
                    data,
                    timestamp: Date.now(),
                });

                // Limit cache size to prevent memory issues
                if (cache.size > 1000) {
                    const firstKey = cache.keys().next().value;
                    if (firstKey) cache.delete(firstKey);
                }
            },

            clear(): void {
                cache.clear();
            },

            size(): number {
                return cache.size;
            },

            getStats(): { hits: number; misses: number; hitRate: number; evictions?: number } {
                const total = stats.hits + stats.misses;
                return {
                    ...stats,
                    hitRate: total > 0 ? stats.hits / total : 0,
                    evictions: 0, // Legacy cache doesn't track evictions
                };
            },
        };
    }
}

// Enhanced LS implementation
export class EnhancedLS {
    public cache: LegacySearchCache<EnhancedLSResult>;
    public smartCache?: SmartCache<EnhancedLSResult>;
    private config: {
        enableSmartCache?: boolean;
        cacheConfig?: Partial<SmartCacheConfig>;
        enableCache?: boolean;
        timeout?: number;
        maxEntries?: number;
        includeMimeType?: boolean;
    };
    private metrics: PerformanceMetrics = {
        searchCount: 0,
        totalTime: 0,
        averageTime: 0,
        cacheHits: 0,
        errors: 0,
    };

    constructor(
        config: {
            enableSmartCache?: boolean;
            cacheConfig?: Partial<SmartCacheConfig>;
            enableCache?: boolean;
            timeout?: number;
            maxEntries?: number;
            includeMimeType?: boolean;
        } = {}
    ) {
        // Merge with defaults
        this.config = {
            enableSmartCache: true,
            enableCache: true,
            timeout: 30000,
            maxEntries: 5000,
            includeMimeType: false,
            ...config, // User config overrides defaults
        };

        if (this.config.enableSmartCache) {
            this.smartCache = createSmartCache<EnhancedLSResult>(this.config.cacheConfig);
            this.cache = new SmartCacheAdapter(this.smartCache);
        } else {
            this.cache = this.createLegacyCache();
        }
    }

    async list(params: EnhancedLSParams): Promise<EnhancedLSResult> {
        const startTime = Date.now();
        this.metrics.searchCount++;

        try {
            const cacheKey = this.generateCacheKey(params);

            if (this.config.enableCache) {
                const cached = this.cache.get(cacheKey);
                if (cached) {
                    this.metrics.cacheHits++;
                    return cached;
                }
            }

            const result = await this.executeListing(params);

            if (this.config.enableCache) {
                this.cache.set(cacheKey, result, undefined, params.path);
            }

            this.updateMetrics(Date.now() - startTime);
            return result;
        } catch (error) {
            this.metrics.errors++;
            this.updateMetrics(Date.now() - startTime);
            throw new Error(`Enhanced LS failed: ${this.getErrorMessage(error)}`);
        }
    }

    private async executeListing(params: EnhancedLSParams): Promise<EnhancedLSResult> {
        const entries: EnhancedLSEntry[] = [];
        const errors: string[] = [];

        try {
            await this.listDirectory(params.path, params, entries, errors, 0);
        } catch (error) {
            errors.push(this.getErrorMessage(error));
        }

        // Sort results
        if (params.sortBy) {
            this.sortEntries(entries, params.sortBy, params.sortOrder);
        }

        return {
            entries: entries.slice(0, this.config.maxEntries),
            metadata: {
                totalEntries: entries.length,
                searchTime: 0, // Will be set by caller
                errors,
                path: params.path,
            },
        };
    }

    private async listDirectory(
        dirPath: string,
        params: EnhancedLSParams,
        entries: EnhancedLSEntry[],
        errors: string[],
        depth: number
    ): Promise<void> {
        if (params.maxDepth && depth >= params.maxDepth) {
            return;
        }

        try {
            const dirEntries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const dirent of dirEntries) {
                // Skip hidden files unless requested
                if (!params.includeHidden && dirent.name.startsWith('.')) {
                    continue;
                }

                // Check ignore patterns
                if (params.ignorePatterns?.some((pattern) => this.matchesIgnorePattern(dirent.name, pattern))) {
                    continue;
                }

                const fullPath = path.join(dirPath, dirent.name);

                try {
                    const entry = await this.createLSEntry(dirent, fullPath, params);
                    entries.push(entry);

                    // Recurse into directories if requested
                    if (params.recursive && dirent.isDirectory()) {
                        await this.listDirectory(fullPath, params, entries, errors, depth + 1);
                    }
                } catch (error) {
                    errors.push(`${fullPath}: ${this.getErrorMessage(error)}`);
                }
            }
        } catch (error) {
            errors.push(`${dirPath}: ${this.getErrorMessage(error)}`);
        }
    }

    private async createLSEntry(dirent: Dirent, fullPath: string, params: EnhancedLSParams): Promise<EnhancedLSEntry> {
        const entry: EnhancedLSEntry = {
            name: dirent.name,
            path: fullPath,
            type: this.getEntryType(dirent),
            extension: path.extname(dirent.name).toLowerCase(),
        };

        if (params.includeMetadata) {
            try {
                const stats = await fs.stat(fullPath);
                entry.size = stats.size;
                entry.modified = stats.mtime;

                // Check permissions
                try {
                    await fs.access(fullPath, fsSync.constants.R_OK);
                    entry.isReadable = true;
                } catch {
                    entry.isReadable = false;
                }

                try {
                    await fs.access(fullPath, fsSync.constants.W_OK);
                    entry.isWritable = true;
                } catch {
                    entry.isWritable = false;
                }

                try {
                    await fs.access(fullPath, fsSync.constants.X_OK);
                    entry.isExecutable = true;
                } catch {
                    entry.isExecutable = false;
                }

                // Get file mode as permissions string
                entry.permissions = this.formatPermissions(stats.mode);

                // Get MIME type if requested
                if (this.config.includeMimeType && dirent.isFile()) {
                    entry.mimeType = this.getMimeType(entry.extension || '');
                }
            } catch {
                // Metadata collection failed, entry remains with basic info
            }
        }

        return entry;
    }

    private getEntryType(dirent: Dirent): 'file' | 'directory' | 'symlink' | 'unknown' {
        if (dirent.isFile()) return 'file';
        if (dirent.isDirectory()) return 'directory';
        if (dirent.isSymbolicLink()) return 'symlink';
        return 'unknown';
    }

    private formatPermissions(mode: number): string {
        const permissions = [];

        // Owner permissions
        permissions.push(mode & 0o400 ? 'r' : '-');
        permissions.push(mode & 0o200 ? 'w' : '-');
        permissions.push(mode & 0o100 ? 'x' : '-');

        // Group permissions
        permissions.push(mode & 0o040 ? 'r' : '-');
        permissions.push(mode & 0o020 ? 'w' : '-');
        permissions.push(mode & 0o010 ? 'x' : '-');

        // Other permissions
        permissions.push(mode & 0o004 ? 'r' : '-');
        permissions.push(mode & 0o002 ? 'w' : '-');
        permissions.push(mode & 0o001 ? 'x' : '-');

        return permissions.join('');
    }

    private getMimeType(extension: string): string {
        const mimeTypes: Record<string, string> = {
            '.ts': 'application/typescript',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.html': 'text/html',
            '.css': 'text/css',
            '.py': 'text/x-python',
            '.java': 'text/x-java',
            '.go': 'text/x-go',
            '.rs': 'text/x-rust',
            '.cpp': 'text/x-c++src',
            '.c': 'text/x-csrc',
            '.md': 'text/markdown',
            '.txt': 'text/plain',
            '.yaml': 'text/yaml',
            '.yml': 'text/yaml',
        };

        return mimeTypes[extension] || 'application/octet-stream';
    }

    private matchesIgnorePattern(name: string, pattern: string): boolean {
        // Simple glob pattern matching
        const regex = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.');

        return new RegExp(`^${regex}$`).test(name);
    }

    private sortEntries(
        entries: EnhancedLSEntry[],
        sortBy: 'name' | 'size' | 'modified',
        sortOrder: 'asc' | 'desc' = 'asc'
    ): void {
        entries.sort((a, b) => {
            let comparison = 0;

            switch (sortBy) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    comparison = (a.size || 0) - (b.size || 0);
                    break;
                case 'modified':
                    comparison = (a.modified?.getTime() || 0) - (b.modified?.getTime() || 0);
                    break;
            }

            return sortOrder === 'desc' ? -comparison : comparison;
        });
    }

    private generateCacheKey(params: EnhancedLSParams): string {
        return `ls:${JSON.stringify(params)}`;
    }

    private updateMetrics(executionTime: number): void {
        this.metrics.totalTime += executionTime;
        this.metrics.averageTime = this.metrics.totalTime / this.metrics.searchCount;
    }

    private getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    getMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    getCacheStats() {
        return this.cache.getStats();
    }

    clearCache(): void {
        this.cache.clear();
    }

    async dispose(): Promise<void> {
        if (this.smartCache) {
            await this.smartCache.dispose();
        }
    }

    private createLegacyCache(): LegacySearchCache<EnhancedLSResult> {
        const cache = new Map<string, { data: EnhancedLSResult; timestamp: number }>();
        const stats = { hits: 0, misses: 0 };
        const TTL = 5 * 60 * 1000; // 5 minutes default TTL

        return {
            get(key: string): EnhancedLSResult | null {
                const entry = cache.get(key);
                if (!entry) {
                    stats.misses++;
                    return null;
                }

                // Check if expired
                if (Date.now() - entry.timestamp > TTL) {
                    cache.delete(key);
                    stats.misses++;
                    return null;
                }

                stats.hits++;
                return entry.data;
            },

            set(key: string, data: EnhancedLSResult, ttl?: number): void {
                cache.set(key, {
                    data,
                    timestamp: Date.now(),
                });

                // Limit cache size to prevent memory issues
                if (cache.size > 1000) {
                    const firstKey = cache.keys().next().value;
                    if (firstKey) cache.delete(firstKey);
                }
            },

            clear(): void {
                cache.clear();
            },

            size(): number {
                return cache.size;
            },

            getStats(): { hits: number; misses: number; hitRate: number; evictions?: number } {
                const total = stats.hits + stats.misses;
                return {
                    ...stats,
                    hitRate: total > 0 ? stats.hits / total : 0,
                    evictions: 0, // Legacy cache doesn't track evictions
                };
            },
        };
    }
}

// Unified enhanced search tools factory
export class EnhancedSearchTools {
    public readonly grep: EnhancedGrep;
    public readonly glob: EnhancedGlob;
    public readonly ls: EnhancedLS;

    constructor(config?: {
        grep?: Partial<EnhancedGrep['config']>;
        glob?: Partial<EnhancedGlob['config']>;
        ls?: Partial<EnhancedLS['config']>;
    }) {
        this.grep = new EnhancedGrep(config?.grep as any);
        this.glob = new EnhancedGlob(config?.glob as any);
        this.ls = new EnhancedLS(config?.ls as any);
    }

    // Get combined metrics from all tools
    getMetrics() {
        return {
            grep: this.grep.getMetrics(),
            glob: this.glob.getMetrics(),
            ls: this.ls.getMetrics(),
            combined: {
                totalSearches:
                    this.grep.getMetrics().searchCount +
                    this.glob.getMetrics().searchCount +
                    this.ls.getMetrics().searchCount,
                totalTime:
                    this.grep.getMetrics().totalTime +
                    this.glob.getMetrics().totalTime +
                    this.ls.getMetrics().totalTime,
                totalErrors:
                    this.grep.getMetrics().errors + this.glob.getMetrics().errors + this.ls.getMetrics().errors,
            },
        };
    }

    // Health check for all tools
    async healthCheck(): Promise<{ grep: boolean; glob: boolean; ls: boolean }> {
        const checks = await Promise.allSettled([
            this.grep
                .search({ pattern: 'test', path: __dirname })
                .then(() => true)
                .catch(() => false),
            this.glob
                .search({ pattern: '*.ts', path: __dirname })
                .then(() => true)
                .catch(() => false),
            this.ls
                .list({ path: __dirname })
                .then(() => true)
                .catch(() => false),
        ]);

        return {
            grep: checks[0].status === 'fulfilled' ? checks[0].value : false,
            glob: checks[1].status === 'fulfilled' ? checks[1].value : false,
            ls: checks[2].status === 'fulfilled' ? checks[2].value : false,
        };
    }

    // Get unified cache statistics
    getCacheStats() {
        return {
            grep: this.grep.getCacheStats(),
            glob: this.glob.getCacheStats(),
            ls: this.ls.getCacheStats(),
        };
    }

    // Get unified cache size information
    getCacheSize() {
        return {
            grep: this.grep.smartCache
                ? this.grep.smartCache.getSize()
                : { entries: this.grep.cache.size(), memoryBytes: 0, watchers: 0 },
            glob: this.glob.smartCache
                ? this.glob.smartCache.getSize()
                : { entries: this.glob.cache.size(), memoryBytes: 0, watchers: 0 },
            ls: this.ls.smartCache
                ? this.ls.smartCache.getSize()
                : { entries: this.ls.cache.size(), memoryBytes: 0, watchers: 0 },
        };
    }

    // Clear all caches
    async clearAllCaches(): Promise<void> {
        await Promise.all([this.grep.smartCache?.clear(), this.glob.smartCache?.clear(), this.ls.smartCache?.clear()]);

        this.grep.clearCache();
        this.glob.clearCache();
        this.ls.clearCache();
    }

    // Dispose all resources
    async dispose(): Promise<void> {
        await Promise.all([this.grep.dispose(), this.glob.dispose(), this.ls.dispose()]);
    }
}

// Factory function for creating enhanced search tools with custom configuration
export function createEnhancedSearchTools(config?: {
    globalSmartCache?: Partial<SmartCacheConfig>;
    grep?: Partial<EnhancedToolsConfig>;
    glob?: Partial<EnhancedGlob['config']>;
    ls?: Partial<EnhancedLS['config']>;
}): EnhancedSearchTools {
    const grepConfig = {
        ...config?.grep,
        enableSmartCache: true,
        cacheConfig: config?.globalSmartCache,
    };

    const globConfig = {
        ...config?.glob,
        enableSmartCache: true,
        cacheConfig: config?.globalSmartCache,
    };

    const lsConfig = {
        ...config?.ls,
        enableSmartCache: true,
        cacheConfig: config?.globalSmartCache,
    };

    return new EnhancedSearchTools({
        grep: grepConfig as any,
        glob: globConfig as any,
        ls: lsConfig as any,
    });
}

// Export default instance
export const enhancedSearchTools = new EnhancedSearchTools();
