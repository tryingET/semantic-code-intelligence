/**
 * AnalyzerFactory - Factory for creating and configuring the unified analyzer
 * This provides a clean interface for protocol adapters to initialize the system
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
// Import existing layer implementations
import { ClaudeToolsLayer } from '../layers/claude-tools';
import { PlannerLayer } from '../layers/planner-layer';
import { TreeSitterLayer, type TreeSitterResult } from '../layers/tree-sitter';
import { OntologyEngine } from '../ontology/ontology-engine';
import { createStorageAdapter } from '../ontology/storage-factory';
import { PatternLearner } from '../patterns/pattern-learner';
import { KnowledgeSpreader } from '../propagation/knowledge-spreader';
import type { EnhancedMatches, SearchQuery } from '../types/core';
import { CoreError } from './errors';
import { DefaultEventBus, LayerManager } from './layer-manager';
import { SharedServices } from './services/index';
import { CacheConfig, type CoreConfig, type Layer, LayerConfigs, MonitoringConfig, PerformanceConfig } from './types';
import { CodeAnalyzer } from './unified-analyzer';

/**
 * Layer adapter interface to wrap existing implementations
 */
abstract class LayerAdapter implements Layer {
    abstract name: string;
    abstract version: string;
    abstract targetLatency: number;

    async initialize(): Promise<void> {
        // Default implementation - override if needed
    }

    async dispose(): Promise<void> {
        // Default implementation - override if needed
    }

    isHealthy(): boolean {
        return true; // Override if health checks are available
    }

    getMetrics(): any {
        return {
            name: this.name,
            requestCount: 0,
            averageLatency: 0,
            p95Latency: 0,
            errorCount: 0,
            cacheHitRate: 0,
        };
    }
}

class DisabledLayerAdapter extends LayerAdapter {
    version = 'disabled';

    constructor(
        public name: string,
        public targetLatency: number
    ) {
        super();
    }
}

/**
 * Adapter for existing ClaudeToolsLayer
 */
class Layer1Adapter extends LayerAdapter {
    name = 'layer1';
    version = '1.0.0';
    targetLatency = 200; // 200ms target - realistic for ripgrep operations on larger codebases

    private claudeTools: ClaudeToolsLayer;

    constructor(config: any) {
        super();
        this.claudeTools = new ClaudeToolsLayer(config);
    }

    getClaudeTools(): ClaudeToolsLayer {
        return this.claudeTools;
    }

    async process(query: SearchQuery): Promise<EnhancedMatches> {
        return this.claudeTools.process(query);
    }
}

/**
 * Adapter for existing TreeSitterLayer
 */
class Layer2Adapter extends LayerAdapter {
    name = 'layer2';
    version = '1.0.0';
    targetLatency = 50; // 50ms target

    private treeSitter: TreeSitterLayer;

    constructor(config: any, ontology?: OntologyEngine) {
        super();
        // Optionally inject ontology engine to enrich relevance and concept inference
        this.treeSitter = new TreeSitterLayer(config, ontology);
    }

    getTreeSitter(): TreeSitterLayer {
        return this.treeSitter;
    }

    async process(matches: EnhancedMatches): Promise<TreeSitterResult> {
        return this.treeSitter.process(matches);
    }
}

/**
 * Adapter for existing OntologyEngine (Layer 4)
 * Now with lazy initialization to avoid 567ms startup cost
 */
class Layer3Adapter extends LayerAdapter {
    name = 'layer4';
    version = '1.0.0';
    targetLatency = 10; // 10ms target

    private ontology: OntologyEngine | null = null;
    private storage: any;
    private initPromise: Promise<void> | null = null;
    private lazyInit: boolean;

    constructor(storage: any) {
        super();
        this.storage = storage;
        // Check for env flag to control lazy initialization
        this.lazyInit = process.env.EAGER_L4_INIT !== '1';

        if (process.env.DEBUG_LAYER_INIT === '1') {
            console.log(`[Layer4] Lazy init: ${this.lazyInit}`);
        }

        if (!this.lazyInit) {
            // Eager initialization (old behavior)
            this.ontology = new OntologyEngine(storage);
        }
    }

    async initialize(): Promise<void> {
        if (!this.lazyInit && this.ontology) {
            // If eager init, initialize the ontology engine now
            await this.ontology.ensureInitialized();
        }
        // If lazy init, do nothing - will initialize on first use
    }

    private async ensureInitialized(): Promise<void> {
        if (this.ontology) return;

        // Use a promise to prevent multiple initializations
        if (!this.initPromise) {
            this.initPromise = (async () => {
                this.ontology = new OntologyEngine(this.storage);
                await this.ontology.ensureInitialized();
            })();
        }

        await this.initPromise;
    }

    getOntologyEngine(): OntologyEngine {
        if (!this.ontology) {
            // Keep the getter safe in both eager and lazy modes. Callers that need
            // storage readiness still call ensureInitialized() on the returned engine.
            this.ontology = new OntologyEngine(this.storage);
        }
        return this.ontology;
    }

    async process(input: any): Promise<any> {
        if (this.lazyInit) {
            await this.ensureInitialized();
        }
        // Default mock behavior - override in actual implementation
        return { results: [], processingTime: 0 };
    }
}

/**
 * Adapter for existing PatternLearner (Layer 5)
 */
class Layer4Adapter extends LayerAdapter {
    name = 'layer5';
    version = '1.0.0';
    targetLatency = 10; // 10ms target

    private patternLearner: PatternLearner;

    constructor(dbPath: string, config: any) {
        super();
        this.patternLearner = new PatternLearner(dbPath, config);
    }

    getPatternLearner(): PatternLearner {
        return this.patternLearner;
    }

    // Lightweight stats surface used by adapters (MCP/HTTP)
    async getPatternStatistics(): Promise<any> {
        try {
            return await this.patternLearner.getStatistics();
        } catch (e) {
            return { error: (e as Error)?.message || String(e) };
        }
    }

    async dispose(): Promise<void> {
        await this.patternLearner.dispose();
    }
}

/**
 * Adapter for existing KnowledgeSpreader
 * Note: remains Layer 5 (propagation) in the updated mapping.
 */
class Layer5Adapter extends LayerAdapter {
    name = 'layer6';
    version = '1.0.0';
    targetLatency = 20; // 20ms target

    private knowledgeSpreader: KnowledgeSpreader;

    constructor(ontology: OntologyEngine, patternLearner: PatternLearner) {
        super();
        this.knowledgeSpreader = new KnowledgeSpreader(ontology, patternLearner);
    }

    getKnowledgeSpreader(): KnowledgeSpreader {
        return this.knowledgeSpreader;
    }
}

/**
 * Factory for creating the unified analyzer with all components
 */
export class AnalyzerFactory {
    /**
     * Create a default configuration suitable for most use cases
     */
    static createDefaultConfig(): CoreConfig {
        const config: CoreConfig = {
            layers: {
                layer1: {
                    enabled: true,
                    timeout: 200, // 4x target latency (50ms * 4 for I/O operations)
                    maxResults: 100,
                    fileTypes: ['ts', 'tsx', 'js', 'jsx', 'py', 'java', 'go', 'rust'],
                    optimization: {
                        bloomFilter: true,
                        frequencyCache: true,
                        negativeLookup: true,
                    },
                },
                layer2: {
                    enabled: true,
                    timeout: 100, // 2x target latency
                    languages: ['typescript', 'javascript', 'python'],
                    maxFileSize: 1024 * 1024, // 1MB
                    parseTimeout: 50,
                },
                layer3: {
                    enabled: true,
                    dbPath: '.ontology/ontology.db',
                    cacheSize: 1000,
                    conceptThreshold: 0.7,
                    relationshipDepth: 3,
                },
                layer4: {
                    enabled: true,
                    adapter: 'sqlite',
                    dbPath: '.ontology/ontology.db',
                    // Enable conceptual augmentation by default so explore_codebase
                    // returns ontology-backed hints without needing a flag.
                    augmentExplore: true,
                },
                layer5: {
                    enabled: true,
                    dbPath: '.ontology/ontology.db',
                    learningThreshold: 3,
                    confidenceThreshold: 0.7,
                    maxPatterns: 1000,
                    decayRate: 0.95,
                    maxDepth: 3,
                    autoApplyThreshold: 0.9,
                    propagationTimeout: 40,
                },
            },
            performance: {
                targetLatency: 100,
                maxConcurrentRequests: 10,
                requestTimeout: 5000,
                circuitBreakerThreshold: 5,
                healthCheckInterval: 30000,
            },
            cache: {
                enabled: true,
                strategy: 'memory',
                memory: {
                    maxSize: 100 * 1024 * 1024, // 100MB
                    ttl: 300, // 5 minutes
                },
            },
            monitoring: {
                enabled: true,
                metricsInterval: 60000, // 1 minute
                logLevel: 'info',
                tracing: {
                    enabled: false,
                    sampleRate: 0.1,
                },
            },
        };

        return config;
    }

    /**
     * Create a unified analyzer with all layers configured
     */
    static async createAnalyzer(config?: Partial<CoreConfig>): Promise<{
        analyzer: CodeAnalyzer;
        layerManager: LayerManager;
        sharedServices: SharedServices;
    }> {
        // Merge with default config
        const base = AnalyzerFactory.createDefaultConfig();
        const configuredLayers = ((config as any)?.layers || {}) as Record<string, any>;
        const mergeLayer = (name: keyof CoreConfig['layers']) => ({
            ...((base.layers as any)[name] || {}),
            ...(configuredLayers[name as string] || {}),
        });
        const fullConfig: CoreConfig = {
            ...base,
            ...config,
            layers: {
                ...base.layers,
                ...configuredLayers,
                layer1: mergeLayer('layer1'),
                layer2: mergeLayer('layer2'),
                layer3: mergeLayer('layer3'),
                layer4: mergeLayer('layer4'),
                layer5: mergeLayer('layer5'),
            } as any,
            performance: { ...base.performance, ...(config as any)?.performance } as any,
            cache: { ...base.cache, ...(config as any)?.cache } as any,
            monitoring: { ...base.monitoring, ...(config as any)?.monitoring } as any,
        };

        // Create event bus
        const eventBus = new DefaultEventBus();

        // Create layer manager
        const layerManager = new LayerManager(fullConfig, eventBus);

        // Create shared services
        const sharedServices = new SharedServices(fullConfig, eventBus);

        // Create and register layer adapters
        const layer1 = new Layer1Adapter({
            grep: {
                defaultTimeout: fullConfig.layers.layer1.timeout,
                maxResults: fullConfig.layers.layer1.maxResults,
                caseSensitive: false,
                includeContext: true,
                contextLines: 3,
            },
            glob: {
                defaultTimeout: fullConfig.layers.layer1.timeout,
                maxFiles: 1000,
                ignorePatterns: ['node_modules/**', 'dist/**', '.git/**', 'coverage/**'],
            },
            ls: {
                defaultTimeout: fullConfig.layers.layer1.timeout,
                maxDepth: 10,
                followSymlinks: false,
                includeDotfiles: false,
            },
            optimization: fullConfig.layers.layer1.optimization,
            caching: {
                enabled: true,
                ttl: 3600,
                maxEntries: 1000,
            },
        });

        const workspaceRoot = path.resolve((fullConfig as any).workspaceRoot || process.cwd());
        const layer4Enabled = fullConfig.layers.layer4?.enabled ?? true;
        const layer5Enabled = fullConfig.layers.layer5?.enabled ?? true;
        const layer3DbPath = AnalyzerFactory.resolveWorkspaceDbPath(
            fullConfig.layers.layer3.dbPath,
            workspaceRoot,
            'layer3.dbPath'
        );
        const ontologyDbPath = AnalyzerFactory.resolveWorkspaceDbPath(
            fullConfig.layers.layer4?.dbPath || layer3DbPath,
            workspaceRoot,
            'layer4.dbPath'
        );
        const patternDbPath = AnalyzerFactory.resolveWorkspaceDbPath(
            fullConfig.layers.layer5?.dbPath || ontologyDbPath,
            workspaceRoot,
            'layer5.dbPath'
        );
        fullConfig.workspaceRoot = workspaceRoot;
        fullConfig.layers.layer3 = { ...fullConfig.layers.layer3, dbPath: layer3DbPath };
        if (fullConfig.layers.layer4)
            fullConfig.layers.layer4 = { ...fullConfig.layers.layer4, dbPath: ontologyDbPath };
        if (fullConfig.layers.layer5) fullConfig.layers.layer5 = { ...fullConfig.layers.layer5, dbPath: patternDbPath };
        const layer3Planner = new PlannerLayer();
        const storage = layer4Enabled
            ? createStorageAdapter({
                  enabled: true,
                  adapter: fullConfig.layers.layer4?.adapter ?? 'sqlite',
                  dbPath: ontologyDbPath,
              } as any)
            : undefined;
        const layer4Ont = layer4Enabled ? new Layer3Adapter(storage) : new DisabledLayerAdapter('layer4', 10);

        // Pass null initially if using lazy init for Layer 4
        // Layer 2 can work without ontology engine
        const layer2 = new Layer2Adapter(
            {
                enabled: fullConfig.layers.layer2.enabled,
                timeout: fullConfig.layers.layer2.timeout,
                languages: fullConfig.layers.layer2.languages,
                maxFileSize: fullConfig.layers.layer2.maxFileSize.toString(),
            },
            process.env.EAGER_L4_INIT === '1' && layer4Enabled
                ? (layer4Ont as Layer3Adapter).getOntologyEngine()
                : undefined
        );

        const layer5Pat = layer5Enabled
            ? new Layer4Adapter(patternDbPath, {
                  learningThreshold: (fullConfig.layers as any).layer5?.learningThreshold ?? 3,
                  confidenceThreshold: (fullConfig.layers as any).layer5?.confidenceThreshold ?? 0.7,
              })
            : new DisabledLayerAdapter('layer5', 10);

        // Register all layers
        layerManager.registerLayer(layer1);
        layerManager.registerLayer(layer2);
        layerManager.registerLayer(layer3Planner);
        layerManager.registerLayer(layer4Ont);
        layerManager.registerLayer(layer5Pat);

        // Create the unified analyzer
        const analyzer = new CodeAnalyzer(layerManager, sharedServices, fullConfig, eventBus);

        // Initialize everything
        await analyzer.initialize();

        return {
            analyzer,
            layerManager,
            sharedServices,
        };
    }

    private static isDefaultOntologyDbPath(dbPath: unknown): boolean {
        if (typeof dbPath !== 'string') return false;
        const normalized = dbPath.replace(/\\/g, '/');
        return normalized === '.ontology/ontology.db' || normalized.endsWith('/.ontology/ontology.db');
    }

    private static isPathInsideOrEqual(parent: string, candidate: string): boolean {
        const relative = path.relative(parent, candidate);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    private static nearestExistingPath(candidate: string): string {
        let current = candidate;
        while (!fs.existsSync(current)) {
            const parent = path.dirname(current);
            if (parent === current) return current;
            current = parent;
        }
        return current;
    }

    private static resolveWorkspaceDbPath(dbPath: string | undefined, workspaceRoot: string, label: string): string {
        if (!dbPath || dbPath === ':memory:') return dbPath || ':memory:';
        const root = path.resolve(workspaceRoot);
        const resolved = path.isAbsolute(dbPath) ? path.resolve(dbPath) : path.resolve(root, dbPath);
        if (!AnalyzerFactory.isPathInsideOrEqual(root, resolved)) {
            throw new CoreError('InvalidParams', `${label} must stay within the workspace`, {
                workspaceRoot: root,
                dbPath,
            });
        }
        if (fs.existsSync(root)) {
            const nearest = AnalyzerFactory.nearestExistingPath(resolved);
            const realRoot = fs.realpathSync(root);
            const realNearest = fs.realpathSync(nearest);
            if (!AnalyzerFactory.isPathInsideOrEqual(realRoot, realNearest)) {
                throw new CoreError('InvalidParams', `${label} realpath must stay within the workspace`, {
                    workspaceRoot: root,
                    dbPath,
                });
            }
        }
        return resolved;
    }

    /**
     * Create analyzer with specific workspace path
     */
    static async createWorkspaceAnalyzer(
        workspacePath: string,
        config?: Partial<CoreConfig>
    ): Promise<{
        analyzer: CodeAnalyzer;
        layerManager: LayerManager;
        sharedServices: SharedServices;
    }> {
        const workspaceDbPath = `${workspacePath}/.ontology/ontology.db`;
        const configuredLayer5DbPath = (config?.layers as any)?.layer5?.dbPath;
        const layer5DbPath = AnalyzerFactory.isDefaultOntologyDbPath(configuredLayer5DbPath)
            ? workspaceDbPath
            : configuredLayer5DbPath;
        const workspaceConfig: any = {
            ...config,
            layers: {
                ...config?.layers,
                layer3: {
                    ...config?.layers?.layer3,
                    dbPath: workspaceDbPath,
                },
                layer4: {
                    ...config?.layers?.layer4,
                    adapter: (config?.layers as any)?.layer4?.adapter ?? 'sqlite',
                    dbPath: workspaceDbPath,
                },
                layer5: {
                    ...config?.layers?.layer5,
                    dbPath: layer5DbPath ?? workspaceDbPath,
                },
            },
            // Provide workspaceRoot to downstream analyzer config for correct path resolution
            workspaceRoot: workspacePath,
        };

        return AnalyzerFactory.createAnalyzer(workspaceConfig as Partial<CoreConfig>);
    }

    /**
     * Create a lightweight analyzer for testing
     */
    static async createTestAnalyzer(): Promise<{
        analyzer: CodeAnalyzer;
        layerManager: LayerManager;
        sharedServices: SharedServices;
    }> {
        const testConfig: Partial<CoreConfig> = {
            layers: {
                layer1: {
                    enabled: true,
                    timeout: 200,
                    maxResults: 10,
                    fileTypes: ['ts', 'js'],
                    optimization: { bloomFilter: false, frequencyCache: false, negativeLookup: false },
                },
                layer2: {
                    enabled: false,
                    timeout: 100,
                    languages: ['typescript'],
                    maxFileSize: 1024,
                    parseTimeout: 50,
                },
                layer3: {
                    enabled: true,
                    dbPath: ':memory:',
                    cacheSize: 100,
                    conceptThreshold: 0.5,
                    relationshipDepth: 1,
                },
                layer4: {
                    enabled: true,
                    adapter: 'sqlite',
                    dbPath: ':memory:',
                },
                layer5: {
                    enabled: false,
                    dbPath: ':memory:',
                    learningThreshold: 1,
                    confidenceThreshold: 0.5,
                    maxPatterns: 100,
                    decayRate: 0.9,
                    maxDepth: 1,
                    autoApplyThreshold: 0.9,
                    propagationTimeout: 20,
                },
            },
            cache: {
                enabled: true,
                strategy: 'memory',
                memory: {
                    maxSize: 1024 * 1024, // 1MB
                    ttl: 60, // 1 minute
                },
            },
            monitoring: {
                enabled: false,
                metricsInterval: 10000,
                logLevel: 'error',
                tracing: {
                    enabled: false,
                    sampleRate: 0,
                },
            },
        };

        return AnalyzerFactory.createAnalyzer(testConfig);
    }
}

/**
 * Export layer adapters for direct access if needed
 */
export { Layer1Adapter, Layer2Adapter, Layer3Adapter, Layer4Adapter, Layer5Adapter };
