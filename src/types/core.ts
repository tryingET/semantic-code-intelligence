// Core type definitions for the ontology-enhanced LSP proxy
import { type Location, Position, type Range } from 'vscode-languageserver';

// Ullmann triangle primitives (Layer 4 semantics)
// - Thing: referent in the domain (here: code entity / anchor)
// - Concept: conceptualization (meaning cluster)
// - Symbol: notation/lexeme used to denote concepts and things
export interface Symbol {
    id: string;
    text: string;
    /** Optional language/system that scoped this symbol (e.g. 'ts', 'js', 'yaml'). */
    language?: string;
    confidence: number;
}

export enum ThingKind {
    Function = 'function',
    Variable = 'variable',
    Class = 'class',
    Interface = 'interface',
    Method = 'method',
    Property = 'property',
    Type = 'type',
    Module = 'module',
}

export interface Thing {
    id: string;
    kind: ThingKind;
    location: Location;
    signature?: string;
    typeInfo?: TypeInformation;
    confidence: number;
    firstSeen?: Date;
    lastSeen?: Date;
    occurrences?: number;
    context?: string;
}

export interface TypeInformation {
    returnType?: string;
    parameters?: Parameter[];
    generic?: boolean;
    exported?: boolean;
}

export interface Parameter {
    name: string;
    type?: string;
    optional?: boolean;
    default?: string;
}

// Search and matching types
export interface SearchQuery {
    identifier: string;
    searchPath?: string;
    fileTypes?: string[];
    caseSensitive?: boolean;
    includeTests?: boolean;
    context?: SearchContext;
}

export interface SearchContext {
    file?: string;
    line?: number;
    column?: number;
    surroundingCode?: string;
}

// Match categorization types for smart prioritization
export type MatchCategory = 'likely-definition' | 'likely-import' | 'likely-usage' | 'unknown';

export interface Match {
    file: string;
    line: number;
    column: number;
    text: string;
    length: number;
    confidence: number;
    source: 'exact' | 'fuzzy' | 'conceptual' | 'pattern';
    context?: string;
    // Smart categorization for Layer 1 results
    category?: MatchCategory;
    categoryConfidence?: number;
}

export interface EnhancedMatches {
    exact: Match[];
    fuzzy: Match[];
    conceptual: Match[];
    files: Set<string>;
    searchTime: number;
    toolsUsed?: string[];
    confidence?: number;
    metadata?: {
        totalFiles?: number;
        skippedFiles?: number;
        cacheHit?: boolean;
        errors?: string[];
    };
}

// Layer 4: Semantic graph types
export interface Concept {
    id: string;
    canonicalName: string;
    /** Optional high-level semantic category (best-effort). */
    type?: string;
    relations: Map<string, Relation>;
    signature: ConceptSignature;
    evolution: EvolutionHistory[];
    metadata: ConceptMetadata;
    confidence: number;
}

export type ThingSymbolRole = 'declaration' | 'reference' | 'usage' | 'unknown';

export interface ThingSymbolLink {
    thingId: string;
    symbolId: string;
    role: ThingSymbolRole;
}

export interface ThingConceptLink {
    thingId: string;
    conceptId: string;
    confidence: number;
    evidence?: string[];
}

export interface Relation {
    id: string;
    targetConceptId: string;
    type: RelationType;
    confidence: number;
    evidence: string[];
    createdAt: Date;
}

export interface RelatedConcept {
    concept: Concept;
    relationship: Relation;
    distance: number;
    path?: string[];
}

export enum RelationType {
    Extends = 'extends',
    Implements = 'implements',
    Uses = 'uses',
    Calls = 'calls',
    References = 'references',
    SimilarTo = 'similar_to',
    CoChanges = 'co_changes',
}

export interface ConceptSignature {
    parameters: string[];
    returnType?: string;
    sideEffects: string[];
    complexity: number;
    fingerprint: string;
}

export interface EvolutionHistory {
    timestamp: Date;
    type: 'rename' | 'signature' | 'relation' | 'canonical_rename' | 'move';
    from: string;
    to: string;
    reason: string;
    confidence: number;
}

export interface ConceptMetadata {
    category?: string;
    tags: string[];
    isInterface?: boolean;
    isAbstract?: boolean;
    isDeprecated?: boolean;
    documentation?: string;
}

// Pattern types
export interface Pattern {
    id: string;
    name?: string;
    description?: string;
    from: TokenPattern[];
    to: TokenPattern[];
    confidence: number;
    occurrences: number;
    examples: Example[];
    createdAt?: Date;
    lastApplied: Date;
    category: PatternCategory;
    metadata?: Record<string, any>;
}

export interface TokenPattern {
    type: 'literal' | 'variable' | 'class' | 'transform';
    value?: string;
    name?: string;
    class?: string;
    transform?: string;
    sourceIndex?: number;
}

export enum PatternCategory {
    General = 'general',
    Rename = 'rename',
    Refactor = 'refactor',
    Convention = 'convention',
    Migration = 'migration',
}

export interface Example {
    oldName: string;
    newName: string;
    context: RenameContext;
    confidence: number;
}

export interface RenameContext {
    file: string;
    concept?: Concept;
    surroundingSymbols: string[];
    timestamp: Date;
}

// Layer architecture
export interface Layer<T, R> {
    name: string;
    process(input: T): Promise<R>;
    fallback?: () => R;
    timeout: number;
}

export interface CacheStrategy {
    enabled: boolean;
    ttl: number;
    maxSize: number;
    type: 'memory' | 'disk' | 'hybrid';
}

// Request context
export interface RequestContext {
    id: string;
    timestamp: Date;
    method: string;
    params: any;
    grepResults?: Match[];
    astNodes?: ASTNode[];
    concept?: Concept;
    patterns?: Pattern[];
    suggestions?: Suggestion[];
    cacheHit?: boolean;
    searchTime?: number;
    error?: Error;
}

// AST types
export interface ASTNode {
    id: string;
    type: string;
    text: string;
    range: Range;
    children: string[];
    parent?: string;
    metadata: NodeMetadata;
}

export interface NodeMetadata {
    conceptId?: string;
    conceptName?: string;
    conceptConfidence?: number;
    semanticType?: string;
    functionName?: string;
    className?: string;
    parameters?: string[];
    returnType?: string;
    imports?: Import[];
    exports?: Export[];
    calls?: string[];
    references?: string[];
    extends?: string;
    implements?: string[];
}

export interface Import {
    source: string;
    specifiers: ImportSpecifier[];
}

export interface ImportSpecifier {
    name: string;
    alias?: string;
    type: 'default' | 'named' | 'namespace';
}

export interface Export {
    name: string;
    type: 'default' | 'named';
}

// Propagation types
export interface Change {
    type: 'rename' | 'signature' | 'move' | 'delete';
    identifier: string;
    from: string;
    to?: string;
    location: string;
    source: string;
    timestamp: Date;
}

export interface Suggestion {
    type: string;
    target: string;
    suggestion: string;
    confidence: number;
    reason: string;
    path?: string[];
    autoApply: boolean;
    evidence?: string[];
}

export interface PropagationPath {
    source: string;
    target: string;
    steps: string[];
    confidence: number;
    reason: string;
}

// Configuration types
export interface Config {
    layers: LayerConfig;
    performance: PerformanceConfig;
    search: SearchConfig;
    patterns: PatternConfig;
    monitoring: MonitoringConfig;
}

export interface LayerConfig {
    layer1_fast: FastSearchConfig;
    tree_sitter: TreeSitterConfig;
    ontology: OntologyConfig;
    patterns: PatternLearningConfig;
    propagation: PropagationConfig;
}

export interface FastSearchConfig {
    enabled: boolean;
    timeout: number;
    maxResults: number;
    fileTypes: string[];
}

export interface TreeSitterConfig {
    enabled: boolean;
    timeout: number;
    languages: string[];
    maxFileSize: string;
    projectPath?: string; // Optional path to detect languages from
}

export interface OntologyConfig {
    enabled: boolean;
    dbPath: string;
    cacheSize: number;
}

export interface PatternLearningConfig {
    enabled: boolean;
    learningThreshold: number;
    confidenceThreshold: number;
    maxPatterns: number;
}

export interface PropagationConfig {
    enabled: boolean;
    maxDepth: number;
    autoApplyThreshold: number;
}

export interface PerformanceConfig {
    caching: CachingConfig;
    parallelism: ParallelismConfig;
    indexing: IndexingConfig;
}

export interface CachingConfig {
    memory: MemoryCacheConfig;
    disk: DiskCacheConfig;
}

export interface MemoryCacheConfig {
    maxSize: string;
    ttl: number;
}

export interface DiskCacheConfig {
    enabled: boolean;
    path: string;
    maxSize: string;
}

export interface ParallelismConfig {
    workers: number;
    batchSize: number;
}

export interface IndexingConfig {
    incremental: boolean;
    watchDebounce: number;
}

export interface SearchConfig {
    fuzzy: FuzzySearchConfig;
    context: ContextConfig;
}

export interface FuzzySearchConfig {
    editDistanceThreshold: number;
    tokenOverlapThreshold: number;
    semanticSimilarityThreshold: number;
}

export interface ContextConfig {
    windowSize: number;
    includeComments: boolean;
    includeStrings: boolean;
}

export interface PatternConfig {
    synonyms: Record<string, string[]>;
    transformations: TransformationConfig;
}

export interface TransformationConfig {
    camelCase: boolean;
    snake_case: boolean;
    PascalCase: boolean;
    'kebab-case': boolean;
}

export interface MonitoringConfig {
    metrics: MetricsConfig;
    logging: LoggingConfig;
}

export interface MetricsConfig {
    enabled: boolean;
}

export interface LoggingConfig {
    level: string;
    format: string;
}

// Result types
export interface RefactorResult {
    changes: FileChange[];
    concept?: Concept;
    pattern?: Pattern;
    propagated?: Suggestion[];
    mode: 'fast' | 'thorough' | 'semantic';
    searchTime?: number;
    totalTime: number;
    confidence: number;
}

export interface FileChange {
    file: string;
    edits: TextEdit[];
    confidence: number;
    reason: string;
}

export interface TextEdit {
    range: Range;
    newText: string;
    oldText: string;
}

// Error types
export class OntologyError extends Error {
    constructor(
        message: string,
        public code: string,
        public details?: any
    ) {
        super(message);
        this.name = 'OntologyError';
    }
}

export class LayerError extends OntologyError {
    constructor(
        message: string,
        public layer: string,
        public originalError?: Error
    ) {
        super(message, 'LAYER_ERROR', { layer, originalError });
    }
}

export class ConfigError extends OntologyError {
    constructor(
        message: string,
        public configPath?: string
    ) {
        super(message, 'CONFIG_ERROR', { configPath });
    }
}

// Utility types
export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export interface Disposable {
    dispose(): void | Promise<void>;
}

export interface EventEmitter<T = any> {
    on(event: string, listener: (data: T) => void): void;
    off(event: string, listener: (data: T) => void): void;
    emit(event: string, data: T): void;
}
