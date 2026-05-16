/**
 * Core types for the unified, protocol-agnostic architecture
 * These types are independent of LSP, MCP, HTTP or any other protocol
 */

// Performance monitoring types
export interface PerformanceMetrics {
    startTime: number;
    endTime?: number;
    duration?: number;
    layer: string;
    operation: string;
    cacheHit?: boolean;
    errorCount?: number;
    requestId: string;
}

export interface LayerPerformance {
    layer1: number; // Target: ~5ms
    layer2: number; // Target: ~50ms
    layer3: number; // Target: ~10ms
    layer4: number; // Target: ~10ms
    layer5: number; // Target: ~20ms
    total: number; // Target: <100ms
}

// Core result types (protocol-agnostic)
export type ResultSource = 'exact' | 'fuzzy' | 'conceptual' | 'pattern';

export interface Definition {
    identifier: string;
    /** Best-effort extracted token name (may differ from requested identifier). */
    name?: string;
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    kind: DefinitionKind;
    confidence: number;
    source: ResultSource;
    /** Producing layer hint (e.g. layer1, layer2, async-layer1). */
    layer?: string;
    /** Set when validated or refined by AST (Layer 2). */
    astValidated?: boolean;
    context?: string;
    metadata?: Record<string, any>;
}

export const DefinitionKind = {
    Function: 'function',
    Variable: 'variable',
    Class: 'class',
    Interface: 'interface',
    Method: 'method',
    Property: 'property',
    Type: 'type',
    Module: 'module',
    Import: 'import',
    Export: 'export',
} as const;
export type DefinitionKind = (typeof DefinitionKind)[keyof typeof DefinitionKind];

export interface Reference {
    identifier: string;
    /** Best-effort extracted token name (may differ from requested identifier). */
    name?: string;
    uri: string;
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    kind: ReferenceKind;
    confidence: number;
    source?: ResultSource;
    layer?: string;
    astValidated?: boolean;
    isDeclaration?: boolean;
    context?: string;
    metadata?: Record<string, any>;
}

export const ReferenceKind = {
    Usage: 'usage',
    Definition: 'definition',
    Import: 'import',
    Export: 'export',
    Call: 'call',
    Assignment: 'assignment',
} as const;
export type ReferenceKind = (typeof ReferenceKind)[keyof typeof ReferenceKind];

export interface Completion {
    label: string;
    kind: CompletionKind;
    detail?: string;
    documentation?: string;
    insertText?: string;
    confidence: number;
    sortText?: string;
    filterText?: string;
    patternId?: string;
    source?: ResultSource;
    layer?: string;
}

export const CompletionKind = {
    Text: 'text',
    Method: 'method',
    Function: 'function',
    Constructor: 'constructor',
    Field: 'field',
    Variable: 'variable',
    Class: 'class',
    Interface: 'interface',
    Module: 'module',
    Property: 'property',
    Unit: 'unit',
    Value: 'value',
    Enum: 'enum',
    Keyword: 'keyword',
    Snippet: 'snippet',
    Color: 'color',
    File: 'file',
    Reference: 'reference',
    Folder: 'folder',
    EnumMember: 'enumMember',
    Constant: 'constant',
    Struct: 'struct',
    Event: 'event',
    Operator: 'operator',
    TypeParameter: 'typeParameter',
    Pattern: 'pattern',
} as const;
export type CompletionKind = (typeof CompletionKind)[keyof typeof CompletionKind];

export interface WorkspaceEdit {
    changes: Record<string, TextEdit[]>;
    metadata?: {
        needsConfirmation?: boolean;
        description?: string;
        patternId?: string;
    };
}

export interface TextEdit {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    newText: string;
}

export interface Diagnostic {
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    severity: DiagnosticSeverity;
    code?: string | number;
    message: string;
    source?: string;
    relatedInformation?: DiagnosticRelatedInfo[];
}

export enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

export interface DiagnosticRelatedInfo {
    location: {
        uri: string;
        range: {
            start: { line: number; character: number };
            end: { line: number; character: number };
        };
    };
    message: string;
}

// Core analysis request types
export interface FindDefinitionRequest {
    uri: string;
    position: { line: number; character: number };
    identifier: string;
    includeDeclaration?: boolean;
    includeReferences?: boolean;
    maxResults?: number;
    fuzzyMatching?: boolean;
    precise?: boolean; // request a budgeted AST validation pass
}

export interface FindReferencesRequest {
    uri: string;
    position: { line: number; character: number };
    identifier: string;
    includeDeclaration?: boolean;
    maxResults?: number;
    fuzzyMatching?: boolean;
    includeTests?: boolean;
    precise?: boolean; // request a budgeted AST validation pass
}

export interface PrepareRenameRequest {
    uri: string;
    position: { line: number; character: number };
    identifier: string;
}

export interface RenameRequest {
    uri: string;
    position: { line: number; character: number };
    oldName: string;
    newName: string;
    propagate?: boolean;
    dryRun?: boolean;
}

export interface CompletionRequest {
    uri: string;
    position: { line: number; character: number };
    context?: CompletionContext;
    maxResults?: number;
}

export interface CompletionContext {
    triggerKind: CompletionTriggerKind;
    triggerCharacter?: string;
}

export enum CompletionTriggerKind {
    Invoked = 1,
    TriggerCharacter = 2,
    TriggerForIncompleteCompletions = 3,
}

// Core response types with performance info
export interface AnalysisResult<T> {
    data: T;
    performance: LayerPerformance;
    requestId: string;
    cacheHit: boolean;
    timestamp: number;
}

export type FindDefinitionResult = AnalysisResult<Definition[]>;
export type FindReferencesResult = AnalysisResult<Reference[]>;
export type PrepareRenameResult = AnalysisResult<{
    range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
    placeholder: string;
}>;
export type RenameResult = AnalysisResult<WorkspaceEdit>;
export type CompletionResult = AnalysisResult<Completion[]>;

// Aggregate exploration request/result types
export interface ExploreRequest {
    uri: string; // workspace or file context
    identifier: string;
    includeDeclaration?: boolean;
    maxResults?: number;
    precise?: boolean; // forward to both definitions and references
}

export interface ExploreResultPerformance {
    definitions?: LayerPerformance;
    references?: LayerPerformance;
    total: number;
}

export interface ExploreResult {
    /** Wire/schema version for cross-adapter payload stability. */
    schemaVersion: 2;
    symbol: string;
    contextUri: string;
    definitions: Definition[];
    references: Reference[];
    performance: ExploreResultPerformance;
    diagnostics?: Record<string, any>;
    timestamp: number;
}

// Layer interfaces
export interface Layer {
    name: string;
    version?: string;
    targetLatency: number; // in milliseconds
    initialize?(): Promise<void>;
    dispose?(): Promise<void>;
    isHealthy?(): boolean;
    getMetrics?(): LayerMetrics;
    // Generic process method - layers can implement with specific types
    process?(input: any): Promise<any>;
    // Fallback method for when process fails
    fallback?(): any;
    // Timeout property (compatible with Layer<T,R>)
    timeout?: number;
}

export interface LayerMetrics {
    name: string;
    requestCount: number;
    averageLatency: number;
    p95Latency: number;
    errorCount: number;
    cacheHitRate: number;
    lastRequestTime?: number;
}

export interface LayerManager {
    initialize(): Promise<void>;
    dispose(): Promise<void>;
    getLayer(name: string): Layer | undefined;
    getAllMetrics(): LayerMetrics[];
    isHealthy(): boolean;
    getPerformanceReport(): PerformanceReport;
}

export interface PerformanceReport {
    totalRequests: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    errorRate: number;
    cacheHitRate: number;
    layerBreakdown: Record<string, LayerMetrics>;
    generatedAt: number;
}

// Configuration types
export interface CoreConfig {
    layers: LayerConfigs;
    performance: PerformanceConfig;
    cache: CacheConfig;
    monitoring: MonitoringConfig;
    /** Absolute path to workspace root (used for "file://workspace" resolution). */
    workspaceRoot?: string;
    /** Optional shared DB config used by learning/pattern subsystems. */
    database?: {
        path: string;
        maxConnections: number;
    };
}

export interface LayerConfigs {
    layer1: Layer1Config; // Claude tools - fast search
    layer2: Layer2Config; // Tree-sitter - AST analysis
    layer3: Layer3Config; // Symbol map & planner
    layer4: Layer4Config; // Ontology - concept management
    layer5: Layer5Config; // Pattern learning & propagation
}

export interface Layer1Config {
    enabled: boolean;
    timeout: number;
    maxResults: number;
    fileTypes: string[];
    optimization: {
        bloomFilter: boolean;
        frequencyCache: boolean;
        negativeLookup: boolean;
    };
}

export interface Layer2Config {
    enabled: boolean;
    timeout: number;
    languages: string[];
    maxFileSize: number;
    parseTimeout: number;
}

export interface Layer3Config {
    enabled: boolean;
    dbPath: string;
    cacheSize: number;
    conceptThreshold: number;
    relationshipDepth: number;
}

export interface Layer4Config {
    enabled: boolean;
    // Storage adapter selection (default: 'sqlite')
    adapter?: 'sqlite' | 'postgres' | 'triplestore';
    // Preferred ontology DB path (for sqlite adapter)
    dbPath?: string;
    // When true, explore_codebase always augments definitions with
    // conceptual anchors from the ontology (Layer 4), even if the
    // request doesn't pass conceptual=true. Can still be gated by env flags
    // or adapter-specific behaviors.
    augmentExplore?: boolean;
}

export interface Layer5Config {
    enabled: boolean;
    // Pattern learning config
    dbPath?: string;
    learningThreshold: number;
    confidenceThreshold: number;
    maxPatterns: number;
    decayRate: number;
    // Propagation config
    maxDepth: number;
    autoApplyThreshold: number;
    propagationTimeout: number;
}

export interface PerformanceConfig {
    targetLatency?: number; // 100ms
    /** Back-compat alias (legacy name used in a few call sites). */
    targetResponseTime?: number;
    maxConcurrentRequests?: number;
    requestTimeout?: number;
    circuitBreakerThreshold?: number;
    healthCheckInterval?: number;
    // Optional runtime flags used elsewhere in the codebase
    enableTiming?: boolean;
    enableProfiling?: boolean;
    logSlowOperations?: boolean;
    slowOperationThresholdMs?: number;
    // Smart Escalation v2 config surface
    escalation?: {
        policy?: 'auto' | 'always' | 'never';
        l1ConfidenceThreshold?: number;
        l1AmbiguityMaxFiles?: number;
        l1RequireFilenameMatch?: boolean;
        layer2?: {
            budgetMs?: number;
            maxCandidateFiles?: number;
        };
        layer3?: {
            budgetMs?: number;
        };
    };
    tools?: {
        fileDiscovery?: {
            prefer?: 'auto' | 'rg' | 'node';
        };
    };
}

export interface CacheConfig {
    enabled: boolean;
    strategy: 'memory' | 'redis' | 'hybrid';
    memory: {
        maxSize: number; // bytes
        ttl: number; // seconds
    };
    redis?: {
        url: string;
        ttl: number;
        keyPrefix: string;
    };
}

export interface MonitoringConfig {
    enabled: boolean;
    metricsInterval: number;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    tracing: {
        enabled: boolean;
        endpoint?: string;
        sampleRate: number;
    };
}

// Error types
export class CoreError extends Error {
    constructor(
        message: string,
        public code: string,
        public layer?: string,
        public requestId?: string,
        public details?: Record<string, any>
    ) {
        super(message);
        this.name = 'CoreError';
    }
}

export class LayerTimeoutError extends CoreError {
    constructor(layer: string, timeout: number, requestId?: string) {
        super(`Layer ${layer} timed out after ${timeout}ms`, 'LAYER_TIMEOUT', layer, requestId);
    }
}

export class LayerUnavailableError extends CoreError {
    constructor(layer: string, reason: string, requestId?: string) {
        super(`Layer ${layer} is unavailable: ${reason}`, 'LAYER_UNAVAILABLE', layer, requestId);
    }
}

export class InvalidRequestError extends CoreError {
    constructor(message: string, requestId?: string) {
        super(message, 'INVALID_REQUEST', undefined, requestId);
    }
}

// Utility types
export interface RequestMetadata {
    id: string;
    startTime: number;
    source: 'lsp' | 'mcp' | 'http' | 'cli' | 'unified';
    userId?: string;
    sessionId?: string;
    clientVersion?: string;
}

export interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    hits: number;
    size: number;
}

export type CacheKey = string;

export interface EventBus {
    emit<T>(event: string, data: T): void;
    on<T>(event: string, handler: (data: T) => void): void;
    off<T>(event: string, handler: (data: T) => void): void;
    once<T>(event: string, handler: (data: T) => void): void;
}

// Analytics and learning types
export interface UsageEvent {
    type: 'definition' | 'reference' | 'rename' | 'completion';
    identifier: string;
    language: string;
    success: boolean;
    latency: number;
    cacheHit: boolean;
    timestamp: number;
    userId?: string;
}

export interface LearningFeedback {
    requestId: string;
    accepted: boolean;
    suggestion: string;
    actualChoice: string;
    confidence: number;
    timestamp: number;
}

export interface PatternStatistics {
    totalPatterns: number;
    activePatterns: number;
    averageConfidence: number;
    recentAccuracy: number;
    learningRate: number;
}

// Health monitoring
export interface HealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    timestamp: number;
    layers: Record<string, LayerHealthStatus>;
    overall: {
        uptime: number;
        requestCount: number;
        errorRate: number;
        averageLatency: number;
    };
}

export interface LayerHealthStatus {
    name: string;
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency: number;
    errorRate: number;
    lastCheck: number;
    details?: string;
}
