/**
 * Plugin API Interfaces - Core contracts for plugin development
 * These interfaces define the API surface that plugins can use to interact with the system
 */

import type { EventEmitter } from 'events';
import {
    type Completion,
    type Definition,
    LayerMetrics,
    type PerformanceMetrics,
    type Reference,
} from '../core/types.js';

// ============================================================================
// Core Plugin Interface
// ============================================================================

export interface BasePlugin {
    readonly manifest: PluginManifest;
    readonly state: PluginState;
    readonly id: string;
    readonly version: string;

    // Lifecycle methods
    onLoad(context: PluginContext): Promise<void>;
    onInitialize(config: PluginConfig): Promise<void>;
    onActivate(): Promise<void>;
    onDeactivate(): Promise<void>;
    onUnload(): Promise<void>;
    onConfigChange(newConfig: PluginConfig): Promise<void>;
    onHealthCheck(): PluginHealthStatus;
}

// ============================================================================
// Plugin Types and Categories
// ============================================================================

export type PluginType = 'layer' | 'newLayer' | 'protocol' | 'language' | 'integration' | 'analysis';

export interface LayerPlugin extends BasePlugin {
    type: 'layer';
    targetLayer: 'layer1' | 'layer2' | 'layer3' | 'layer4' | 'layer5';
    enhanceExisting: boolean; // true = enhance, false = replace
    process(input: LayerInput, context: LayerContext): Promise<LayerOutput>;
    getTargetLatency(): number;
    canHandle(input: LayerInput): boolean;
}

export interface NewLayerPlugin extends BasePlugin {
    type: 'newLayer';
    layerNumber: number; // 6+
    layerName: string;
    dependencies: string[]; // Required layers
    process(input: UnifiedInput, context: CoreContext): Promise<LayerOutput>;
    initialize(): Promise<void>;
    dispose(): Promise<void>;
}

export interface ProtocolPlugin extends BasePlugin {
    type: 'protocol';
    protocolName: string;
    defaultPort?: number;
    supportedMethods: string[];
    initialize(core: CoreAnalyzer): Promise<ProtocolServer>;
    handleRequest(method: string, params: any): Promise<any>;
    shutdown(): Promise<void>;
}

export interface LanguagePlugin extends BasePlugin {
    type: 'language';
    languageId: string;
    fileExtensions: string[];
    mimeTypes?: string[];
    parser: LanguageParser;
    analyzer: LanguageAnalyzer;
    isSupported(uri: string): boolean;
    parseDocument(content: string, uri: string): Promise<ParsedDocument>;
}

export interface IntegrationPlugin extends BasePlugin {
    type: 'integration';
    serviceName: string;
    endpoints: EndpointConfiguration[];
    authenticate?(credentials: any): Promise<boolean>;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
}

export interface AnalysisPlugin extends BasePlugin {
    type: 'analysis';
    analysisTypes: AnalysisType[];
    analyze(document: ParsedDocument, options?: AnalysisOptions): Promise<AnalysisResult>;
    getSupportedLanguages(): string[];
}

// ============================================================================
// Plugin Manifest and Configuration
// ============================================================================

export interface PluginManifest {
    id: string;
    name: string;
    version: string;
    description: string;
    author: {
        name: string;
        email?: string;
        url?: string;
    };

    // Plugin characteristics
    type: PluginType;
    category: PluginCategory;
    tags: string[];

    // Compatibility
    compatibility: {
        minCoreVersion: string;
        maxCoreVersion?: string;
        nodeVersion: string;
        platforms: string[]; // ['linux', 'darwin', 'win32']
    };

    // Security requirements
    capabilities: SecurityCapabilities;

    // Performance expectations
    performance: PerformanceBudget;

    // Plugin metadata
    metadata: {
        homepage?: string;
        repository?: string;
        license: string;
        keywords: string[];
        screenshots?: string[];
        documentation?: string;
    };

    // Dependencies
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;

    // Entry points
    main: string; // Main plugin file
    types?: string; // TypeScript definitions

    // Configuration schema
    configSchema?: JSONSchema;
    defaultConfig?: Record<string, any>;
}

export interface PluginConfig {
    enabled: boolean;
    priority: number; // Execution order (lower = higher priority)
    timeout: number; // Operation timeout in ms
    retries: number; // Retry attempts on failure

    logging: {
        level: LogLevel;
        destination: string;
        includeStackTrace: boolean;
    };

    performance: {
        maxMemoryMB: number;
        maxCpuPercent: number;
        cacheEnabled: boolean;
        cacheSizeMB: number;
        cacheTtlMs: number;
    };

    security: {
        allowedHosts: string[];
        allowedPaths: string[];
        restrictedApis: string[];
    };

    custom: Record<string, any>; // Plugin-specific settings
}

export interface SecurityCapabilities {
    filesystem: {
        read: string[]; // Allowed read paths (glob patterns)
        write: string[]; // Allowed write paths
        execute: boolean; // Can execute system commands
        watch: boolean; // Can watch file changes
    };
    network: {
        outbound: string[]; // Allowed outbound hosts/ports
        inbound: boolean; // Can accept inbound connections
        protocols: string[]; // ['http', 'https', 'ws', 'wss']
    };
    system: {
        processAccess: boolean; // Access to process information
        environmentAccess: boolean; // Access to environment variables
        coreApiAccess: string[]; // Core API methods
        childProcesses: boolean; // Can spawn child processes
    };
    resources: {
        maxMemoryMB: number; // Maximum memory usage
        maxCpuPercent: number; // Maximum CPU usage
        maxExecutionTimeMs: number; // Maximum single operation time
        maxConcurrentOperations: number; // Concurrency limit
        maxFileSize: number; // Maximum file size to process
    };
}

export interface PerformanceBudget {
    maxLatencyMs: number; // Maximum single operation time
    maxMemoryMB: number; // Maximum memory footprint
    maxCpuPercent: number; // Maximum CPU usage
    maxConcurrentOps: number; // Concurrency limit
    cacheHitRateMin: number; // Minimum cache efficiency
    throughputMin?: number; // Minimum operations per second
}

// ============================================================================
// Plugin Context and Runtime
// ============================================================================

export interface PluginContext {
    readonly pluginId: string;
    readonly workspacePath: string;
    readonly logger: PluginLogger;
    readonly eventBus: PluginEventBus;
    readonly storage: PluginStorage;
    readonly cache: PluginCache;
    readonly core: CoreAPIProxy;
    readonly config: PluginConfig;
    readonly performance: PerformanceMonitor;

    // Utility functions
    createTimer(name: string): Timer;
    reportMetrics(metrics: Record<string, number>): void;
    requestPermission(capability: string): Promise<boolean>;
}

export interface PluginLogger {
    trace(message: string, ...args: any[]): void;
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, error?: Error, ...args: any[]): void;
    setLevel(level: LogLevel): void;
}

export interface PluginEventBus extends EventEmitter {
    publish(event: PluginEvent): Promise<void>;
    subscribe(eventType: string, handler: PluginEventHandler): void;
    unsubscribe(eventType: string, handler: PluginEventHandler): void;
    subscribeToCore(eventType: string, handler: CoreEventHandler): void;
}

export interface PluginStorage {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    keys(): Promise<string[]>;
    exists(key: string): Promise<boolean>;
}

export interface PluginCache {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T, ttl?: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    stats(): Promise<CacheStats>;
}

// ============================================================================
// Core System Proxy Interface
// ============================================================================

export interface CoreAPIProxy {
    // Analysis operations
    findDefinition(identifier: string, uri: string, position?: Position): Promise<Definition[]>;
    findReferences(identifier: string, uri: string): Promise<Reference[]>;
    getCompletions(prefix: string, uri: string, position?: Position): Promise<Completion[]>;

    // Document operations
    getDocument(uri: string): Promise<ParsedDocument | undefined>;
    parseDocument(content: string, uri: string): Promise<ParsedDocument>;

    // Learning system access
    learnPattern(pattern: LearningPattern): Promise<void>;
    getPatterns(type?: string): Promise<LearningPattern[]>;
    provideFeedback(feedback: PatternFeedback): Promise<void>;

    // Workspace operations
    getWorkspaceFiles(pattern?: string): Promise<string[]>;
    watchFiles(pattern: string, callback: FileWatchCallback): Promise<FileWatcher>;

    // Configuration access
    getCoreConfig(): Promise<CoreConfig>;
    getWorkspaceConfig(): Promise<WorkspaceConfig>;

    // Performance monitoring
    reportPerformance(metrics: PerformanceMetrics): Promise<void>;
    getSystemHealth(): Promise<SystemHealthStatus>;
}

// ============================================================================
// Plugin Lifecycle and State Management
// ============================================================================

export enum PluginState {
    UNLOADED = 'unloaded',
    LOADING = 'loading',
    LOADED = 'loaded',
    INITIALIZING = 'initializing',
    READY = 'ready',
    ACTIVE = 'active',
    ERROR = 'error',
    DISABLED = 'disabled',
    UPDATING = 'updating',
}

export enum PluginLoadPhase {
    DISCOVERY = 'discovery',
    VALIDATION = 'validation',
    INSTALLATION = 'installation',
    INITIALIZATION = 'initialization',
    REGISTRATION = 'registration',
    ACTIVATION = 'activation',
}

export interface PluginHealthStatus {
    status: 'healthy' | 'degraded' | 'unhealthy';
    latency: number;
    errorRate: number;
    memoryUsage: number;
    cpuUsage: number;
    cacheHitRate?: number;
    lastCheck: number;
    details?: string;
    metrics: Record<string, number>;
}

export interface PluginPerformanceMetrics {
    pluginId: string;
    operationCount: number;
    averageLatency: number;
    p95Latency: number;
    p99Latency: number;
    errorRate: number;
    memoryUsage: number;
    cpuUsage: number;
    cacheHitRate: number;
    throughput: number;
    lastUpdated: number;
}

// ============================================================================
// Plugin Events
// ============================================================================

export interface PluginEvent {
    type: string;
    pluginId: string;
    timestamp: number;
    data: any;
    correlationId?: string;
}

export type PluginEventHandler = (event: PluginEvent) => void | Promise<void>;

export type CoreEventHandler = (event: CoreEvent) => void | Promise<void>;

// ============================================================================
// Data Types and Structures
// ============================================================================

export interface LayerInput {
    identifier?: string;
    uri: string;
    position?: Position;
    context?: string;
    query?: string;
    type: 'definition' | 'reference' | 'completion' | 'analysis';
    metadata?: Record<string, any>;
}

export interface LayerOutput {
    results: Definition[] | Reference[] | Completion[] | any[];
    confidence: number;
    source: string;
    processingTime: number;
    cacheHit?: boolean;
    metadata?: Record<string, any>;
}

export interface LayerContext {
    requestId: string;
    workspace: string;
    language?: string;
    performance: PerformanceTracker;
    cache: LayerCache;
    logger: PluginLogger;
}

export interface UnifiedInput {
    type: string;
    data: any;
    context: CoreContext;
    requestId: string;
}

export interface CoreContext {
    workspace: string;
    requestId: string;
    user?: string;
    performance: PerformanceTracker;
    config: CoreConfig;
}

export interface Position {
    line: number;
    character: number;
}

export interface ParsedDocument {
    uri: string;
    content: string;
    language: string;
    version?: number;
    ast?: any;
    symbols?: DocumentSymbol[];
    diagnostics?: Diagnostic[];
    metadata?: Record<string, any>;
}

export interface DocumentSymbol {
    name: string;
    kind: SymbolKind;
    range: Range;
    selectionRange: Range;
    detail?: string;
    children?: DocumentSymbol[];
}

export interface Range {
    start: Position;
    end: Position;
}

export interface Diagnostic {
    range: Range;
    severity: DiagnosticSeverity;
    message: string;
    code?: string;
    source?: string;
}

// ============================================================================
// Language Support
// ============================================================================

export interface LanguageParser {
    parse(content: string, uri: string): Promise<ParseResult>;
    parseIncremental(content: string, changes: TextChange[]): Promise<ParseResult>;
    getSupportedFeatures(): ParserFeature[];
}

export interface LanguageAnalyzer {
    findDefinitions(document: ParsedDocument, position: Position): Promise<Definition[]>;
    findReferences(document: ParsedDocument, position: Position): Promise<Reference[]>;
    getCompletions(document: ParsedDocument, position: Position): Promise<Completion[]>;
    getDocumentSymbols(document: ParsedDocument): Promise<DocumentSymbol[]>;
    getDiagnostics(document: ParsedDocument): Promise<Diagnostic[]>;
}

export interface ParseResult {
    ast: any;
    symbols: DocumentSymbol[];
    diagnostics: Diagnostic[];
    metadata?: Record<string, any>;
}

// ============================================================================
// Protocol Support
// ============================================================================

export interface ProtocolServer {
    start(port?: number): Promise<void>;
    stop(): Promise<void>;
    isRunning(): boolean;
    getPort(): number;
    handleConnection(connection: any): void;
}

export interface EndpointConfiguration {
    path: string;
    methods: string[];
    handler: EndpointHandler;
    middleware?: MiddlewareFunction[];
    rateLimit?: RateLimitConfig;
    authentication?: AuthConfig;
}

export type EndpointHandler = (request: ProtocolRequest, response: ProtocolResponse) => Promise<void>;

// ============================================================================
// Analysis and Integration
// ============================================================================

export interface AnalysisResult {
    type: AnalysisType;
    findings: AnalysisFinding[];
    metadata: Record<string, any>;
    processingTime: number;
    confidence: number;
}

export interface AnalysisFinding {
    type: string;
    severity: 'info' | 'warning' | 'error';
    message: string;
    range?: Range;
    suggestions?: string[];
    metadata?: Record<string, any>;
}

// ============================================================================
// Enums and Constants
// ============================================================================

export enum PluginCategory {
    LANGUAGE_SUPPORT = 'language-support',
    CODE_ANALYSIS = 'code-analysis',
    INTEGRATION = 'integration',
    PRODUCTIVITY = 'productivity',
    DEBUGGING = 'debugging',
    TESTING = 'testing',
    DOCUMENTATION = 'documentation',
    SECURITY = 'security',
    PERFORMANCE = 'performance',
}

export enum LogLevel {
    TRACE = 0,
    DEBUG = 1,
    INFO = 2,
    WARN = 3,
    ERROR = 4,
    SILENT = 5,
}

export enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
}

export enum DiagnosticSeverity {
    Error = 1,
    Warning = 2,
    Information = 3,
    Hint = 4,
}

export enum AnalysisType {
    SYNTAX = 'syntax',
    SEMANTIC = 'semantic',
    QUALITY = 'quality',
    SECURITY = 'security',
    PERFORMANCE = 'performance',
    DOCUMENTATION = 'documentation',
    TESTING = 'testing',
    DEPENDENCY = 'dependency',
}

export enum ParserFeature {
    INCREMENTAL_PARSING = 'incremental-parsing',
    ERROR_RECOVERY = 'error-recovery',
    SYNTAX_HIGHLIGHTING = 'syntax-highlighting',
    FOLDING_RANGES = 'folding-ranges',
    DOCUMENT_SYMBOLS = 'document-symbols',
    SEMANTIC_TOKENS = 'semantic-tokens',
}

// ============================================================================
// Utility Types
// ============================================================================

export interface Timer {
    start(): void;
    stop(): number;
    reset(): void;
    elapsed(): number;
}

export interface PerformanceTracker {
    startOperation(name: string): Timer;
    recordLatency(operation: string, latency: number): void;
    recordMemoryUsage(bytes: number): void;
    recordCacheHit(key: string): void;
    recordCacheMiss(key: string): void;
    getMetrics(): PerformanceMetrics;
}

export interface FileWatcher {
    close(): void;
    addPath(path: string): void;
    removePath(path: string): void;
}

export type FileWatchCallback = (event: 'add' | 'change' | 'unlink', path: string) => void;

export interface CacheStats {
    size: number;
    hitRate: number;
    missRate: number;
    evictionCount: number;
    memoryUsage: number;
}

export interface JSONSchema {
    $schema?: string;
    type?: string | string[];
    properties?: Record<string, JSONSchema>;
    required?: string[];
    additionalProperties?: boolean;
    items?: JSONSchema;
    // ... additional JSON Schema properties
}

export interface LearningPattern {
    id: string;
    type: string;
    from: string;
    to: string;
    confidence: number;
    usage: number;
    metadata?: Record<string, any>;
}

export interface PatternFeedback {
    patternId: string;
    helpful: boolean;
    context?: string;
    suggestion?: string;
}

// Type aliases for common structures
export type MiddlewareFunction = (request: any, response: any, next: () => void) => void;
export type RateLimitConfig = { windowMs: number; maxRequests: number };
export type AuthConfig = { type: 'bearer' | 'basic' | 'apikey'; required: boolean };
export type ProtocolRequest = { method: string; path: string; headers: Record<string, string>; body?: any };
export type ProtocolResponse = { status: number; headers: Record<string, string>; body?: any };
export type TextChange = { range: Range; text: string };
export type LayerCache = { get(key: string): any; set(key: string, value: any): void };
export type CoreConfig = Record<string, any>;
export type WorkspaceConfig = Record<string, any>;
export type SystemHealthStatus = { status: string; components: Record<string, any> };
export type CoreEvent = { type: string; data: any; timestamp: number };
export type AnalysisOptions = Record<string, any>;
export type CoreAnalyzer = any; // Will be defined by the core system

export default {
    // Export main types for easy import
    BasePlugin,
    LayerPlugin,
    NewLayerPlugin,
    ProtocolPlugin,
    LanguagePlugin,
    IntegrationPlugin,
    AnalysisPlugin,
    PluginManifest,
    PluginConfig,
    PluginContext,
    PluginState,
    PluginLoadPhase,
    PluginCategory,
    LogLevel,
};
