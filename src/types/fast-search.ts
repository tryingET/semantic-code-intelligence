// Types for fast search tools integration
// These represent the interfaces for Grep, Glob, and LS tools

export interface ClaudeGrepParams {
    pattern: string;
    path?: string;
    output_mode?: 'content' | 'files_with_matches' | 'count';
    type?: string;
    glob?: string;
    // Optional per-invocation timeout in milliseconds. When provided,
    // both async and sync grep paths should respect this budget.
    timeout?: number;
    '-i'?: boolean; // case insensitive
    '-n'?: boolean; // line numbers
    '-A'?: number; // after context
    '-B'?: number; // before context
    '-C'?: number; // context
    head_limit?: number;
    multiline?: boolean;
}

export interface ClaudeGrepResult {
    file?: string;
    line?: number;
    column?: number;
    text?: string;
    match?: string;
    context?: {
        before?: string[];
        after?: string[];
    };
}

export interface ClaudeGlobParams {
    pattern: string;
    path?: string;
}

export type ClaudeGlobResult = string[];

export interface ClaudeLSParams {
    path: string;
    ignore?: string[];
}

export interface ClaudeLSEntry {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'symlink';
    size?: number;
    modified?: Date;
}

export type ClaudeLSResult = ClaudeLSEntry[];

// Wrapper interfaces for our tool integration
export interface ClaudeToolsAPI {
    grep(params: ClaudeGrepParams): Promise<ClaudeGrepResult[] | string[]>;
    glob(params: ClaudeGlobParams): Promise<ClaudeGlobResult>;
    ls(params: ClaudeLSParams): Promise<ClaudeLSResult>;
}

// Search strategies using Claude tools
export interface GrepSearchStrategy {
    name: string;
    params: ClaudeGrepParams;
    confidence: number;
    timeout?: number;
}

export interface SearchVariant {
    pattern: string;
    confidence: number;
    strategy: 'exact' | 'fuzzy' | 'semantic' | 'pattern';
}

export interface GrepSearchResult {
    strategy: GrepSearchStrategy;
    matches: ClaudeGrepResult[];
    searchTime: number;
    success: boolean;
    error?: string;
}

export interface GlobSearchResult {
    pattern: string;
    files: string[];
    searchTime: number;
    success: boolean;
}

export interface LSAnalysisResult {
    directory: string;
    entries: ClaudeLSEntry[];
    colocatedFiles: string[];
    searchTime: number;
    success: boolean;
}

// Combined search results
export interface HybridSearchResult {
    query: string;
    exact: GrepSearchResult[];
    fuzzy: GrepSearchResult[];
    files: GlobSearchResult[];
    structure: LSAnalysisResult[];
    totalTime: number;
    success: boolean;
}

// Optimization types
export interface SearchCache {
    key: string;
    result: HybridSearchResult;
    timestamp: Date;
    hits: number;
}

export interface SearchOptimization {
    bloomFilter?: boolean;
    frequencyCache?: boolean;
    recentSearches?: boolean;
    negativeLookup?: boolean;
}

// Error handling
export class ClaudeToolError extends Error {
    constructor(
        message: string,
        public tool: 'grep' | 'glob' | 'ls',
        public params: any,
        public originalError?: Error
    ) {
        super(message);
        this.name = 'ClaudeToolError';
    }
}

// Configuration for Claude tools layer
export interface ClaudeToolsLayerConfig {
    grep: {
        defaultTimeout: number;
        maxResults: number;
        caseSensitive: boolean;
        includeContext: boolean;
        contextLines: number;
    };
    glob: {
        defaultTimeout: number;
        maxFiles: number;
        ignorePatterns: string[];
    };
    ls: {
        defaultTimeout: number;
        maxDepth: number;
        followSymlinks: boolean;
        includeDotfiles: boolean;
    };
    optimization: SearchOptimization;
    caching: {
        enabled: boolean;
        ttl: number;
        maxEntries: number;
    };
}

// New, vendor-neutral type aliases for forward compatibility
export type FastGrepParams = ClaudeGrepParams;
export type FastGrepResult = ClaudeGrepResult;
export type FastGlobParams = ClaudeGlobParams;
export type FastGlobResult = ClaudeGlobResult;
export type FastLSParams = ClaudeLSParams;
export type FastLSEntry = ClaudeLSEntry;
export type FastLSResult = ClaudeLSResult;
export type FastToolsAPI = ClaudeToolsAPI;
export type FastGrepSearchStrategy = GrepSearchStrategy;
export type FastSearchVariant = SearchVariant;
export type FastGrepSearchResult = GrepSearchResult;
export type FastGlobSearchResult = GlobSearchResult;
export type FastLSAnalysisResult = LSAnalysisResult;
export type FastHybridSearchResult = HybridSearchResult;
export type FastSearchCache = SearchCache;
export type FastSearchOptimization = SearchOptimization;
export type FastSearchLayerConfig = ClaudeToolsLayerConfig;
