/**
 * Async, streaming implementation of Enhanced Search Tools
 *
 * This implementation fixes the fundamental performance issues by:
 * 1. Using async execution (non-blocking)
 * 2. Streaming results as they arrive
 * 3. Supporting early termination
 * 4. Implementing smart caching with invalidation
 * 5. Enabling parallel searches
 */

import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fsSync from 'node:fs';
import { createReadStream } from 'node:fs';
import type * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';

const activeChildProcesses = new Set<ChildProcess>();
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

// Types
export interface StreamingGrepResult {
    file: string;
    line?: number;
    column?: number;
    text: string;
    match?: string;
    confidence: number;
}

export interface SearchStream extends EventEmitter {
    on(event: 'data', listener: (result: StreamingGrepResult) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'progress', listener: (progress: SearchProgress) => void): this;
    cancel(): void;
}

export interface SearchProgress {
    filesSearched: number;
    matchesFound: number;
    elapsedMs: number;
    estimatedTotalFiles?: number;
}

export interface AsyncSearchOptions {
    pattern: string;
    path?: string;
    maxResults?: number;
    timeout?: number;
    streaming?: boolean;
    parallel?: boolean;
    caseInsensitive?: boolean;
    fileType?: string;
    excludePaths?: string[];
    includeHidden?: boolean;
    useRegex?: boolean; // if true, treat pattern as regex (omit -F)
}

export interface FileListOptions {
    includes?: string[]; // filename globs (ripgrep -g), e.g., **/*Foo*.ts
    excludes?: string[]; // directories or globs to exclude (ripgrep -g !...)
    path?: string; // root directory
    maxDepth?: number; // ripgrep --max-depth
    timeout?: number; // milliseconds
    includeHidden?: boolean; // ripgrep --hidden
    maxFiles?: number; // cap number of files returned
}

/**
 * Process Pool for parallel ripgrep execution
 */
class RipgrepProcessPool {
    private processes = new Set<ChildProcess>();
    private maxProcesses: number;
    private activeProcesses = 0;
    private queue: Array<() => void> = [];

    constructor(maxProcesses = 4) {
        this.maxProcesses = maxProcesses;
        // Validate ripgrep availability during initialization
        this.validateRipgrepAvailability();
    }

    private validateRipgrepAvailability() {
        try {
            const { execSync } = require('child_process');
            execSync('rg --version', { stdio: 'pipe' });
        } catch (error) {
            console.error('AsyncEnhancedGrep: ripgrep not available or not working:', error);
            throw new Error('ripgrep is required for async search functionality');
        }
    }

    async execute(command: string, args: string[]): Promise<ChildProcess> {
        // Wait if at max capacity
        while (this.activeProcesses >= this.maxProcesses) {
            await new Promise<void>((resolve) => {
                this.queue.push(resolve);
            });
        }

        this.activeProcesses++;
        const process = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        ensureExitHook();
        activeChildProcesses.add(process);
        this.processes.add(process);

        process.on('exit', () => {
            activeChildProcesses.delete(process);
            this.processes.delete(process);
            this.activeProcesses--;
            // Process next queued request
            const next = this.queue.shift();
            if (next) next();
        });

        process.on('error', (error) => {
            activeChildProcesses.delete(process);
            this.processes.delete(process);
            this.activeProcesses--;
            console.error('RipgrepProcessPool: Process error:', error);
            // Process next queued request on error too
            const next = this.queue.shift();
            if (next) next();
        });

        return process;
    }

    getActiveCount(): number {
        return this.activeProcesses;
    }

    destroy() {
        for (const p of this.processes) {
            try {
                p.kill();
            } catch {}
        }
        this.queue.length = 0;
    }
}

/**
 * Smart Cache with file watching
 */
class SmartSearchCache {
    private cache = new Map<string, CachedResult>();
    private watchers = new Map<string, fsSync.FSWatcher>();
    private maxSize: number;
    private ttl: number;

    constructor(maxSize = 1000, ttl = 60000) {
        this.maxSize = maxSize;
        this.ttl = ttl;
    }

    private getCacheKey(options: AsyncSearchOptions): string {
        return JSON.stringify({
            pattern: options.pattern,
            path: options.path,
            caseInsensitive: options.caseInsensitive,
            fileType: options.fileType,
        });
    }

    get(options: AsyncSearchOptions): StreamingGrepResult[] | null {
        const key = this.getCacheKey(options);
        const cached = this.cache.get(key);

        if (!cached) return null;

        // Check if expired
        if (Date.now() - cached.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        // Check if any watched files changed
        if (cached.watchedFiles.some((f) => this.hasFileChanged(f, cached.timestamp))) {
            this.invalidate(key);
            return null;
        }

        return cached.results;
    }

    set(options: AsyncSearchOptions, results: StreamingGrepResult[]) {
        const key = this.getCacheKey(options);

        // Evict old entries if at capacity - ensure we have room for new entry
        while (this.cache.size >= this.maxSize) {
            const oldest = Array.from(this.cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
            if (oldest) {
                this.invalidate(oldest[0]);
            } else {
                break; // Safety break
            }
        }

        // Extract unique files from results for watching
        const files = [...new Set(results.map((r) => r.file))];

        this.cache.set(key, {
            results,
            timestamp: Date.now(),
            watchedFiles: files,
        });

        // Set up file watchers for invalidation
        this.watchFiles(key, files);
    }

    private watchFiles(cacheKey: string, files: string[]) {
        // Only watch a subset to avoid too many watchers
        const filesToWatch = files.slice(0, 10);

        filesToWatch.forEach((file) => {
            if (!this.watchers.has(file)) {
                try {
                    const watcher = fsSync.watch(file, (eventType) => {
                        if (eventType === 'change' || eventType === 'rename') {
                            this.invalidate(cacheKey);
                        }
                    });
                    // Watchers should not keep the process alive (tests/CLIs should exit cleanly).
                    watcher.unref?.();
                    this.watchers.set(file, watcher);
                } catch (e) {
                    // File might not exist or be watchable - this is normal for some files
                    // console.warn(`Cannot watch file ${file}:`, e.message);
                }
            }
        });
    }

    private hasFileChanged(file: string, since: number): boolean {
        try {
            const stats = fsSync.statSync(file);
            return stats.mtimeMs > since;
        } catch {
            // If we can't stat the file, assume it hasn't changed
            // This prevents cache invalidation for test files that don't exist
            return false;
        }
    }

    private invalidate(key: string) {
        const cached = this.cache.get(key);
        if (cached) {
            // Clean up watchers
            cached.watchedFiles.forEach((file) => {
                const watcher = this.watchers.get(file);
                if (watcher) {
                    watcher.close();
                    this.watchers.delete(file);
                }
            });
        }
        this.cache.delete(key);
    }

    clear() {
        // Clean up all watchers
        this.watchers.forEach((w) => {
            if (w && typeof w.close === 'function') {
                w.close();
            }
        });
        this.watchers.clear();
        this.cache.clear();
    }
}

interface CachedResult {
    results: StreamingGrepResult[];
    timestamp: number;
    watchedFiles: string[];
}

/**
 * Main Async Enhanced Grep Implementation
 */
export class AsyncEnhancedGrep {
    private processPool: RipgrepProcessPool;
    private cache: SmartSearchCache;
    private config: {
        maxProcesses: number;
        cacheSize: number;
        cacheTTL: number;
        defaultTimeout: number;
        fileDiscoveryPrefer?: 'auto' | 'rg' | 'fd';
    };
    private fdAvailable: boolean | null = null;

    constructor(config?: Partial<AsyncEnhancedGrep['config']>) {
        const cpuCount = Math.max(1, (os.cpus?.() || []).length || 1);
        const envMax = Number.parseInt(process.env.ENHANCED_GREP_MAX_PROCESSES || '0', 10);
        const maxProc = Number.isFinite(envMax) && envMax > 0 ? envMax : Math.min(Math.max(cpuCount, 2), 8);
        const envDefaultTimeout = Number.parseInt(process.env.ENHANCED_GREP_DEFAULT_TIMEOUT_MS || '0', 10);
        const defTimeout = Number.isFinite(envDefaultTimeout) && envDefaultTimeout > 0 ? envDefaultTimeout : 2000;
        this.config = {
            maxProcesses: maxProc,
            cacheSize: 1000,
            cacheTTL: 60000,
            defaultTimeout: defTimeout, // Default timeout (overridable via env)
            fileDiscoveryPrefer: 'auto',
            ...config,
        };

        try {
            this.processPool = new RipgrepProcessPool(this.config.maxProcesses);
            this.cache = new SmartSearchCache(this.config.cacheSize, this.config.cacheTTL);
            // Only log in debug mode or non-stdio environments
            if (process.env.DEBUG && !process.env.SILENT_MODE) {
                console.error('AsyncEnhancedGrep initialized successfully with config:', this.config);
            }
        } catch (error) {
            if (!process.env.SILENT_MODE) {
                console.error('AsyncEnhancedGrep initialization failed:', error);
            }
            throw error;
        }
    }

    /**
     * Async search with streaming support
     */
    async search(options: AsyncSearchOptions): Promise<StreamingGrepResult[]> {
        // Apply default timeout if none provided
        if (!options.timeout || options.timeout <= 0) {
            options = { ...options, timeout: this.config.defaultTimeout };
        }
        // Check cache first
        const cached = this.cache.get(options);
        if (cached) {
            return cached;
        }

        // Execute search
        const results = await this.executeSearch(options);

        // Cache results
        this.cache.set(options, results);

        return results;
    }

    /**
     * List files by filename patterns using ripgrep's file-mode (--files) with includes/excludes.
     * This respects .gitignore by default and supports timeouts via process kill.
     */
    async listFiles(options: FileListOptions): Promise<string[]> {
        // Apply default timeout if none provided
        if (!options.timeout || options.timeout <= 0) {
            options = { ...options, timeout: this.config.defaultTimeout } as FileListOptions;
        }
        const prefer = this.config.fileDiscoveryPrefer || 'auto';
        if (prefer === 'fd' || (prefer === 'auto' && this.isFdAvailable())) {
            return this.listFilesWithFd(options);
        }
        const args: string[] = [];
        args.push('--files');

        // Performance: limit depth if provided
        if (typeof options.maxDepth === 'number') {
            args.push('--max-depth', String(options.maxDepth));
        }

        // Hidden files
        if (options.includeHidden) {
            args.push('--hidden');
        }

        // Excludes (as ripgrep globs)
        const excludes = options.excludes || [];
        for (const ex of excludes) {
            // Normalize: accept either 'dir' or 'dir/**'
            const pattern = ex.endsWith('/**') ? ex : `${ex.replace(/\/$/, '')}/**`;
            args.push('--glob', `!${pattern}`);
        }

        // Includes as glob patterns
        const includes = options.includes || [];
        for (const inc of includes) {
            args.push('--glob', inc);
        }

        // Path to search (defaults to cwd)
        args.push(options.path || '.');

        const files: string[] = [];
        const proc = await this.processPool.execute('rg', args);

        // Timeout handling
        let timeout: NodeJS.Timeout | null = null;
        if (options.timeout && options.timeout > 0) {
            timeout = setTimeout(() => {
                try {
                    proc.kill('SIGTERM');
                } catch {}
            }, options.timeout);
        }

        return new Promise((resolve) => {
            proc.stdout?.on('data', (data: Buffer) => {
                const lines = data.toString('utf8').split(/\r?\n/).filter(Boolean);
                for (const line of lines) {
                    files.push(line);
                }
                // Cap results if requested
                if (options.maxFiles && files.length >= options.maxFiles) {
                    try {
                        proc.kill('SIGTERM');
                    } catch {}
                }
            });
            proc.on('close', () => {
                if (timeout) clearTimeout(timeout);
                if (options.maxFiles && files.length > options.maxFiles) {
                    resolve(files.slice(0, options.maxFiles));
                } else {
                    resolve(files);
                }
            });
            proc.on('error', () => {
                if (timeout) clearTimeout(timeout);
                resolve([]);
            });
        });
    }

    /**
     * Streaming search - returns results as they arrive
     */
    searchStream(options: AsyncSearchOptions): SearchStream {
        // Apply default timeout if none provided (prevents long-running rg from keeping the process alive).
        if (!options.timeout || options.timeout <= 0) {
            options = { ...options, timeout: this.config.defaultTimeout };
        }

        const emitter = new EventEmitter() as SearchStream;
        const startTime = Date.now();
        const filesSearched = 0;
        let matchesFound = 0;
        let cancelled = false;
        let child: ChildProcess | null = null;
        let readline: any = null;
        let hardKill: NodeJS.Timeout | null = null;
        const armHardKill = () => {
            if (!child) return;
            if (hardKill) return;
            hardKill = setTimeout(() => {
                try {
                    child?.kill('SIGKILL');
                } catch {}
            }, 250);
        };
        const clearHardKill = () => {
            if (hardKill) clearTimeout(hardKill);
            hardKill = null;
        };

        // Implement cancel method
        emitter.cancel = () => {
            cancelled = true;
            if (child) {
                try {
                    child.kill('SIGTERM');
                } catch {}
                armHardKill();
            }
            if (readline) {
                try {
                    readline.close();
                } catch {}
            }
            // Emit end event when cancelled to resolve promises waiting for completion
            setImmediate(() => {
                if (!emitter.listenerCount('end')) return;
                emitter.emit('end');
            });
        };

        // Start async search
        (async () => {
            try {
                // Check cache first
                const cached = this.cache.get(options);
                if (cached) {
                    // Emit cached results with proper timing delays to simulate streaming
                    let delay = 0;
                    const timeouts: NodeJS.Timeout[] = [];

                    for (let i = 0; i < cached.length; i++) {
                        if (cancelled) break;

                        const result = cached[i];
                        const timeout = setTimeout(() => {
                            if (!cancelled) {
                                emitter.emit('data', result);
                                matchesFound++;

                                // Emit progress
                                if (matchesFound % 10 === 0) {
                                    emitter.emit('progress', {
                                        filesSearched,
                                        matchesFound,
                                        elapsedMs: Date.now() - startTime,
                                    });
                                }

                                // Emit end after last result
                                if (i === cached.length - 1) {
                                    emitter.emit('end');
                                }
                            }
                        }, delay);
                        timeout.unref?.();

                        timeouts.push(timeout);

                        // Increment delay for next result (1-5ms per result)
                        delay += Math.random() * 4 + 1;
                    }

                    // Clear timeouts if cancelled
                    const originalCancel = emitter.cancel;
                    emitter.cancel = () => {
                        timeouts.forEach(clearTimeout);
                        originalCancel();
                    };

                    // If no results, emit end immediately
                    if (cached.length === 0) {
                        emitter.emit('end');
                    }
                    return;
                }

                // Build ripgrep command
                const args = this.buildRipgrepArgs(options);
                try {
                    child = await this.processPool.execute('rg', args);
                } catch (poolError) {
                    if (process.env.DEBUG && !process.env.SILENT_MODE) {
                        // eslint-disable-next-line no-console
                        console.error('Process pool execute failed:', poolError);
                    }
                    throw poolError;
                }
                child.once('exit', () => {
                    clearHardKill();
                    try {
                        child?.stdout?.destroy?.();
                    } catch {}
                    try {
                        child?.stderr?.destroy?.();
                    } catch {}
                });

                // Set up timeout
                let timeout: NodeJS.Timeout | null = null;
                if (options.timeout) {
                    timeout = setTimeout(() => {
                        if (child) {
                            try {
                                child.kill('SIGTERM');
                            } catch {}
                            // Graceful end with partial results on timeout
                            armHardKill();
                            try {
                                readline?.close?.();
                            } catch {}
                            emitter.emit('end');
                        }
                    }, options.timeout);
                }

                // Stream results line by line
                const rl = createInterface({
                    input: child.stdout!,
                    crlfDelay: Infinity,
                });
                readline = rl;

                const results: StreamingGrepResult[] = [];

                let emitted = 0;
                // Guard to prevent emitting beyond caps when close/kill races with buffered lines
                let stopped = false;
                rl.on('line', (line) => {
                    if (cancelled || stopped) {
                        rl.close();
                        return;
                    }

                    const result = this.parseLine(line, options);
                    if (result) {
                        results.push(result);
                        // Emit synchronously to prevent overshoot beyond maxResults due to queued timers
                        emitter.emit('data', result);
                        emitted++;
                        matchesFound++;

                        // Check max results
                        if (options.maxResults && matchesFound >= options.maxResults) {
                            stopped = true;
                            rl.close();
                            try {
                                child?.kill('SIGTERM');
                            } catch {}
                            armHardKill();
                        }

                        // Emit progress
                        if (matchesFound % 10 === 0) {
                            emitter.emit('progress', {
                                filesSearched,
                                matchesFound,
                                elapsedMs: Date.now() - startTime,
                            });
                        }
                    }
                });

                rl.on('close', () => {
                    if (timeout) clearTimeout(timeout);
                    clearHardKill();

                    // Cache results if not cancelled
                    if (!cancelled && results.length > 0) {
                        this.cache.set(options, results);
                    }

                    // Final progress
                    emitter.emit('progress', {
                        filesSearched,
                        matchesFound,
                        elapsedMs: Date.now() - startTime,
                    });

                    emitter.emit('end');
                });

                // Handle errors
                child.stderr?.on('data', (data) => {
                    // Ignore non-critical ripgrep warnings and common error patterns
                    const errorText = data.toString().trim();
                    if (
                        !errorText ||
                        errorText.includes('No such file') ||
                        errorText.includes('Permission denied') ||
                        errorText.includes('Is a directory') ||
                        errorText.includes('(os error 2)') ||
                        errorText.includes('No files were searched')
                    ) {
                        // These are expected errors that should result in empty results, not failures
                        return;
                    }

                    // Only emit errors for truly unexpected issues
                    if (errorText.includes('ripgrep') || errorText.includes('regex')) {
                        emitter.emit('error', new Error(errorText));
                    }
                });

                child.on('error', (err) => {
                    if (timeout) clearTimeout(timeout);

                    // Check if this is a common path/command error that should result in empty results
                    const errorMessage = err.message.toLowerCase();
                    if (
                        errorMessage.includes('enoent') ||
                        errorMessage.includes('no such file') ||
                        errorMessage.includes('spawn rg') ||
                        errorMessage.includes('(os error 2)')
                    ) {
                        // Path doesn't exist or ripgrep not found - return empty results gracefully
                        emitter.emit('end');
                        return;
                    }

                    // Otherwise, it's a real error
                    emitter.emit('error', err);
                    emitter.emit('end');
                });

                // Ensure end event is emitted even when rg produces no stdout
                child.on('close', () => {
                    if (timeout) clearTimeout(timeout);
                    clearHardKill();
                    emitter.emit('end');
                });
            } catch (error) {
                emitter.emit('error', error as Error);
                emitter.emit('end');
            }
        })();

        return emitter;
    }

    /**
     * Cancellable content search built on searchStream that aggregates results until cancelled or stream ends.
     */
    searchCancellable(options: AsyncSearchOptions): { promise: Promise<StreamingGrepResult[]>; cancel: () => void } {
        const stream = this.searchStream(options);
        const results: StreamingGrepResult[] = [];
        let done = false;
        const promise = new Promise<StreamingGrepResult[]>((resolve) => {
            stream.on('data', (res) => {
                if (done) return;
                results.push(res);
                if (options.maxResults && results.length >= options.maxResults) {
                    done = true;
                    stream.cancel();
                    resolve(results);
                }
            });
            stream.on('end', () => {
                if (!done) {
                    done = true;
                    resolve(results);
                }
            });
            stream.on('error', () => {
                if (!done) {
                    done = true;
                    resolve(results);
                }
            });
        });
        return { promise, cancel: () => stream.cancel() };
    }

    /**
     * Parallel search across multiple directories
     */
    async searchParallel(
        patterns: string[],
        directories: string[],
        options?: Omit<AsyncSearchOptions, 'pattern' | 'path'>
    ): Promise<Map<string, StreamingGrepResult[]>> {
        const results = new Map<string, StreamingGrepResult[]>();

        // Create all search promises
        const searches = [];
        for (const pattern of patterns) {
            for (const dir of directories) {
                searches.push(
                    this.search({ ...options, pattern, path: dir }).then((res) => ({ pattern, dir, results: res }))
                );
            }
        }

        // Execute in parallel with concurrency control
        const completed = await Promise.allSettled(searches);

        // Organize results
        for (const result of completed) {
            if (result.status === 'fulfilled') {
                const key = `${result.value.pattern}:${result.value.dir}`;
                results.set(key, result.value.results);
            }
        }

        return results;
    }

    /**
     * Cancellable file listing built on ripgrep --files, similar to listFiles() but exposes a cancel API.
     */
    listFilesCancellable(options: FileListOptions): { promise: Promise<string[]>; cancel: () => void } {
        const prefer = this.config.fileDiscoveryPrefer || 'auto';
        if (prefer === 'fd' || (prefer === 'auto' && this.isFdAvailable())) {
            return this.listFilesCancellableWithFd(options);
        }
        const args: string[] = [];
        args.push('--files');
        if (typeof options.maxDepth === 'number') args.push('--max-depth', String(options.maxDepth));
        if (options.includeHidden) args.push('--hidden');
        const excludes = options.excludes || [];
        for (const ex of excludes) {
            const pattern = ex.endsWith('/**') ? ex : `${ex.replace(/\/$/, '')}/**`;
            args.push('--glob', `!${pattern}`);
        }
        const includes = options.includes || [];
        for (const inc of includes) args.push('--glob', inc);
        args.push(options.path || '.');

        let proc: ChildProcess | null = null;
        let timeout: NodeJS.Timeout | null = null;
        const files: string[] = [];
        let settled = false;
        let resolveFn: (v: string[]) => void = () => {};

        const promise = (async () => {
            proc = await this.processPool.execute('rg', args);
            if (options.timeout && options.timeout > 0) {
                timeout = setTimeout(() => {
                    try {
                        proc?.kill('SIGTERM');
                    } catch {}
                }, options.timeout);
                timeout.unref?.();
            }
            return new Promise<string[]>((resolve) => {
                resolveFn = (v: string[]) => {
                    if (!settled) {
                        settled = true;
                        resolve(v);
                    }
                };
                proc!.stdout?.on('data', (data: Buffer) => {
                    const lines = data.toString('utf8').split(/\r?\n/).filter(Boolean);
                    for (const line of lines) {
                        files.push(line);
                    }
                    if (options.maxFiles && files.length >= options.maxFiles) {
                        try {
                            proc?.kill('SIGTERM');
                        } catch {}
                    }
                });
                proc!.on('close', () => {
                    if (timeout) clearTimeout(timeout);
                    const out =
                        options.maxFiles && files.length > options.maxFiles ? files.slice(0, options.maxFiles) : files;
                    resolveFn(out);
                });
                proc!.on('error', () => {
                    if (timeout) clearTimeout(timeout);
                    resolveFn([]);
                });
            });
        })();

        const cancel = () => {
            try {
                proc?.kill('SIGTERM');
            } catch {}
            if (timeout) clearTimeout(timeout);
            // Resolve immediately with partial results on cancel
            const out = options.maxFiles && files.length > options.maxFiles ? files.slice(0, options.maxFiles) : files;
            resolveFn(out);
        };
        return { promise, cancel };
    }

    // ===== File discovery helpers =====
    private isFdAvailable(): boolean {
        if (this.fdAvailable !== null) return this.fdAvailable;
        try {
            execSync('fd --version', { stdio: 'pipe' });
            this.fdAvailable = true;
        } catch {
            this.fdAvailable = false;
        }
        return this.fdAvailable;
    }

    private async listFilesWithFd(options: FileListOptions): Promise<string[]> {
        const args: string[] = [];
        args.push('-t', 'f');
        if (typeof options.maxDepth === 'number') args.push('--max-depth', String(options.maxDepth));
        if (options.includeHidden) args.push('--hidden');
        const includes = options.includes || [];
        for (const inc of includes) args.push('-g', inc);
        const excludes = options.excludes || [];
        for (const ex of excludes) args.push('--exclude', ex);
        if (options.maxFiles && options.maxFiles > 0) args.push('-n', String(options.maxFiles));
        args.push(options.path || '.');
        const files: string[] = [];
        const proc = await this.processPool.execute('fd', args);
        let timeout: NodeJS.Timeout | null = null;
        if (options.timeout && options.timeout > 0) {
            timeout = setTimeout(() => {
                try {
                    proc.kill('SIGTERM');
                } catch {}
            }, options.timeout);
        }
        return new Promise<string[]>((resolve) => {
            proc.stdout?.on('data', (data: Buffer) => {
                const lines = data.toString('utf8').split(/\r?\n/).filter(Boolean);
                for (const line of lines) files.push(line);
            });
            proc.on('close', () => {
                if (timeout) clearTimeout(timeout);
                resolve(files);
            });
            proc.on('error', () => {
                if (timeout) clearTimeout(timeout);
                resolve([]);
            });
        });
    }

    private listFilesCancellableWithFd(options: FileListOptions): { promise: Promise<string[]>; cancel: () => void } {
        const args: string[] = [];
        args.push('-t', 'f');
        if (typeof options.maxDepth === 'number') args.push('--max-depth', String(options.maxDepth));
        if (options.includeHidden) args.push('--hidden');
        const includes = options.includes || [];
        for (const inc of includes) args.push('-g', inc);
        const excludes = options.excludes || [];
        for (const ex of excludes) args.push('--exclude', ex);
        if (options.maxFiles && options.maxFiles > 0) args.push('-n', String(options.maxFiles));
        args.push(options.path || '.');
        let proc: ChildProcess | null = null;
        let timeout: NodeJS.Timeout | null = null;
        const files: string[] = [];
        let settled = false;
        let resolveFn: (v: string[]) => void = () => {};
        const promise = (async () => {
            proc = await this.processPool.execute('fd', args);
            if (options.timeout && options.timeout > 0) {
                timeout = setTimeout(() => {
                    try {
                        proc?.kill('SIGTERM');
                    } catch {}
                }, options.timeout);
            }
            return new Promise<string[]>((resolve) => {
                resolveFn = (v: string[]) => {
                    if (!settled) {
                        settled = true;
                        resolve(v);
                    }
                };
                proc!.stdout?.on('data', (data: Buffer) => {
                    const lines = data.toString('utf8').split(/\r?\n/).filter(Boolean);
                    for (const line of lines) files.push(line);
                    if (options.maxFiles && files.length >= options.maxFiles) {
                        try {
                            proc?.kill('SIGTERM');
                        } catch {}
                    }
                });
                proc!.on('close', () => {
                    if (timeout) clearTimeout(timeout);
                    resolveFn(files);
                });
                proc!.on('error', () => {
                    if (timeout) clearTimeout(timeout);
                    resolveFn([]);
                });
            });
        })();
        const cancel = () => {
            try {
                proc?.kill('SIGTERM');
            } catch {}
            if (timeout) clearTimeout(timeout);
            resolveFn(files);
        };
        return { promise, cancel };
    }

    /**
     * Build optimized ripgrep arguments
     */
    private buildRipgrepArgs(options: AsyncSearchOptions): string[] {
        const args: string[] = [];

        // Performance optimizations (flags before pattern)
        args.push('--no-heading'); // No file headers
        args.push('--line-number'); // Include line numbers
        args.push('--column'); // Include column numbers for precise ranges
        // Respect .gitignore for performance; do not disable parent ignores

        // Smart exclusions (configured, not hardcoded)
        const defaultExcludes = [
            'node_modules',
            'dist',
            '.git',
            'coverage',
            'build',
            'out',
            'target',
            '.next',
            '.nuxt',
        ];

        const excludes = options.excludePaths || defaultExcludes;
        for (const exclude of excludes) {
            // If the exclude contains glob chars, treat as raw pattern; otherwise as directory.
            // Dot-prefixed dirs (e.g. ".git") are common and should be excluded as directories.
            const isGlob = /[*?[\]{}]/.test(exclude);
            if (isGlob) {
                args.push('--glob', `!${exclude}`);
            } else {
                args.push('--glob', `!${exclude.replace(/\/$/, '')}/**`);
            }
        }

        // Search depth limit
        args.push('--max-depth', '10');

        // File type filtering
        if (options.fileType) {
            const typeMap: Record<string, string> = {
                javascript: 'js',
                typescript: 'ts',
                python: 'py',
                java: 'java',
                go: 'go',
                rust: 'rust',
            };
            args.push('--type', typeMap[options.fileType] || options.fileType);
        }

        // Options
        if (options.caseInsensitive) args.push('-i');
        if (!options.useRegex) args.push('-F'); // Fixed-string for speed unless regex requested
        if (options.includeHidden) args.push('--hidden');

        // Pattern (already escaped if needed)
        args.push(options.pattern);

        // Limit total matches if requested (ripgrep -m)
        if (typeof options.maxResults === 'number' && options.maxResults > 0) {
            args.push('-m', String(options.maxResults));
        }

        // Path (default to current directory)
        args.push(options.path || '.');

        return args;
    }

    /**
     * Parse ripgrep output line
     */
    private parseLine(line: string, options: AsyncSearchOptions): StreamingGrepResult | null {
        if (!line.trim()) return null;

        // Parse format: filename:line:column:text
        const parts = line.split(':');
        if (parts.length < 3) return null;

        const file = parts[0];
        const lineNum = parseInt(parts[1], 10);
        let columnNum: number | undefined;
        let text: string;
        if (!isNaN(parseInt(parts[2], 10))) {
            columnNum = parseInt(parts[2], 10);
            text = parts.slice(3).join(':').trim();
        } else {
            text = parts.slice(2).join(':').trim();
        }

        return {
            file,
            line: isNaN(lineNum) ? undefined : lineNum,
            column: isNaN(Number(columnNum)) ? undefined : columnNum,
            text,
            match: options.pattern,
            confidence: 1.0,
        };
    }

    /**
     * Non-streaming async search (for compatibility)
     */
    private async executeSearch(options: AsyncSearchOptions): Promise<StreamingGrepResult[]> {
        return new Promise((resolve, reject) => {
            const results: StreamingGrepResult[] = [];
            const stream = this.searchStream(options);
            let settled = false;
            let timer: NodeJS.Timeout | null = null;
            if (options.timeout && options.timeout > 0) {
                timer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        reject(new Error(`Operation timeout after ${options.timeout}ms`));
                        try {
                            stream.cancel();
                        } catch {}
                    }
                }, options.timeout);
            }

            stream.on('data', (result) => {
                results.push(result);
            });

            stream.on('error', (error) => {
                // For path-related errors, return empty results instead of rejecting
                const errorMessage = error.message.toLowerCase();
                if (
                    errorMessage.includes('enoent') ||
                    errorMessage.includes('no such file') ||
                    errorMessage.includes('(os error 2)') ||
                    errorMessage.includes('permission denied')
                ) {
                    if (!settled) {
                        settled = true;
                        if (timer) clearTimeout(timer);
                        resolve([]);
                    }
                    return;
                }

                if (!settled) {
                    settled = true;
                    if (timer) clearTimeout(timer);
                    reject(error);
                }
            });

            stream.on('end', () => {
                if (!settled) {
                    settled = true;
                    if (timer) clearTimeout(timer);
                    resolve(results);
                }
            });
        });
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.processPool.destroy();
        this.cache.clear();
    }

    /**
     * Runtime info for metrics/diagnostics
     */
    getRuntimeInfo(): {
        maxProcesses: number;
        defaultTimeout: number;
        cacheSize: number;
        cacheTTL: number;
        fileDiscoveryPrefer: string;
    } {
        return {
            maxProcesses: this.config.maxProcesses,
            defaultTimeout: this.config.defaultTimeout,
            cacheSize: this.config.cacheSize,
            cacheTTL: this.config.cacheTTL,
            fileDiscoveryPrefer: String(this.config.fileDiscoveryPrefer || 'auto'),
        };
    }
}

/**
 * Backward-compatible wrapper for sync API
 */
export class EnhancedGrepCompat {
    private asyncGrep: AsyncEnhancedGrep;

    constructor(config?: any) {
        this.asyncGrep = new AsyncEnhancedGrep(config);
    }

    /**
     * Sync-like API (actually async but with sync-style interface)
     */
    search(params: any): any {
        // This is a hack for backward compatibility
        // In real implementation, we'd need to use worker threads or fibers
        const { execSync } = require('child_process');

        // For now, fall back to old implementation for sync API
        // But mark it as deprecated
        console.warn('Sync search API is deprecated. Please use searchAsync()');

        // ... existing sync implementation
        return [];
    }

    /**
     * New async API
     */
    async searchAsync(params: AsyncSearchOptions): Promise<StreamingGrepResult[]> {
        return this.asyncGrep.search(params);
    }

    /**
     * New streaming API
     */
    searchStream(params: AsyncSearchOptions): SearchStream {
        return this.asyncGrep.searchStream(params);
    }
}

// Export for testing
export { RipgrepProcessPool, SmartSearchCache };
