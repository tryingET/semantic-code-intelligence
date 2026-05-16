// Enhanced Search Tools Type Definitions
// Comprehensive types for our independent search tool implementations

// Base performance and caching interfaces
export interface PerformanceMetrics {
    searchCount: number;
    totalTime: number;
    averageTime: number;
    cacheHits: number;
    errors: number;
    successRate?: number;
    throughputPerSecond?: number;
}

export interface CacheConfiguration {
    enabled: boolean;
    maxSize: number;
    ttl: number; // Time to live in milliseconds
    maxMemory: number; // Maximum memory usage in bytes
    evictionPolicy: 'lru' | 'lfu' | 'ttl';
}

export interface SearchToolConfiguration {
    timeout: number;
    maxConcurrency: number;
    enableCache: boolean;
    enableMetrics: boolean;
    enableHealthCheck: boolean;
}

// Enhanced Grep Types
export interface EnhancedGrepConfiguration extends SearchToolConfiguration {
    useRipgrep: boolean;
    fallbackToNodeGrep: boolean;
    maxFileSize: number;
    encoding: string;
    contextLines: number;
    maxResults: number;
    supportedEncodings: string[];
    binaryFileDetection: boolean;
}

export interface GrepSearchOptions {
    pattern: string;
    path?: string;
    outputMode?: 'content' | 'files_with_matches' | 'count';
    caseInsensitive?: boolean;
    wholeWords?: boolean;
    lineNumbers?: boolean;
    columnNumbers?: boolean;
    contextBefore?: number;
    contextAfter?: number;
    contextAround?: number;
    multiline?: boolean;
    dotAll?: boolean;
    headLimit?: number;
    timeout?: number;
    maxFileSize?: number;
    encoding?: string;
    fileTypes?: string[];
    ignorePatterns?: string[];
    followSymlinks?: boolean;
    includeHidden?: boolean;
    recursive?: boolean;
    invertMatch?: boolean;
    onlyMatching?: boolean;
    useRustRegex?: boolean;
}

export interface GrepSearchResult {
    file: string;
    line?: number;
    column?: number;
    text?: string;
    match?: string;
    matchStart?: number;
    matchEnd?: number;
    context?: {
        before?: string[];
        after?: string[];
        lineNumbers?: number[];
    };
    confidence?: number;
    metadata?: {
        fileSize?: number;
        modified?: Date;
        encoding?: string;
        mimeType?: string;
        lineCount?: number;
    };
    highlightRanges?: Array<{
        start: number;
        end: number;
        type: 'match' | 'context';
    }>;
}

export interface GrepMetrics extends PerformanceMetrics {
    filesSearched: number;
    matchesFound: number;
    bytesSearched: number;
    ripgrepUsed: number;
    nodejsUsed: number;
    timeoutOccurred: number;
    binaryFilesSkipped: number;
    permissionDenied: number;
}

// Enhanced Glob Types
export interface EnhancedGlobConfiguration extends SearchToolConfiguration {
    maxFiles: number;
    respectGitignore: boolean;
    followSymlinks: boolean;
    includeBrokenSymlinks: boolean;
    caseSensitive: boolean;
    sortResults: boolean;
    includeMetadata: boolean;
}

export interface GlobSearchOptions {
    pattern: string | string[];
    path?: string;
    sortByModified?: boolean;
    sortBy?: 'name' | 'size' | 'modified' | 'extension' | 'type';
    sortOrder?: 'asc' | 'desc';
    followSymlinks?: boolean;
    maxDepth?: number;
    minDepth?: number;
    ignorePatterns?: string[];
    includeHidden?: boolean;
    includeDirectories?: boolean;
    includeFiles?: boolean;
    onlyFiles?: boolean;
    onlyDirectories?: boolean;
    timeout?: number;
    caseSensitive?: boolean;
    absolute?: boolean;
    markDirectories?: boolean;
    suppressErrors?: boolean;
    gitignore?: boolean;
    dotfiles?: boolean;
    maxFiles?: number;
    statFiles?: boolean;
    fileFilter?: (path: string, stats?: FileStats) => boolean;
    dirFilter?: (path: string, stats?: FileStats) => boolean;
}

export interface FileStats {
    size: number;
    modified: Date;
    created: Date;
    accessed: Date;
    type: 'file' | 'directory' | 'symlink' | 'unknown';
    permissions: string;
    isReadable: boolean;
    isWritable: boolean;
    isExecutable: boolean;
    extension?: string;
    basename: string;
    dirname: string;
}

export interface GlobSearchResult {
    files: string[];
    directories?: string[];
    symlinks?: string[];
    metadata?: {
        totalFiles: number;
        totalDirectories: number;
        searchTime: number;
        skippedFiles: number;
        errors: string[];
        matchedPatterns: string[];
        ignoredPatterns: string[];
        searchPath: string;
        depth: {
            min: number;
            max: number;
            average: number;
        };
    };
    fileStats?: Map<string, FileStats>;
}

export interface GlobMetrics extends PerformanceMetrics {
    patternsProcessed: number;
    filesMatched: number;
    directoriesTraversed: number;
    symlinksFollowed: number;
    maxDepthReached: number;
    gitignoreRulesApplied: number;
    permissionErrors: number;
}

// Enhanced LS Types
export interface EnhancedLSConfiguration extends SearchToolConfiguration {
    maxEntries: number;
    includeMimeType: boolean;
    includePermissions: boolean;
    includeExtendedAttributes: boolean;
    followSymlinks: boolean;
    resolveSymlinks: boolean;
    sortResults: boolean;
    groupDirectoriesFirst: boolean;
}

export interface LSOptions {
    path: string;
    recursive?: boolean;
    maxDepth?: number;
    includeHidden?: boolean;
    followSymlinks?: boolean;
    resolveSymlinks?: boolean;
    ignorePatterns?: string[];
    includePatterns?: string[];
    includeMetadata?: boolean;
    includePermissions?: boolean;
    includeExtendedAttributes?: boolean;
    sortBy?: 'name' | 'size' | 'modified' | 'created' | 'type' | 'extension';
    sortOrder?: 'asc' | 'desc';
    groupBy?: 'none' | 'type' | 'extension' | 'directory';
    timeout?: number;
    maxEntries?: number;
    showSize?: boolean;
    humanReadableSize?: boolean;
    showPermissions?: boolean;
    showOwner?: boolean;
    showGroup?: boolean;
    showModified?: boolean;
    includeTotal?: boolean;
    colorOutput?: boolean;
    longFormat?: boolean;
    onePerLine?: boolean;
    entryFilter?: (entry: LSEntry) => boolean;
}

export interface LSEntry {
    name: string;
    path: string;
    absolutePath: string;
    relativePath?: string;
    type: 'file' | 'directory' | 'symlink' | 'block-device' | 'char-device' | 'fifo' | 'socket' | 'unknown';
    size?: number;
    sizeHuman?: string;
    modified?: Date;
    created?: Date;
    accessed?: Date;
    permissions?: string;
    mode?: number;
    uid?: number;
    gid?: number;
    owner?: string;
    group?: string;
    isReadable?: boolean;
    isWritable?: boolean;
    isExecutable?: boolean;
    isHidden?: boolean;
    extension?: string;
    mimeType?: string;
    symlinkTarget?: string;
    symlinkTargetType?: 'file' | 'directory' | 'broken';
    hardLinks?: number;
    inode?: number;
    device?: number;
    blockSize?: number;
    blocks?: number;
    extendedAttributes?: Record<string, string>;
    checksum?: {
        algorithm: 'md5' | 'sha1' | 'sha256';
        value: string;
    };
}

export interface LSResult {
    entries: LSEntry[];
    metadata?: {
        totalEntries: number;
        totalFiles: number;
        totalDirectories: number;
        totalSymlinks: number;
        totalSize: number;
        totalSizeHuman: string;
        searchTime: number;
        errors: string[];
        warnings: string[];
        path: string;
        searchDepth: number;
        hiddenFilesFound: number;
        permissionDeniedCount: number;
        brokenSymlinksFound: number;
    };
    groupedResults?: {
        files: LSEntry[];
        directories: LSEntry[];
        symlinks: LSEntry[];
        others: LSEntry[];
    };
    summary?: {
        byType: Record<string, number>;
        byExtension: Record<string, number>;
        sizeDistribution: {
            small: number; // < 1KB
            medium: number; // 1KB - 1MB
            large: number; // 1MB - 100MB
            huge: number; // > 100MB
        };
    };
}

export interface LSMetrics extends PerformanceMetrics {
    entriesListed: number;
    directoriesTraversed: number;
    maxDepthReached: number;
    hiddenFilesProcessed: number;
    symlinksResolved: number;
    permissionErrors: number;
    brokenSymlinks: number;
    totalSizeProcessed: number;
}

// Unified tool interfaces
export interface EnhancedSearchToolsInterface {
    grep: {
        search(options: GrepSearchOptions): Promise<GrepSearchResult[]>;
        getMetrics(): GrepMetrics;
        getConfiguration(): EnhancedGrepConfiguration;
        setConfiguration(config: Partial<EnhancedGrepConfiguration>): void;
        healthCheck(): Promise<boolean>;
        clearCache(): void;
    };

    glob: {
        search(options: GlobSearchOptions): Promise<GlobSearchResult>;
        getMetrics(): GlobMetrics;
        getConfiguration(): EnhancedGlobConfiguration;
        setConfiguration(config: Partial<EnhancedGlobConfiguration>): void;
        healthCheck(): Promise<boolean>;
        clearCache(): void;
    };

    ls: {
        list(options: LSOptions): Promise<LSResult>;
        getMetrics(): LSMetrics;
        getConfiguration(): EnhancedLSConfiguration;
        setConfiguration(config: Partial<EnhancedLSConfiguration>): void;
        healthCheck(): Promise<boolean>;
        clearCache(): void;
    };
}

export interface CombinedSearchResult {
    query: string;
    timestamp: Date;
    totalTime: number;
    results: {
        grep?: GrepSearchResult[];
        glob?: GlobSearchResult;
        ls?: LSResult;
    };
    metrics: {
        grep?: GrepMetrics;
        glob?: GlobMetrics;
        ls?: LSMetrics;
        combined: PerformanceMetrics;
    };
    errors: string[];
    warnings: string[];
    cacheHits: string[];
    toolsUsed: string[];
    confidence: number;
    suggestions?: string[];
}

// Health check and monitoring
export interface HealthCheckResult {
    tool: 'grep' | 'glob' | 'ls';
    healthy: boolean;
    responseTime?: number;
    error?: string;
    version?: string;
    capabilities?: string[];
    lastChecked: Date;
}

export interface SystemHealth {
    overall: boolean;
    tools: {
        grep: HealthCheckResult;
        glob: HealthCheckResult;
        ls: HealthCheckResult;
    };
    system: {
        memoryUsage: number;
        cacheSize: number;
        uptime: number;
        totalSearches: number;
        errorRate: number;
    };
    recommendations?: string[];
}

// Error types for enhanced tools
export class EnhancedToolError extends Error {
    constructor(
        message: string,
        public tool: 'grep' | 'glob' | 'ls',
        public operation: string,
        public originalError?: Error,
        public context?: any
    ) {
        super(message);
        this.name = 'EnhancedToolError';
    }
}

export class SearchTimeoutError extends EnhancedToolError {
    constructor(tool: 'grep' | 'glob' | 'ls', timeout: number, operation: string) {
        super(`Search timed out after ${timeout}ms`, tool, operation);
        this.name = 'SearchTimeoutError';
    }
}

export class PermissionError extends EnhancedToolError {
    constructor(tool: 'grep' | 'glob' | 'ls', path: string) {
        super(`Permission denied accessing: ${path}`, tool, 'access');
        this.name = 'PermissionError';
    }
}

export class ConfigurationError extends EnhancedToolError {
    constructor(tool: 'grep' | 'glob' | 'ls', message: string) {
        super(`Configuration error: ${message}`, tool, 'config');
        this.name = 'ConfigurationError';
    }
}

// Utility types
export type SearchPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface SearchRequest {
    id: string;
    type: 'grep' | 'glob' | 'ls' | 'combined';
    priority: SearchPriority;
    options: GrepSearchOptions | GlobSearchOptions | LSOptions;
    timeout?: number;
    retries?: number;
    callback?: (result: any) => void;
    context?: any;
}

export interface SearchQueue {
    add(request: SearchRequest): Promise<string>;
    remove(id: string): boolean;
    clear(): void;
    size(): number;
    pending(): SearchRequest[];
    active(): SearchRequest[];
}

export type ToolEventType =
    | 'search-start'
    | 'search-complete'
    | 'search-error'
    | 'cache-hit'
    | 'cache-miss'
    | 'timeout'
    | 'configuration-change'
    | 'health-check';

export interface ToolEvent {
    type: ToolEventType;
    tool: 'grep' | 'glob' | 'ls';
    timestamp: Date;
    data: any;
    duration?: number;
    error?: Error;
}

export type EventListener = (event: ToolEvent) => void;

// Export all enhanced tool types
export * from './core';
